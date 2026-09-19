import {
	ensureDir,
	listFileNames,
	pathExists,
	readJson,
	writeJsonAtomic,
} from "./fs-atomic.mjs";
import { pathsFor, sessionPath, canonicalizePath } from "./paths.mjs";
import { newSessionId } from "./ids.mjs";
import { SESSION_SCHEMA_VERSION } from "./schema.mjs";
import { appendTaskEvent } from "./events.mjs";
import { readTask } from "./task.mjs";

const MODE_RANK = Object.freeze({ observe: 0, review: 1, write: 2 });

export function normalizeSessionMode(value) {
	const mode = String(value || "observe").toLowerCase();
	return Object.prototype.hasOwnProperty.call(MODE_RANK, mode) ? mode : "observe";
}

export function sessionModeRank(value) {
	return MODE_RANK[normalizeSessionMode(value)];
}

export function normalizeSession(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const mode = normalizeSessionMode(value.mode);
	return {
		...value,
		schemaVersion: SESSION_SCHEMA_VERSION,
		parentSessionId: value.parentSessionId || null,
		role: value.role || (value.parentSessionId ? "worker" : "controller"),
		delegation: {
			...(value.delegation && typeof value.delegation === "object" ? value.delegation : {}),
			mode: normalizeSessionMode(value.delegation?.mode || mode),
		},
		mode,
	};
}

export function readSession(workspaceRoot, sessionId) {
	if (!sessionId) return null;
	return normalizeSession(readJson(sessionPath(workspaceRoot, sessionId), null));
}

export function listSessions(workspaceRoot) {
	const { sessionsDir } = pathsFor(workspaceRoot);
	return listFileNames(sessionsDir, { suffix: ".json" })
		.map((name) => readSession(workspaceRoot, name.replace(/\.json$/, "")))
		.filter(Boolean);
}

export function listActiveSessions(workspaceRoot) {
	return listSessions(workspaceRoot).filter((s) => String(s.status || "") === "active");
}

export function listChildSessions(workspaceRoot, parentSessionId, { activeOnly = false } = {}) {
	return listSessions(workspaceRoot).filter(
		(s) => s.parentSessionId === parentSessionId && (!activeOnly || s.status === "active"),
	);
}

export function writeSession(workspaceRoot, session) {
	const { sessionsDir } = pathsFor(workspaceRoot);
	ensureDir(sessionsDir);
	const normalized = normalizeSession(session);
	writeJsonAtomic(sessionPath(workspaceRoot, normalized.sessionId), normalized);
	return normalized;
}

export function createSession(workspaceRoot, {
	sessionId = null,
	externalHostSessionId = null,
	host = "unknown",
	taskId = null,
	mode = "observe",
	worktreePath = "",
	status = "active",
	parentSessionId = null,
	role = null,
	delegation = null,
} = {}) {
	const id = sessionId || newSessionId();
	if (readSession(workspaceRoot, id)) {
		const err = new Error(`session already exists: ${id}`);
		err.code = "SESSION_EXISTS";
		throw err;
	}
	const parent = parentSessionId ? readSession(workspaceRoot, parentSessionId) : null;
	if (parentSessionId && !parent) {
		const err = new Error(`parent session not found: ${parentSessionId}`);
		err.code = "PARENT_SESSION_NOT_FOUND";
		throw err;
	}
	if (parent && parent.status !== "active") {
		const err = new Error(`parent session is not active: ${parentSessionId}`);
		err.code = "PARENT_SESSION_INACTIVE";
		throw err;
	}
	const resolvedTaskId = taskId || parent?.taskId || null;
	if (parent?.taskId && resolvedTaskId && parent.taskId !== resolvedTaskId) {
		const err = new Error(`child task ${resolvedTaskId} differs from parent task ${parent.taskId}`);
		err.code = "CHILD_TASK_MISMATCH";
		throw err;
	}
	const resolvedMode = normalizeSessionMode(mode);
	const delegatedMode = normalizeSessionMode(delegation?.mode || (parent ? "observe" : resolvedMode));
	if (parent && sessionModeRank(delegatedMode) > sessionModeRank(parent.mode)) {
		const err = new Error(`parent mode ${parent.mode} cannot delegate ${delegatedMode}`);
		err.code = "PARENT_AUTHORITY_EXCEEDED";
		throw err;
	}
	if (parent && sessionModeRank(resolvedMode) > sessionModeRank(delegatedMode)) {
		const err = new Error(`requested child mode ${resolvedMode} exceeds delegated mode ${delegatedMode}`);
		err.code = "DELEGATION_EXCEEDED";
		throw err;
	}
	const now = new Date().toISOString();
	const session = {
		schemaVersion: SESSION_SCHEMA_VERSION,
		sessionId: id,
		externalHostSessionId: externalHostSessionId || null,
		host,
		taskId: resolvedTaskId,
		mode: resolvedMode,
		parentSessionId: parent?.sessionId || null,
		role: role || (parent ? "worker" : "controller"),
		delegation: { mode: delegatedMode },
		worktreePath: worktreePath ? canonicalizePath(worktreePath) : parent?.worktreePath || "",
		status,
		yolo: { enabled: false },
		createdAt: now,
		lastSeenAt: now,
		closedAt: null,
	};
	const written = writeSession(workspaceRoot, session);
	if (resolvedTaskId && readTask(workspaceRoot, resolvedTaskId)) {
		appendTaskEvent(workspaceRoot, resolvedTaskId, "session.started", {
			sessionId: id,
			parentSessionId: written.parentSessionId,
			role: written.role,
			mode: written.mode,
			delegation: written.delegation,
			host: written.host,
		});
	}
	return written;
}

