import { spawnSync } from "node:child_process";
import {
	findWorkspaceRoot,
	gitBranch,
	gitRevParse,
	resolveWorktreeRoot,
} from "../concurrency/paths.mjs";
import {
	readProjectBinding,
	resolveExecutionIdentity,
} from "../concurrency/project-binding.mjs";
import { listActiveTasks } from "../concurrency/task.mjs";
import { evaluateTaskCoordination } from "../concurrency/handoff.mjs";
import { listActiveSessions } from "../concurrency/session.mjs";
import {
	isResourceLeaseExpired,
	readResourceLeaseForWorktree,
	resourceIdForWorktree,
} from "../concurrency/resource-authority.mjs";
import { protocolOk } from "../protocol/result.mjs";
import { printProtocolResult, stripOutputFlags, wantsJson } from "./output.mjs";

function workspaceRequired(cwd) {
	const workspaceRoot = findWorkspaceRoot(cwd);
	if (workspaceRoot) return workspaceRoot;
	const error = new Error(`No Heli workspace found from ${cwd}`);
	error.code = "WORKSPACE_NOT_FOUND";
	throw error;
}

function gitStatus(worktreePath) {
	const result = spawnSync(
		"git",
		["-C", worktreePath, "status", "--porcelain=v1", "--untracked-files=all"],
		{ encoding: "utf8", windowsHide: true },
	);
	if (result.status !== 0) {
		return {
			available: false,
			branch: null,
			head: null,
			dirty: false,
			changes: [],
		};
	}
	const changes = String(result.stdout || "")
		.split("\n")
		.filter(Boolean)
		.map((line) => ({
			status: line.slice(0, 2),
			path: line.slice(3),
		}));
	return {
		available: true,
		branch: gitBranch(worktreePath),
		head: gitRevParse(worktreePath),
		dirty: changes.length > 0,
		changes,
	};
}

function taskProjection(workspaceRoot, task, env) {
	const coordination = evaluateTaskCoordination(workspaceRoot, task.taskId, { env });
	return {
		taskId: task.taskId,
		title: task.title || "",
		status: task.status,
		mode: task.mode || "strict",
		workItemKey: task.workItemKey || null,
		target: task.target || null,
		coordinationState: coordination.coordinationState,
		blockedOn: coordination.blockedOn,
		dependencies: coordination.dependencies,
	};
}

function runtimeObservations(sessions) {
	const observations = [];
	for (const session of sessions) {
		const capabilities = session.runtimeAttestation?.observedCapabilities || {};
		for (const [capability, observation] of Object.entries(capabilities)) {
			if (!observation || observation.observed !== true) continue;
			observations.push({
				sessionId: session.sessionId,
				host: observation.host || session.host || "unknown",
				hostSessionId: observation.hostSessionId || session.externalHostSessionId || null,
				capability,
				observedAt: observation.observedAt || null,
				validUntil: observation.validUntil || null,
				source: observation.source || null,
			});
		}
	}
	return observations.sort((a, b) =>
		String(b.observedAt || "").localeCompare(String(a.observedAt || "")),
	);
}

function authorityProjection(workspaceRoot, worktreePath) {
	const resourceId = resourceIdForWorktree(worktreePath);
	const lease = readResourceLeaseForWorktree(workspaceRoot, worktreePath);
	if (!lease) {
		return {
			resourceId,
			state: "available",
			writerSessionId: null,
			taskId: null,
			expiresAt: null,
		};
	}
	if (lease.invalid) {
		return {
			resourceId,
			state: "invalid",
			writerSessionId: lease.raw?.sessionId || null,
			taskId: lease.raw?.taskId || null,
			expiresAt: lease.raw?.expiresAt || null,
			reason: lease.reason || "malformed resource authority",
		};
	}
	const stale = isResourceLeaseExpired(lease);
	return {
		resourceId: lease.resource?.id || resourceId,
		state: stale ? "stale" : "held",
		writerSessionId: lease.sessionId || null,
		taskId: lease.taskId || null,
		expiresAt: lease.expiresAt || null,
		worktreePath: lease.worktreePath || worktreePath,
	};
}

function guidanceFor({ tasks, authority, git }) {
	const guidance = [];
	if (tasks.length === 0) {
		guidance.push("No active durable task is recorded in this workspace.");
	} else if (tasks.length > 1) {
		guidance.push(
			"Multiple active tasks are recorded. Inspect the task list and continue the intended one; Heli does not schedule or choose a task automatically.",
		);
	}
	const blocked = tasks.filter((task) => task.coordinationState === "blocked");
	if (blocked.length) {
		guidance.push(
			"One or more tasks are blocked on declared artifacts. Inspect blockedOn/dependencies before continuing.",
		);
	}
	if (authority.state === "held") {
		guidance.push(
			`Writer authority is currently held by session ${authority.writerSessionId}; a new host must not assume or inherit that authority.`,
		);
	} else if (authority.state === "stale") {
		guidance.push(
			"Writer authority is stale. Existing takeover rules still apply; resume does not transfer authority.",
		);
	} else if (authority.state === "invalid") {
		guidance.push(
			"Writer authority state is malformed. Treat writes as unsafe until the authority state is repaired.",
		);
	} else {
		guidance.push(
			"No active writer authority is recorded for this worktree. A host still needs the normal SessionStart/PreToolUse lifecycle before writing.",
		);
	}
	if (git.available && git.dirty) {
		guidance.push(
			"Git has uncommitted changes. Review them before editing so work from the previous tool is not overwritten.",
		);
	} else if (git.available) {
		guidance.push("Git worktree is clean at the recorded HEAD.");
	}
	return guidance;
}

