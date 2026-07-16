import { ensureDir, pathExists, readJson, writeJsonAtomic, listFileNames } from "./fs-atomic.mjs";
import { bindingPath, pathsFor, canonicalizePath } from "./paths.mjs";
import { join } from "node:path";

export function readBinding(workspaceRoot, worktreePath) {
	const canonical = canonicalizePath(worktreePath);
	const p = bindingPath(workspaceRoot, canonical);
	return readJson(p, null);
}

export function writeBinding(workspaceRoot, {
	worktreePath,
	taskId = null,
	sessionId = null,
	host = null,
	mode = null,
}) {
	const canonical = canonicalizePath(worktreePath);
	const { bindingsDir } = pathsFor(workspaceRoot);
	ensureDir(bindingsDir);
	const existing = readBinding(workspaceRoot, canonical) || {
		schemaVersion: 1,
		canonicalWorktreePath: canonical,
		hostBindings: {},
	};
	const next = {
		...existing,
		schemaVersion: 1,
		canonicalWorktreePath: canonical,
		taskId: taskId != null ? taskId : existing.taskId || null,
		defaultSessionId: sessionId != null ? sessionId : existing.defaultSessionId || null,
		updatedAt: new Date().toISOString(),
		hostBindings: { ...(existing.hostBindings || {}) },
	};
	if (host && sessionId) {
		next.hostBindings[host] = {
			sessionId,
			mode: mode || null,
			updatedAt: next.updatedAt,
		};
	}
	writeJsonAtomic(bindingPath(workspaceRoot, canonical), next);
	return next;
}

export function clearBindingSession(workspaceRoot, worktreePath, sessionId) {
	const b = readBinding(workspaceRoot, worktreePath);
	if (!b) return null;
	if (b.defaultSessionId === sessionId) b.defaultSessionId = null;
	if (b.hostBindings) {
		for (const [host, info] of Object.entries(b.hostBindings)) {
			if (info?.sessionId === sessionId) delete b.hostBindings[host];
		}
	}
	b.updatedAt = new Date().toISOString();
	writeJsonAtomic(bindingPath(workspaceRoot, canonicalizePath(worktreePath)), b);
	return b;
}

export function listAllBindings(workspaceRoot) {
	const { bindingsDir } = pathsFor(workspaceRoot);
	if (!pathExists(bindingsDir)) return [];
	return listFileNames(bindingsDir, { suffix: ".json" })
		.map((name) => readJson(join(bindingsDir, name), null))
		.filter(Boolean);
}