export function touchSession(workspaceRoot, sessionId) {
	const s = readSession(workspaceRoot, sessionId);
	if (!s) return null;
	s.lastSeenAt = new Date().toISOString();
	return writeSession(workspaceRoot, s);
}

export function attachSession(workspaceRoot, sessionId, taskId, { mode = "write", worktreePath = "" } = {}) {
	const s = readSession(workspaceRoot, sessionId);
	if (!s) {
		const err = new Error(`session not found: ${sessionId}`);
		err.code = "SESSION_NOT_FOUND";
		throw err;
	}
	const task = readTask(workspaceRoot, taskId);
	if (!task) {
		const err = new Error(`task not found: ${taskId}`);
		err.code = "TASK_NOT_FOUND";
		throw err;
	}
	const requestedMode = normalizeSessionMode(mode);
	if (s.parentSessionId) {
		const parent = readSession(workspaceRoot, s.parentSessionId);
		if (!parent || parent.status !== "active") {
			const err = new Error(`parent session unavailable: ${s.parentSessionId}`);
			err.code = "PARENT_SESSION_INACTIVE";
			throw err;
		}
		if (parent.taskId && parent.taskId !== taskId) {
			const err = new Error(`child task ${taskId} differs from parent task ${parent.taskId}`);
			err.code = "CHILD_TASK_MISMATCH";
			throw err;
		}
		if (sessionModeRank(requestedMode) > sessionModeRank(s.delegation?.mode)) {
			const err = new Error(`requested child mode ${requestedMode} exceeds delegated mode ${s.delegation?.mode}`);
			err.code = "DELEGATION_EXCEEDED";
			throw err;
		}
	}
	s.taskId = taskId;
	s.mode = requestedMode;
	if (worktreePath) s.worktreePath = canonicalizePath(worktreePath);
	s.status = "active";
	s.lastSeenAt = new Date().toISOString();
	s.closedAt = null;
	writeSession(workspaceRoot, s);
	appendTaskEvent(workspaceRoot, taskId, "session.attached", {
		sessionId,
		parentSessionId: s.parentSessionId,
		role: s.role,
		mode: requestedMode,
		worktreePath: s.worktreePath,
		host: s.host,
	});
	return s;
}

export function closeSession(workspaceRoot, sessionId) {
	const s = readSession(workspaceRoot, sessionId);
	if (!s) return null;
	s.status = "closed";
	s.closedAt = new Date().toISOString();
	s.lastSeenAt = s.closedAt;
	const written = writeSession(workspaceRoot, s);
	if (written.taskId) {
		appendTaskEvent(workspaceRoot, written.taskId, "session.closed", {
			sessionId: written.sessionId,
			parentSessionId: written.parentSessionId,
			role: written.role,
		});
	}
	return written;
}

export function findSessionByExternalId(
	workspaceRoot,
	externalHostSessionId,
	{ host = null } = {},
) {
	if (!externalHostSessionId) return null;
	const expectedHost = host ? String(host) : null;
	return (
		listSessions(workspaceRoot).find(
			(s) =>
				s.status === "active" &&
				s.externalHostSessionId &&
				String(s.externalHostSessionId) === String(externalHostSessionId) &&
				(!expectedHost || String(s.host || "unknown") === expectedHost),
		) || null
	);
}

export function setSessionYolo(workspaceRoot, sessionId, enabled) {
	const s = readSession(workspaceRoot, sessionId);
	if (!s) return null;
	s.yolo = { enabled: !!enabled, updatedAt: new Date().toISOString() };
	s.lastSeenAt = new Date().toISOString();
	return writeSession(workspaceRoot, s);
}

export function pathExistsSession(workspaceRoot, sessionId) {
	return pathExists(sessionPath(workspaceRoot, sessionId));
}
