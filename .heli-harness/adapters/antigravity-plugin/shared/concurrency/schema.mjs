import { pathExists, readJson, writeJsonAtomic, ensureDir } from "./fs-atomic.mjs";
import { pathsFor } from "./paths.mjs";

export const WORKSPACE_SCHEMA_VERSION = 1;
export const TASK_SCHEMA_VERSION = 1;
export const SESSION_SCHEMA_VERSION = 1;
export const LEASE_SCHEMA_VERSION = 1;

export function readWorkspaceSchema(workspaceRoot) {
	const { schemaPath } = pathsFor(workspaceRoot);
	if (!pathExists(schemaPath)) {
		return { schemaVersion: WORKSPACE_SCHEMA_VERSION, mode: "legacy", exists: false };
	}
	const data = readJson(schemaPath, null);
	if (!data) {
		// Fail closed: a schema file that exists but cannot be read must not
		// silently downgrade to legacy (which disables all lease enforcement).
		return { schemaVersion: WORKSPACE_SCHEMA_VERSION, mode: "concurrent", exists: true, malformed: true };
	}
	// Only an explicit "legacy" opts out of enforcement; unknown values fail closed.
	const mode = data.mode === "legacy" ? "legacy" : "concurrent";
	return {
		schemaVersion: data.schemaVersion || WORKSPACE_SCHEMA_VERSION,
		mode,
		exists: true,
		data,
	};
}

export function writeWorkspaceSchema(workspaceRoot, { mode = "legacy" } = {}) {
	const { schemaPath, workspaceDir } = pathsFor(workspaceRoot);
	ensureDir(workspaceDir);
	const payload = {
		schemaVersion: WORKSPACE_SCHEMA_VERSION,
		mode: mode === "concurrent" ? "concurrent" : "legacy",
		updatedAt: new Date().toISOString(),
	};
	writeJsonAtomic(schemaPath, payload);
	return payload;
}

export function isConcurrentMode(workspaceRoot) {
	return readWorkspaceSchema(workspaceRoot).mode === "concurrent";
}
