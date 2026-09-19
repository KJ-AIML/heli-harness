/**
 * Global distribution + explicit project binding for Heli.
 *
 * Project identity is committed under .heli/. Operational authority is local to
 * one execution namespace under HELI_DATA_DIR (default ~/.heli). The optional
 * registry is only a locator cache and is never consulted to grant authority.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, normalize, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { ensureDir, readJson, safeRealpath, writeJsonAtomic } from "./fs-atomic.mjs";

export const PROJECT_BINDING_SCHEMA_VERSION = 1;
export const HELI_LOCK_SCHEMA_VERSION = 1;
export const GLOBAL_STATE_SCHEMA_VERSION = 1;

function fail(code, message) {
	const error = new Error(message);
	error.code = code;
	throw error;
}

function plainObject(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
	return typeof value === "string" && value.trim().length > 0;
}

function validateRelativeResourcePath(resourceId, value) {
	if (!nonEmptyString(value)) {
		fail("INVALID_PROJECT_RESOURCE", `resource ${resourceId} path must be a non-empty relative path`);
	}
	if (isAbsolute(value)) {
		fail("ABSOLUTE_PROJECT_RESOURCE", `resource ${resourceId} must not contain an absolute machine path`);
	}
	const normalized = normalize(value).replaceAll("\\", "/");
	if (normalized === ".." || normalized.startsWith("../")) {
		fail("PROJECT_RESOURCE_ESCAPE", `resource ${resourceId} escapes the project root`);
	}
	return normalized || ".";
}

export function validateWorkspaceManifest(manifest) {
	if (!plainObject(manifest)) fail("INVALID_WORKSPACE_MANIFEST", "workspace manifest must be an object");
	if (manifest.schemaVersion !== PROJECT_BINDING_SCHEMA_VERSION) {
		fail("UNSUPPORTED_WORKSPACE_SCHEMA", `unsupported workspace schema: ${manifest.schemaVersion}`);
	}
	if (!nonEmptyString(manifest.workspaceId)) fail("INVALID_WORKSPACE_ID", "workspaceId must be a non-empty string");
	if (manifest.mode != null && !["concurrent", "legacy"].includes(String(manifest.mode))) {
		fail("INVALID_WORKSPACE_MODE", `unsupported workspace mode: ${manifest.mode}`);
	}
	if (!Array.isArray(manifest.resources) || manifest.resources.length === 0) {
		fail("INVALID_PROJECT_RESOURCES", "workspace manifest must declare at least one resource");
	}
	for (const forbidden of [
		"sessions",
		"leases",
		"grants",
		"runtimeCapabilities",
		"credentials",
		"processHandles",
		"activeTask",
		"activeTarget",
		"bindings",
	]) {
		if (Object.hasOwn(manifest, forbidden)) {
			fail(
				"MUTABLE_AUTHORITY_IN_PROJECT_BINDING",
				`${forbidden} is operational authority and must not be committed in workspace.json`,
			);
		}
	}
	const ids = new Set();
	const resources = manifest.resources.map((resource) => {
		if (!plainObject(resource)) fail("INVALID_PROJECT_RESOURCE", "workspace resources must be objects");
		if (!nonEmptyString(resource.id)) fail("INVALID_RESOURCE_ID", "resource id must be a non-empty string");
		if (ids.has(resource.id)) fail("DUPLICATE_RESOURCE_ID", `duplicate resource id: ${resource.id}`);
		ids.add(resource.id);
		if (!nonEmptyString(resource.type)) fail("INVALID_RESOURCE_TYPE", `resource ${resource.id} type required`);
		return {
			id: resource.id.trim(),
			type: resource.type.trim(),
			path: validateRelativeResourcePath(resource.id, resource.path),
		};
	});
	return {
		schemaVersion: PROJECT_BINDING_SCHEMA_VERSION,
		workspaceId: manifest.workspaceId.trim(),
		mode: manifest.mode === "legacy" ? "legacy" : "concurrent",
		resources,
		policyProfile: nonEmptyString(manifest.policyProfile) ? manifest.policyProfile.trim() : "default",
		...(manifest.createdAt ? { createdAt: manifest.createdAt } : {}),
		...(plainObject(manifest.provenance) ? { provenance: { ...manifest.provenance } } : {}),
	};
}

export function validateHeliLock(lock) {
	if (!plainObject(lock)) fail("INVALID_HELI_LOCK", "heli.lock must be an object");
	if (lock.schemaVersion !== HELI_LOCK_SCHEMA_VERSION) {
		fail("UNSUPPORTED_HELI_LOCK_SCHEMA", `unsupported heli.lock schema: ${lock.schemaVersion}`);
	}
	for (const forbidden of [
		"credentials",
		"secrets",
		"sessions",
		"leases",
		"grants",
		"runtimeCapabilities",
		"bindings",
		"activeTask",
	]) {
		if (Object.hasOwn(lock, forbidden)) {
			fail("MUTABLE_AUTHORITY_IN_HELI_LOCK", `${forbidden} must not be stored in heli.lock`);
		}
	}
	if (!plainObject(lock.runtime) || !nonEmptyString(lock.runtime.package) || !nonEmptyString(lock.runtime.version)) {
		fail("INVALID_RUNTIME_LOCK", "heli.lock runtime package/version are required");
	}
	for (const field of [
		"protocolVersion",
		"workspaceSchemaVersion",
		"adapterContractVersion",
		"policySchemaVersion",
	]) {
		if (!Number.isInteger(lock[field]) || lock[field] < 1) {
			fail("INVALID_HELI_LOCK_PIN", `${field} must be a positive integer`);
		}
	}
	return {
		schemaVersion: HELI_LOCK_SCHEMA_VERSION,
		runtime: {
			package: lock.runtime.package.trim(),
			version: lock.runtime.version.trim(),
		},
		protocolVersion: lock.protocolVersion,
		workspaceSchemaVersion: lock.workspaceSchemaVersion,
		adapterContractVersion: lock.adapterContractVersion,
		policySchemaVersion: lock.policySchemaVersion,
		...(lock.generatedAt ? { generatedAt: lock.generatedAt } : {}),
	};
}

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
	const path = workspaceManifestPath(workspaceRoot);
	if (!existsSync(path)) return null;
	const value = readJson(path, null);
	if (value == null) fail("INVALID_WORKSPACE_MANIFEST", `workspace manifest is unreadable: ${path}`);
	return validateWorkspaceManifest(value);
}

export function readWorkspaceLock(workspaceRoot) {
	const path = workspaceLockPath(workspaceRoot);
	if (!existsSync(path)) return null;
	const value = readJson(path, null);
	if (value == null) fail("INVALID_HELI_LOCK", `heli.lock is unreadable: ${path}`);
	return validateHeliLock(value);
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
