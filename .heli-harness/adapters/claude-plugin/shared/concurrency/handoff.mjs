/**
 * Layer 2 coordination state (issue #36): workspace-scoped task dependencies
 * and published artifact handoffs.
 *
 * Scope invariants:
 * - dependencies + handoffs are shared by every checkout of one workspace,
 *   next to the workspace-scoped task records;
 * - sessions, writer leases, resource authority, grants, and observations stay
 *   execution-scoped and are never read or written here;
 * - a published handoff stores metadata only in one atomic coordination.json
 *   authority file. The Git ref is the artifact snapshot authority; Heli never
 *   copies or owns artifact contents;
 * - `ready` means "every declared dependency is satisfied" and nothing else.
 *   Nothing here starts work, spawns agents, or mutates task execution state;
 *   readiness is a separate coordinationState, never a task.status rewrite.
 */
import { isAbsolute, join, win32 } from "node:path";
import {
	claimDirExclusive,
	ensureDir,
	listDirNames,
	pathExists,
	readJson,
	releaseDir,
	writeJsonAtomic,
} from "./fs-atomic.mjs";
import { linkedWorkspaceTasksDir } from "./project-binding.mjs";
import { tasksDirFor } from "./paths.mjs";
import { readTask } from "./task.mjs";
import { appendTaskEvent } from "./events.mjs";
import { slugTaskId } from "./ids.mjs";
import { resolveWorkspaceLayout } from "./project-binding.mjs";

export const COORDINATION_SCHEMA_VERSION = 1;
export const COORDINATION_STATES = Object.freeze(["satisfied", "blocked", "ready"]);

function error(code, message, extra = {}) {
	const value = new Error(message);
	value.code = code;
	Object.assign(value, extra);
	return value;
}

/**
 * Workspace coordination root: linked mode shares
 * ~/.heli/state/workspaces/<id>/coordination; embedded compatibility stays on
 * the checkout (.heli-harness/coordination) like embedded tasks do.
 */
export function coordinationDirFor(workspaceRoot, { env = process.env } = {}) {
	const layout = resolveWorkspaceLayout(workspaceRoot, { env });
	if (layout.mode === "linked" && layout.binding?.workspaceId) {
		return join(linkedWorkspaceTasksDir(layout.binding.workspaceId, env), "..", "coordination");
	}
	return join(layout.operationalRoot, "coordination");
}

function coordinationStorePath(workspaceRoot, env = process.env) {
	return join(coordinationDirFor(workspaceRoot, { env }), "coordination.json");
}

function coordinationLockPath(workspaceRoot, env = process.env) {
	return join(coordinationDirFor(workspaceRoot, { env }), ".mutex");
}

function withCoordinationLock(workspaceRoot, env, fn) {
	const dir = coordinationDirFor(workspaceRoot, { env });
	ensureDir(dir);
	const lock = coordinationLockPath(workspaceRoot, env);
	const claim = claimDirExclusive(lock);
	if (!claim.ok) throw error("COORDINATION_STORE_BUSY", "workspace coordination transition already in progress");
	try {
		return fn();
	} finally {
		releaseDir(lock);
	}
}

function readCoordinationStore(workspaceRoot, env = process.env) {
	const path = coordinationStorePath(workspaceRoot, env);
	const value = readJson(path, null);
	if (!value) return { schemaVersion: COORDINATION_SCHEMA_VERSION, dependencies: [], handoffs: {} };
	if (!Array.isArray(value.dependencies) || !value.handoffs || typeof value.handoffs !== "object" || Array.isArray(value.handoffs)) {
		throw error("MALFORMED_COORDINATION_STATE", `${path} must contain dependencies[] and handoffs{}`);
	}
	return value;
}

function writeCoordinationStore(workspaceRoot, store, env = process.env) {
	ensureDir(coordinationDirFor(workspaceRoot, { env }));
	writeJsonAtomic(coordinationStorePath(workspaceRoot, env), store);
}

function handoffKey(producerTaskId, artifactName) {
	return `${producerTaskId}/${artifactName}`;
}

