/**
 * Workspace-scoped continuation records for taskless meaningful work.
 *
 * Continuations preserve enough evidence to switch coding hosts without
 * storing transcripts and without transferring live writer authority.
 */
import { isAbsolute, relative, resolve } from "node:path";
import {
	canonicalizePath,
	gitBranch,
	gitRevParse,
	pathsFor,
} from "./paths.mjs";
import {
	ensureDir,
	listFileNames,
	readJson,
	writeJsonAtomic,
} from "./fs-atomic.mjs";
import { hashCanonicalPath } from "./ids.mjs";
import { isLinkedWorkspace } from "./project-binding.mjs";
import { repositoryForPath } from "./workspace-repos.mjs";
import {
	isPathInside,
	workspaceRelativePath,
} from "./portable-targets.mjs";

export const CONTINUATION_SCHEMA_VERSION = 1;

function continuationIdForCanonicalWorktree(worktreePath) {
	return `continuation-${hashCanonicalPath(worktreePath)}`;
}

export function continuationIdForWorktree(worktreePath) {
	return continuationIdForCanonicalWorktree(canonicalizePath(worktreePath));
}

export function continuationPath(workspaceRoot, continuationId, { env = process.env } = {}) {
	return resolve(pathsFor(workspaceRoot, { env }).continuationsDir, `${continuationId}.json`);
}

function normalizeContinuation(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	if (!value.continuationId || !value.worktreePath) return null;
	return {
		...value,
		schemaVersion: CONTINUATION_SCHEMA_VERSION,
		status: value.status || "active",
		repositoryId: value.repositoryId || null,
		repositoryPath: value.repositoryPath || null,
		workspaceRelativeWorktreePath: value.workspaceRelativeWorktreePath || null,
		branch: value.branch || null,
		head: value.head || null,
		intentPaths: Array.isArray(value.intentPaths) ? value.intentPaths : [],
		provenance: value.provenance && typeof value.provenance === "object" ? value.provenance : {},
		lastActivity: value.lastActivity && typeof value.lastActivity === "object" ? value.lastActivity : null,
	};
}

export function readContinuation(workspaceRoot, continuationId, { env = process.env } = {}) {
	if (!continuationId) return null;
	return normalizeContinuation(readJson(continuationPath(workspaceRoot, continuationId, { env }), null));
}

export function listContinuations(
	workspaceRoot,
	{ env = process.env, activeOnly = false } = {},
) {
	const dir = pathsFor(workspaceRoot, { env }).continuationsDir;
	return listFileNames(dir, { suffix: ".json" })
		.map((name) => readContinuation(workspaceRoot, name.replace(/\.json$/, ""), { env }))
		.filter(Boolean)
		.filter((record) => !activeOnly || record.status === "active")
		.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

export function continuationForWorktree(
	workspaceRoot,
	worktreePath,
	{ env = process.env, activeOnly = true } = {},
) {
	const canonical = canonicalizePath(worktreePath);
	if (!canonical) return null;
	const direct = readContinuation(
		workspaceRoot,
		continuationIdForCanonicalWorktree(canonical),
		{ env },
	);
	if (direct && (!activeOnly || direct.status === "active")) return direct;
	return (
		listContinuations(workspaceRoot, { env, activeOnly }).find(
			(record) => canonicalizePath(record.worktreePath) === canonical,
		) || null
	);
}

function portableIntentPath(workspaceRoot, worktreePath, raw) {
	const text = String(raw || "").trim();
	if (!text) return null;
	const absolute = canonicalizePath(isAbsolute(text) ? text : resolve(worktreePath, text));
	if (!absolute || !isPathInside(workspaceRoot, absolute)) return null;
	const worktreeRelative = relative(worktreePath, absolute).replaceAll("\\", "/");
	return worktreeRelative && !worktreeRelative.startsWith("../")
		? worktreeRelative
		: workspaceRelativePath(workspaceRoot, absolute);
}

export function recordContinuationIntent(
	ctx,
	{
		paths = [],
		toolName = null,
		source = "pre_tool",
		env = process.env,
	} = {},
) {
	if (!ctx?.workspaceRoot || !ctx?.sessionId || !ctx?.worktreeRoot) return null;
	if (!isLinkedWorkspace(ctx.workspaceRoot)) return null;
	// Explicit tasks already provide durable workspace-scoped continuation.
	if (ctx.taskId) return null;

	const worktreePath = canonicalizePath(ctx.worktreeRoot);
	const continuationId = continuationIdForCanonicalWorktree(worktreePath);
	const existing = readContinuation(ctx.workspaceRoot, continuationId, { env });
	const repo = repositoryForPath(ctx.workspaceRoot, worktreePath, { env });
	const now = new Date().toISOString();
	const intentPaths = [
		...(existing?.intentPaths || []),
		...paths.map((path) => portableIntentPath(ctx.workspaceRoot, worktreePath, path)).filter(Boolean),
	].filter((value, index, all) => all.indexOf(value) === index).slice(-64);
	const branch = gitBranch(worktreePath);
	const head = gitRevParse(worktreePath);
	const record = {
		schemaVersion: CONTINUATION_SCHEMA_VERSION,
		continuationId,
		status: "active",
		workspaceRelativeWorktreePath:
			workspaceRelativePath(ctx.workspaceRoot, worktreePath) || existing?.workspaceRelativeWorktreePath || null,
		worktreePath,
		repositoryId: repo?.id || existing?.repositoryId || null,
		repositoryName: repo?.name || existing?.repositoryName || null,
		repositoryPath: repo?.path || existing?.repositoryPath || null,
		branch: branch || existing?.branch || null,
		head: head || existing?.head || null,
		intentPaths,
		provenance: {
			firstHost: existing?.provenance?.firstHost || ctx.host || "unknown",
			firstSessionId: existing?.provenance?.firstSessionId || ctx.sessionId,
			firstExternalHostSessionId:
				existing?.provenance?.firstExternalHostSessionId || ctx.externalHostSessionId || null,
			lastHost: ctx.host || "unknown",
			lastSessionId: ctx.sessionId,
			lastExternalHostSessionId: ctx.externalHostSessionId || null,
		},
		lastActivity: {
			type: "write-intent",
			source,
			toolName: toolName || null,
			at: now,
		},
		createdAt: existing?.createdAt || now,
		updatedAt: now,
		completedAt: existing?.completedAt || null,
	};
	const dir = pathsFor(ctx.workspaceRoot, { env }).continuationsDir;
	ensureDir(dir);
	writeJsonAtomic(continuationPath(ctx.workspaceRoot, continuationId, { env }), record);
	return normalizeContinuation(record);
}

export function completeContinuation(
	workspaceRoot,
	continuationId,
	{ env = process.env, reason = "completed" } = {},
) {
	const record = readContinuation(workspaceRoot, continuationId, { env });
	if (!record) return null;
	const now = new Date().toISOString();
	const next = {
		...record,
		status: "complete",
		completedAt: now,
		updatedAt: now,
		completionReason: reason,
	};
	writeJsonAtomic(continuationPath(workspaceRoot, continuationId, { env }), next);
	return normalizeContinuation(next);
}
