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

export function readSession(workspaceRoot, sessionId) {
	if (!sessionId) return null;
	return readJson(sessionPath(workspaceRoot, sessionId), null);
}

export function listSessions(workspaceRoot) {
	const { sessionsDir } = pathsFor(workspaceRoot);
	return listFileNames(sessionsDir, { suffix: ".json" })
		.map((name) => readJson(sessionPath(workspaceRoot, name.replace(/\.json$/, "")), null))
		.filter(Boolean);
}

export function listActiveSessions(workspaceRoot) {
	return listSessions(workspaceRoot).filter((s) => String(s.status || "") === "active");
}

export function writeSession(workspaceRoot, session) {
	const { sessionsDir } = pathsFor(workspaceRoot);
	ensureDir(sessionsDir);
	writeJsonAtomic(sessionPath(workspaceRoot, session.sessionId), session);
	return session;
}

export function createSession(workspaceRoot, {
	sessionId = null,
	externalHostSessionId = null,
	host = "unknown",
	taskId = null,
	mode = "observe",
	worktreePath = "",
	status = "active",
} = {}) {
	const id = sessionId || newSessionId();
	if (readSession(workspaceRoot, id)) {
		const err = new Error(`session already exists: ${id}`);
		err.code = "SESSION_EXISTS";
		throw err;
	}
	const now = new Date().toISOString();
	const session = {
		schemaVersion: SESSION_SCHEMA_VERSION,
		sessionId: id,
		externalHostSessionId: externalHostSessionId || null,
		host,
		taskId: taskId || null,
		mode: mode === "write" || mode === "review" || mode === "observe" ? mode : "observe",
		worktreePath: worktreePath ? canonicalizePath(worktreePath) : "",
		status,
		yolo: { enabled: false },
		createdAt: now,
		lastSeenAt: now,
		closedAt: null,
	};
	return writeSession(workspaceRoot, session);
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
	s.taskId = taskId;
	s.mode = mode;
	if (worktreePath) s.worktreePath = canonicalizePath(worktreePath);
	s.status = "active";
	s.lastSeenAt = new Date().toISOString();
	s.closedAt = null;
	writeSession(workspaceRoot, s);
	appendTaskEvent(workspaceRoot, taskId, "session_attached", {
		sessionId,
		mode,
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
	return writeSession(workspaceRoot, s);
}

export function findSessionByExternalId(workspaceRoot, externalHostSessionId) {
	if (!externalHostSessionId) return null;
	return (
		listSessions(workspaceRoot).find(
			(s) =>
				s.status === "active" &&
				s.externalHostSessionId &&
				String(s.externalHostSessionId) === String(externalHostSessionId),
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