function artifactNameOrThrow(name) {
	let slug;
	try {
		slug = slugTaskId(name);
	} catch {
		throw error("INVALID_ARTIFACT_NAME", `artifact name must be a non-empty slug of [a-z0-9._-]: ${JSON.stringify(name)}`);
	}
	return slug;
}

function requireTask(workspaceRoot, taskId, role, env = process.env) {
	const task = readTask(workspaceRoot, taskId, { env });
	if (!task) {
		throw error("TASK_NOT_FOUND", `unknown ${role} task: ${taskId}`);
	}
	return task;
}

/**
 * A dependency is (consumer, producer, artifact) — declared once, idempotent.
 * A second declaration of the same triple is a no-op. A triple that reuses the
 * pair but changes the producer (or anything else) fails explicitly.
 */
export function declareDependency(workspaceRoot, { consumerTaskId, producerTaskId, artifactName, sessionId = null, env = process.env } = {}) {
	const consumer = slugTaskId(consumerTaskId);
	const producer = slugTaskId(producerTaskId);
	const artifact = artifactNameOrThrow(artifactName);
	if (consumer === producer) {
		throw error("SELF_DEPENDENCY", `task ${consumer} cannot depend on itself`);
	}
	requireTask(workspaceRoot, consumer, "consumer", env);
	requireTask(workspaceRoot, producer, "producer", env);

	return withCoordinationLock(workspaceRoot, env, () => {
		const store = readCoordinationStore(workspaceRoot, env);
		const sameTriple = store.dependencies.find((d) =>
			d.consumerTaskId === consumer && d.producerTaskId === producer && d.artifactName === artifact,
		);
		if (sameTriple) {
			return { dependency: sameTriple, created: false };
		}
		// One logical artifact name per consumer is unambiguous only when it comes
		// from one producer. Repointing it silently would change what unblocks the
		// task; a second input with the same name needs a distinct artifact name.
		const conflict = store.dependencies.find((d) =>
			d.consumerTaskId === consumer && d.artifactName === artifact && d.producerTaskId !== producer,
		);
		if (conflict) {
			throw error(
				"DEPENDENCY_CONFLICT",
				`task ${consumer} already depends on ${conflict.producerTaskId}/${artifact}; redeclaring it against ${producer} conflicts. Use a distinct artifact name for a second producer.`,
				{ dependency: conflict },
			);
		}
		const dependency = {
			dependencySchemaVersion: COORDINATION_SCHEMA_VERSION,
			consumerTaskId: consumer,
			producerTaskId: producer,
			artifactName: artifact,
			declaredAt: new Date().toISOString(),
			declaredBySessionId: sessionId || null,
		};
		store.dependencies.push(dependency);
		store.updatedAt = new Date().toISOString();
		writeCoordinationStore(workspaceRoot, store, env);
		appendTaskEvent(workspaceRoot, consumer, "dependency_declared", {
			sessionId,
			producerTaskId: producer,
			artifactName: artifact,
		}, { env });
		return { dependency, created: true };
	}, env);
}

export function listDependencies(workspaceRoot, { env = process.env } = {}) {
	return readCoordinationStore(workspaceRoot, env).dependencies;
}

export function dependenciesForTask(workspaceRoot, taskId, { env = process.env } = {}) {
	return listDependencies(workspaceRoot, { env }).filter((d) => d.consumerTaskId === taskId);
}

/**
 * One published instance per (producer, artifact). Republishing the exact same
 * producer+artifact+ref+path is a no-op. The same logical artifact with a
 * different ref or path is a fail-closed conflict (a revision model is a
 * separate, explicit product decision — not this layer). The canonical publication
 * is stored in the same coordination.json as dependencies so a crash cannot
 * commit one without the other.
 */
