import { pathExists, readJson, writeJsonAtomic, ensureDir } from "./fs-atomic.mjs";
import { pathsFor } from "./paths.mjs";
import { readProjectBinding } from "./project-binding.mjs";

export const WORKSPACE_SCHEMA_VERSION = 1;
export const TASK_SCHEMA_VERSION = 1;
export const SESSION_SCHEMA_VERSION = 2;
export const LEASE_SCHEMA_VERSION = 1;

export function readWorkspaceSchema(workspaceRoot) {
	const { schemaPath } = pathsFor(workspaceRoot);
	if (!pathExists(schemaPath)) {
		const binding = readProjectBinding(workspaceRoot);
		if (binding) {
			return {
				schemaVersion: WORKSPACE_SCHEMA_VERSION,
				mode: binding.mode === "legacy" ? "legacy" : "concurrent",
				exists: false,
				linkedDefault: true,
			};
		}
		return { schemaVersion: WORKSPACE_SCHEMA_VERSION, mode: "legacy", exists: false };
	}
	const data = readJson(schemaPath, null);
	if (!data) {
		return { schemaVersion: WORKSPACE_SCHEMA_VERSION, mode: "concurrent", exists: true, malformed: true };
	}
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