/**
 * Build a read-only continuation packet for switching hosts/tools.
 *
 * This function does not create sessions, acquire authority, mutate tasks,
 * publish handoffs, or change Git state.
 */
export function buildResumeContext(cwd = process.cwd(), { env = process.env } = {}) {
	const workspaceRoot = workspaceRequired(cwd);
	const worktreePath = resolveWorktreeRoot(cwd);
	const binding = readProjectBinding(workspaceRoot);
	const execution = resolveExecutionIdentity(workspaceRoot, { env });
	const tasks = listActiveTasks(workspaceRoot, { env })
		.map((task) => taskProjection(workspaceRoot, task, env))
		.sort((a, b) => a.taskId.localeCompare(b.taskId));
	const sessions = listActiveSessions(workspaceRoot);
	const git = gitStatus(worktreePath);
	const authority = authorityProjection(workspaceRoot, worktreePath);
	const observations = runtimeObservations(sessions);

	const context = {
		workspace: {
			workspaceRoot,
			workspaceId: binding?.workspaceId || null,
			executionId: execution?.executionId || null,
			worktreePath,
		},
		git,
		tasks,
		authority,
		sessions: sessions.map((session) => ({
			sessionId: session.sessionId,
			host: session.host || "unknown",
			externalHostSessionId: session.externalHostSessionId || null,
			taskId: session.taskId || null,
			mode: session.mode || "observe",
			status: session.status || null,
			worktreePath: session.worktreePath || null,
			lastSeenAt: session.lastSeenAt || null,
		})),
		observations,
	};
	return {
		...context,
		guidance: guidanceFor(context),
	};
}

function printHuman(context) {
	console.log("Heli resume");
	console.log(`Workspace: ${context.workspace.workspaceId || context.workspace.workspaceRoot}`);
	if (context.workspace.executionId) console.log(`Execution: ${context.workspace.executionId}`);
	console.log(`Worktree: ${context.workspace.worktreePath}`);
	console.log(
		context.git.available
			? `Git: ${context.git.branch || "(detached)"} @ ${context.git.head || "unknown"} — ${context.git.dirty ? `dirty (${context.git.changes.length} changes)` : "clean"}`
			: "Git: unavailable",
	);
	console.log(
		`Writer: ${context.authority.state}${context.authority.writerSessionId ? ` — ${context.authority.writerSessionId}` : ""}`,
	);

	console.log("");
	if (context.tasks.length === 0) {
		console.log("Active tasks: none");
	} else {
		console.log(`Active tasks: ${context.tasks.length}`);
		for (const task of context.tasks) {
			console.log(
				`- ${task.taskId}: status=${task.status} coordination=${task.coordinationState}${task.title ? ` — ${task.title}` : ""}`,
			);
			if (task.blockedOn.length) {
				console.log(`  blocked_on: ${task.blockedOn.join(", ")}`);
			}
			for (const dependency of task.dependencies) {
				if (dependency.state === "satisfied") {
					console.log(
						`  dependency: ${dependency.producerTaskId}/${dependency.artifactName} satisfied ref=${dependency.ref}${dependency.path ? ` path=${dependency.path}` : ""}`,
					);
				}
			}
		}
	}

	if (context.git.dirty) {
		console.log("");
		console.log("Git changes:");
		for (const change of context.git.changes) {
			console.log(`  ${change.status} ${change.path}`);
		}
	}

	if (context.observations.length) {
		console.log("");
		console.log("Recent runtime observations:");
		for (const observation of context.observations.slice(0, 8)) {
			console.log(
				`- ${observation.capability} host=${observation.host} session=${observation.sessionId} at=${observation.observedAt || "unknown"}`,
			);
		}
	}

	console.log("");
	console.log("Continuation:");
	for (const item of context.guidance) console.log(`- ${item}`);
}

export function runResume(args = []) {
	const json = wantsJson(args);
	const positional = stripOutputFlags(args);
	const cwd = positional[0] || process.cwd();
	const context = buildResumeContext(cwd);
	if (json) {
		printProtocolResult(protocolOk("resume", context));
		return context;
	}
	printHuman(context);
	return context;
}
