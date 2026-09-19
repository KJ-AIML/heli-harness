import { readTask, updateTask, readTaskMarkdown, writeTaskMarkdown, writeConcurrentProjection } from "./task.mjs";
import { createSession, attachSession, readSession } from "./session.mjs";
import { acquireWriteLease, releaseWriteLease, takeoverWriteLease, readLease, isLeaseExpired } from "./lease.mjs";
import { writeBinding } from "./binding.mjs";
import { evaluateDiagnosisCompletion, readDiagnosis } from "./diagnosis.mjs";

function error(code, message) {
	const value = new Error(message);
	value.code = code;
	return value;
}

export function claimTaskTransition(workspaceRoot, {
	taskId,
	sessionId = null,
	host = "cli",
	mode = "write",
	worktreePath = "",
} = {}) {
	const task = readTask(workspaceRoot, taskId);
	if (!task) throw error("TASK_NOT_FOUND", `task not found: ${taskId}`);
	let session = sessionId ? readSession(workspaceRoot, sessionId) : null;
	if (!session) {
		session = createSession(workspaceRoot, {
			sessionId: sessionId || undefined,
			host,
			taskId,
			mode,
			worktreePath,
		});
		sessionId = session.sessionId;
	} else {
		session = attachSession(workspaceRoot, sessionId, taskId, { mode, worktreePath });
	}
	let lease = null;
	if (mode === "write") {
		lease = acquireWriteLease(workspaceRoot, { taskId, sessionId, worktreePath });
	}
	writeBinding(workspaceRoot, { worktreePath, taskId, sessionId, host: session.host || host, mode });
	writeConcurrentProjection(workspaceRoot);
	return { workspaceRoot, taskId, task, sessionId, session, lease, mode, worktreePath };
}

export function releaseTaskTransition(workspaceRoot, {
	taskId = null,
	sessionId = null,
	force = false,
} = {}) {
	let resolvedTaskId = taskId;
	if (!resolvedTaskId) {
		if (!sessionId) throw error("TASK_OR_SESSION_REQUIRED", "task id or session id required");
		resolvedTaskId = readSession(workspaceRoot, sessionId)?.taskId || null;
	}
	if (!resolvedTaskId) throw error("UNBOUND_SESSION", "session is not bound to a task");
	if (!sessionId && !force) throw error("SESSION_REQUIRED", "owner session id required unless force cleanup is explicit");
	const releasedLease = releaseWriteLease(workspaceRoot, resolvedTaskId, { sessionId, force });
	writeConcurrentProjection(workspaceRoot);
	return { workspaceRoot, taskId: resolvedTaskId, sessionId, releasedLease };
}

export function takeoverTaskTransition(workspaceRoot, {
	taskId,
	sessionId = null,
	host = "cli",
	worktreePath = "",
	confirm = false,
} = {}) {
	const task = readTask(workspaceRoot, taskId);
	if (!task) throw error("TASK_NOT_FOUND", `task not found: ${taskId}`);
	let session = sessionId ? readSession(workspaceRoot, sessionId) : null;
	if (!session) {
		session = createSession(workspaceRoot, {
			sessionId: sessionId || undefined,
			host,
			taskId,
			mode: "write",
			worktreePath,
		});
		sessionId = session.sessionId;
	} else {
		session = attachSession(workspaceRoot, sessionId, taskId, { mode: "write", worktreePath });
	}
	const lease = takeoverWriteLease(workspaceRoot, {
		taskId,
		sessionId,
		worktreePath,
		confirm,
	});
	writeBinding(workspaceRoot, { worktreePath, taskId, sessionId, host: session.host || host, mode: "write" });
	writeConcurrentProjection(workspaceRoot);
	return { workspaceRoot, taskId, task, sessionId, session, lease, worktreePath };
}

export function completeTaskTransition(workspaceRoot, {
	taskId,
	sessionId = null,
} = {}) {
	const existingTask = readTask(workspaceRoot, taskId);
	if (!existingTask) throw error("TASK_NOT_FOUND", `task not found: ${taskId}`);
	const diagnosis = readDiagnosis(workspaceRoot, taskId);
	const markdown = readTaskMarkdown(workspaceRoot, taskId);
	const riskTierMatch = /^Risk tier:[ \t]*(.*)$/m.exec(markdown.currentTaskMd || "");
	const completionGate = evaluateDiagnosisCompletion(diagnosis, {
		riskTier: riskTierMatch?.[1] || diagnosis?.riskTier || null,
	});
	if (!completionGate.allowed) {
		throw error(
			completionGate.code || "COMPLETION_BLOCKED",
			`task ${taskId} completion blocked: ${completionGate.reason || completionGate.code}`,
		);
	}
	const lease = readLease(workspaceRoot, taskId);
	const activeLease = lease && !lease.invalid && !isLeaseExpired(lease) ? lease : null;
	if (activeLease && activeLease.sessionId !== sessionId) {
		throw error(
			sessionId ? "LEASE_NOT_OWNER" : "SESSION_REQUIRED",
			`task ${taskId} has an active write lease owned by ${activeLease.sessionId}; complete from that session or takeover first`,
		);
	}
	const task = updateTask(workspaceRoot, taskId, (value) => ({ ...value, status: "complete" }), { sessionId });
	if (markdown.currentTaskMd && /^Current status:.*$/m.test(markdown.currentTaskMd)) {
		writeTaskMarkdown(workspaceRoot, taskId, {
			currentTaskMd: markdown.currentTaskMd.replace(/^Current status:.*$/m, "Current status: complete"),
		});
	}
	let releasedLease = null;
	if (activeLease && sessionId && activeLease.sessionId === sessionId) {
		releasedLease = releaseWriteLease(workspaceRoot, taskId, { sessionId, force: false });
	}
	writeConcurrentProjection(workspaceRoot);
	return { workspaceRoot, taskId, task, sessionId, completionGate, releasedLease };
}
