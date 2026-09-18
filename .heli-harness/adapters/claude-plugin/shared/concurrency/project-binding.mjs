/**
 * Global distribution + explicit project binding for Heli.
 *
 * Project identity is committed under .heli/. Operational authority is local to
 * one execution namespace under HELI_DATA_DIR (default ~/.heli). The optional
 * registry is only a locator cache and is never consulted to grant authority.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { ensureDir, readJson, safeRealpath, writeJsonAtomic } from "./fs-atomic.mjs";

export const PROJECT_BINDING_SCHEMA_VERSION = 1;
export const HELI_LOCK_SCHEMA_VERSION = 1;
export const GLOBAL_STATE_SCHEMA_VERSION = 1;

function canonicalLocalPath(value) {
	let out = safeRealpath(resolve(String(value || "."))).replaceAll("\\", "/");
	if (process.platform === "win32") out = out.toLowerCase();
	if (out.length > 1 && out.endsWith("/")) out = out.slice(0, -1);
	return out;
}

function hash(value, length = 24) {
	return createHash("sha256").update(String(value)).digest("hex").slice(0, length);
}

function safeIdentity(value, fallback = "workspace") {
	const normalized = String(value || "")
		.trim()
		.replace(/[^A-Za-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return normalized || fallback;
}

export function globalConfigDir(env = process.env) {
	return resolve(env.HELI_CONFIG_DIR || join(homedir(), ".heli"));
}

export function globalDataDir(env = process.env) {
	return resolve(env.HELI_DATA_DIR || globalConfigDir(env));
}

export function machineIdentityPath(env = process.env) {
	return join(globalConfigDir(env), "machine.json");
}

export function readMachineIdentity(env = process.env) {
	const value = readJson(machineIdentityPath(env), null);
	return value && typeof value === "object" && value.machineId ? value : null;
}

export function ensureGlobalSetup(env = process.env) {
	const configDir = globalConfigDir(env);
	const dataDir = globalDataDir(env);
	ensureDir(configDir);
	ensureDir(join(dataDir, "state", "workspaces"));
	ensureDir(join(dataDir, "grants", "workspaces"));
	ensureDir(join(dataDir, "registry"));
	let machine = readMachineIdentity(env);
	if (!machine) {
		machine = {
			schemaVersion: 1,
			machineId: `heli-machine-${randomUUID()}`,
			createdAt: new Date().toISOString(),
		};
		writeJsonAtomic(machineIdentityPath(env), machine);
	}
	const registry = workspaceRegistryPath(env);
	if (!existsSync(registry)) {
		writeJsonAtomic(registry, { schemaVersion: 1, workspaces: [] });
	}
	return { configDir, dataDir, machine, registryPath: registry };
}

export function projectConfigDir(workspaceRoot) {
	return join(workspaceRoot, ".heli");
}

export function workspaceManifestPath(workspaceRoot) {
	return join(projectConfigDir(workspaceRoot), "workspace.json");
}

export function workspaceLockPath(workspaceRoot) {
	return join(projectConfigDir(workspaceRoot), "heli.lock");
}

export function readProjectBinding(workspaceRoot) {
	const value = readJson(workspaceManifestPath(workspaceRoot), null);
	if (!value || typeof value !== "object" || !value.workspaceId) return null;
	return value;
}

export function readWorkspaceLock(workspaceRoot) {
	const value = readJson(workspaceLockPath(workspaceRoot), null);
	return value && typeof value === "object" ? value : null;
}

export function hasProjectBindingFile(workspaceRoot) {
	return existsSync(workspaceManifestPath(workspaceRoot));
}

export function isLinkedWorkspace(workspaceRoot) {
	return Boolean(readProjectBinding(workspaceRoot));
}

export function resolveExecutionIdentity(workspaceRoot, { env = process.env } = {}) {
	const binding = readProjectBinding(workspaceRoot);
	if (!binding) return null;
	const machine = readMachineIdentity(env);
	const machineId =
		machine?.machineId ||
		`heli-machine-uninitialized-${hash(globalConfigDir(env), 16)}`;
	const canonicalWorkspaceRoot = canonicalLocalPath(workspaceRoot);
	const executionId = `heli-exec-${hash(
		`${machineId}|${binding.workspaceId}|${canonicalWorkspaceRoot}`,
	)}`;
	return {
		workspaceId: binding.workspaceId,
		machineId,
		machineInitialized: Boolean(machine?.machineId),
		executionId,
		canonicalWorkspaceRoot,
	};
}

export function linkedOperationalRoot(workspaceRoot, { env = process.env } = {}) {
	const identity = resolveExecutionIdentity(workspaceRoot, { env });
	if (!identity) return null;
	return join(
		globalDataDir(env),
		"state",
		"workspaces",
		safeIdentity(identity.workspaceId),
		"executions",
		safeIdentity(identity.executionId),
		"heli",
	);
}

export function resolveWorkspaceLayout(workspaceRoot, { env = process.env } = {}) {
	const binding = readProjectBinding(workspaceRoot);
	if (!binding) {
		return {
			mode: "embedded",
			workspaceRoot: canonicalLocalPath(workspaceRoot),
			projectConfigDir: join(workspaceRoot, ".heli-harness"),
			operationalRoot: join(workspaceRoot, ".heli-harness"),
			binding: null,
			lock: null,
			execution: null,
		};
	}
	return {
		mode: "linked",
		workspaceRoot: canonicalLocalPath(workspaceRoot),
		projectConfigDir: projectConfigDir(workspaceRoot),
		operationalRoot: linkedOperationalRoot(workspaceRoot, { env }),
		binding,
		lock: readWorkspaceLock(workspaceRoot),
		execution: resolveExecutionIdentity(workspaceRoot, { env }),
	};
}

export function workspaceRegistryPath(env = process.env) {
	return join(globalDataDir(env), "registry", "workspaces.json");
}

export function readWorkspaceRegistry(env = process.env) {
	const value = readJson(workspaceRegistryPath(env), { schemaVersion: 1, workspaces: [] });
	return value && Array.isArray(value.workspaces)
		? value
		: { schemaVersion: 1, workspaces: [] };
}

export function registerWorkspace(workspaceRoot, { env = process.env } = {}) {
	const binding = readProjectBinding(workspaceRoot);
	const execution = resolveExecutionIdentity(workspaceRoot, { env });
	if (!binding || !execution) return null;
	const registry = readWorkspaceRegistry(env);
	const canonicalPath = execution.canonicalWorkspaceRoot;
	const rest = registry.workspaces.filter(
		(item) =>
			!(item.workspaceId === binding.workspaceId && item.path === canonicalPath),
	);
	const record = {
		workspaceId: binding.workspaceId,
		path: canonicalPath,
		executionId: execution.executionId,
		lastSeenAt: new Date().toISOString(),
	};
	const next = { schemaVersion: 1, workspaces: [...rest, record] };
	ensureDir(join(globalDataDir(env), "registry"));
	writeJsonAtomic(workspaceRegistryPath(env), next);
	return record;
}

export function projectPolicyDir(workspaceRoot) {
	return join(projectConfigDir(workspaceRoot), "policies");
}

export function projectSafetyDir(workspaceRoot) {
	return join(projectConfigDir(workspaceRoot), "safety");
}

export function projectProfilesDir(workspaceRoot) {
	return join(projectConfigDir(workspaceRoot), "profiles");
}

export function projectSkillsDir(workspaceRoot) {
	return join(projectConfigDir(workspaceRoot), "skills");
}

export function projectWorkspaceKey(workspaceRoot, { env = process.env } = {}) {
	const binding = readProjectBinding(workspaceRoot);
	if (binding?.workspaceId) return safeIdentity(binding.workspaceId);
	return `embedded-${hash(canonicalLocalPath(workspaceRoot))}`;
}

export function readPackageVersion(packageJsonPath) {
	try {
		const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
		return pkg?.version || "unknown";
	} catch {
		return "unknown";
	}
}