export function publishHandoff(workspaceRoot, { producerTaskId, artifactName, ref, path = null, sessionId = null, env = process.env } = {}) {
	const producer = slugTaskId(producerTaskId);
	const artifact = artifactNameOrThrow(artifactName);
	requireTask(workspaceRoot, producer, "producer", env);
	if (!ref || !String(ref).trim()) {
		throw error("HANDOFF_REF_REQUIRED", "handoff publication requires a Git ref");
	}
	const gitRef = String(ref).trim();
	const relPath = path == null || path === "" ? null : String(path);
	const portablePath = relPath?.replaceAll("\\", "/") || null;
	const windowsPath = relPath ? win32.parse(relPath) : null;
	if (relPath && (isAbsolute(relPath) || windowsPath?.root || portablePath.startsWith("/") || portablePath.split("/").some((part) => part === ".." || part === "."))) {
		throw error("INVALID_ARTIFACT_PATH", `artifact path must be repo-relative without traversal: ${relPath}`);
	}

	return withCoordinationLock(workspaceRoot, env, () => {
		const store = readCoordinationStore(workspaceRoot, env);
		const key = handoffKey(producer, artifact);
		const existing = store.handoffs[key] || null;
		if (existing) {
			if (existing.ref === gitRef && (existing.path || null) === (relPath || null)) {
				return { publication: existing, created: false };
			}
			throw error(
				"HANDOFF_CONFLICT",
				`artifact ${producer}/${artifact} was already published as ref ${existing.ref}${existing.path ? ` path ${existing.path}` : ""}; republishing ${gitRef}${relPath ? ` path ${relPath}` : ""} conflicts. A new revision needs an explicit revision model.`,
				{ publication: existing },
			);
		}
		const publication = {
			publicationSchemaVersion: COORDINATION_SCHEMA_VERSION,
			producerTaskId: producer,
			artifactName: artifact,
			ref: gitRef,
			path: relPath,
			publishedAt: new Date().toISOString(),
			publishedBySessionId: sessionId || null,
		};
		store.handoffs[key] = publication;
		store.updatedAt = new Date().toISOString();
		writeCoordinationStore(workspaceRoot, store, env);
		appendTaskEvent(workspaceRoot, producer, "handoff_published", {
			sessionId,
			artifactName: artifact,
			ref: gitRef,
			path: relPath,
		}, { env });
		return { publication, created: true };
	}, env);
}

export function listHandoffs(workspaceRoot, { env = process.env } = {}) {
	const store = readCoordinationStore(workspaceRoot, env);
	return Object.values(store.handoffs)
		.sort((a, b) => `${a.producerTaskId}/${a.artifactName}`.localeCompare(`${b.producerTaskId}/${b.artifactName}`));
}

export function readHandoff(workspaceRoot, producerTaskId, artifactName, { env = process.env } = {}) {
	const producer = slugTaskId(producerTaskId);
	const artifact = artifactNameOrThrow(artifactName);
	return readCoordinationStore(workspaceRoot, env).handoffs[handoffKey(producer, artifact)] || null;
}

/**
 * Dependency evaluation for one consumer. Pure read: never mutates tasks,
 * never starts work. Task execution status (active/complete/closed) is
 * untouched — readiness lands in coordinationState.
 */
export function evaluateTaskCoordination(workspaceRoot, taskId, { env = process.env } = {}) {
	const dependencies = dependenciesForTask(workspaceRoot, taskId, { env });
	const published = new Map(listHandoffs(workspaceRoot, { env }).map((p) => [`${p.producerTaskId}/${p.artifactName}`, p]));
	const evaluated = dependencies.map((d) => {
		const publication = published.get(`${d.producerTaskId}/${d.artifactName}`);
		return {
			...d,
			state: publication ? "satisfied" : "blocked",
			...(publication ? { ref: publication.ref, path: publication.path, publishedAt: publication.publishedAt } : {}),
		};
	});
	const blockedOn = evaluated
		.filter((d) => d.state === "blocked")
		.map((d) => `${d.producerTaskId}/${d.artifactName}`);
	return {
		taskId,
		coordinationState: blockedOn.length ? "blocked" : "ready",
		dependencies: evaluated,
		blockedOn,
		blocked_on: blockedOn,
	};
}

/**
 * All tasks' coordination state in one pass (shared by CLI surfaces).
 */
export function evaluateWorkspaceCoordination(workspaceRoot, { env = process.env } = {}) {
	const dir = tasksDirFor(workspaceRoot, { env });
	return listDirNames(dir)
		.filter((id) => pathExists(join(dir, id, "task.json")))
		.map((id) => evaluateTaskCoordination(workspaceRoot, id, { env }));
}
