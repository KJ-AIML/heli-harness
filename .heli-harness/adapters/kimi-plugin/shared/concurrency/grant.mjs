/**
 * Scoped grants live outside project-controlled files.
 *
 * Every grant is bound to the local execution identity. A committed workspace
 * id alone never activates a grant in another checkout or machine.
 */
import { join } from "node:path";
import {
	claimDirExclusive,
	ensureDir,
	pathExists,
	readJson,
	releaseDir,
	writeJsonAtomic,
} from "./fs-atomic.mjs";
import {
	globalDataDir,
	projectWorkspaceKey,
	resolveExecutionIdentity,
} from "./project-binding.mjs";
import { canonicalizePath } from "./paths.mjs";
import { hashCanonicalPath, newGrantId } from "./ids.mjs";
import { evaluateGrantPolicy, actionMatchesPattern } from "./policy-composition.mjs";

export const GRANT_SCHEMA_VERSION = 1;
const SCOPES = new Set(["once", "session", "workspace", "time"]);

function error(code, message, extra = {}) {
	const value = new Error(message);
	value.code = code;
	Object.assign(value, extra);
	return value;
}

export function localExecutionGrantIdentity(workspaceRoot, { env = process.env } = {}) {
	const linked = resolveExecutionIdentity(workspaceRoot, { env });
	if (linked) return linked.executionId;
	return `heli-exec-embedded-${hashCanonicalPath(canonicalizePath(workspaceRoot))}`;
}

export function grantStorePaths(workspaceRoot, { env = process.env } = {}) {
	const workspaceKey = projectWorkspaceKey(workspaceRoot, { env });
	const executionId = localExecutionGrantIdentity(workspaceRoot, { env });
	const dir = join(
		globalDataDir(env),
		"grants",
		"workspaces",
		workspaceKey,
		"executions",
		executionId,
	);
	return {
		workspaceKey,
		executionId,
		dir,
		storePath: join(dir, "grants.json"),
		mutexDir: join(dir, ".mutex"),
	};
}

function readStore(workspaceRoot, options = {}) {
	const paths = grantStorePaths(workspaceRoot, options);
	const value = readJson(paths.storePath, null);
	return value && Array.isArray(value.grants)
		? { ...value, grants: value.grants.map((grant) => ({ ...grant })) }
		: { schemaVersion: GRANT_SCHEMA_VERSION, grants: [] };
}

function writeStore(workspaceRoot, store, options = {}) {
	const paths = grantStorePaths(workspaceRoot, options);
	ensureDir(paths.dir);
	writeJsonAtomic(paths.storePath, { schemaVersion: GRANT_SCHEMA_VERSION, grants: store.grants || [] });
	return paths;
}

function withGrantMutex(workspaceRoot, fn, options = {}) {
	const paths = grantStorePaths(workspaceRoot, options);
	ensureDir(paths.dir);
	const claim = claimDirExclusive(paths.mutexDir);
	if (!claim.ok) throw error("GRANT_STORE_BUSY", "grant store transition already in progress");
	try {
		return fn(paths);
	} finally {
		releaseDir(paths.mutexDir);
	}
}

function normalizeResource(resource, paths) {
	if (!resource || typeof resource !== "object") {
		return { type: "workspace", id: paths.workspaceKey };
	}
	const type = String(resource.type || "workspace");
	const id = String(resource.id || (type === "workspace" ? paths.workspaceKey : ""));
	if (!id) throw error("INVALID_GRANT_RESOURCE", "grant resource id required");
	return { type, id };
}

function expiresAtFor({ scope, expiresAt = null, ttlSeconds = null }) {
	if (expiresAt) {
		const parsed = Date.parse(expiresAt);
		if (Number.isNaN(parsed)) throw error("INVALID_GRANT_EXPIRY", "expiresAt must be an ISO-compatible date");
		return new Date(parsed).toISOString();
	}
	const ttl = Number(ttlSeconds);
	if (Number.isFinite(ttl) && ttl > 0) return new Date(Date.now() + ttl * 1000).toISOString();
	if (scope === "time") return new Date(Date.now() + 3600_000).toISOString();
	return null;
}

export function issueGrant(workspaceRoot, {
	issuer = "local-user",
	action,
	resource = null,
	scope = "once",
	subjectSessionId = null,
	expiresAt = null,
	ttlSeconds = null,
	reason = null,
	env = process.env,
} = {}) {
	if (!action) throw error("GRANT_ACTION_REQUIRED", "grant action required");
	if (!SCOPES.has(scope)) throw error("INVALID_GRANT_SCOPE", `invalid grant scope: ${scope}`);
	if (scope === "session" && !subjectSessionId) {
		throw error("GRANT_SESSION_REQUIRED", "session-scoped grant requires subjectSessionId");
	}
	const policy = evaluateGrantPolicy(workspaceRoot, action, { env });
	if (!policy.grantable || policy.hardDenied) {
		throw error(
			"GRANT_NOT_PERMITTED",
			`trusted policy does not permit grants for ${action}: ${policy.reasons.join(", ") || "outside ceiling"}`,
			{ policy },
		);
	}
	return withGrantMutex(workspaceRoot, (paths) => {
		const store = readStore(workspaceRoot, { env });
		const now = new Date().toISOString();
		const grant = {
			schemaVersion: GRANT_SCHEMA_VERSION,
			grantId: newGrantId(),
			issuer,
			action: String(action),
			resource: normalizeResource(resource, paths),
			scope,
			subjectSessionId: subjectSessionId || null,
			executionId: paths.executionId,
			workspaceKey: paths.workspaceKey,
			issuedAt: now,
			expiresAt: expiresAtFor({ scope, expiresAt, ttlSeconds }),
			remainingUses: scope === "once" ? 1 : null,
			revokedAt: null,
			consumedAt: null,
			reason: reason || null,
		};
		store.grants.push(grant);
		writeStore(workspaceRoot, store, { env });
		return grant;
	}, { env });
}

function activeGrant(grant, now = Date.now()) {
	if (!grant || grant.revokedAt) return false;
	if (grant.expiresAt) {
		const exp = Date.parse(grant.expiresAt);
		if (!Number.isNaN(exp) && now > exp) return false;
	}
	if (grant.scope === "once" && Number(grant.remainingUses || 0) <= 0) return false;
	return true;
}

function resourceMatches(grantResource, requested, workspaceKey) {
	if (!grantResource) return false;
	if (grantResource.type === "workspace" && grantResource.id === workspaceKey) return true;
	return grantResource.type === requested?.type && grantResource.id === requested?.id;
}

function grantMatches(grant, {
	action,
	sessionId = null,
	resource = null,
	paths,
	now = Date.now(),
}) {
	if (!activeGrant(grant, now)) return false;
	if (grant.executionId !== paths.executionId) return false;
	if (!actionMatchesPattern(action, grant.action) && !actionMatchesPattern(grant.action, action)) return false;
	if (!resourceMatches(grant.resource, resource, paths.workspaceKey)) return false;
	if (grant.scope === "session" && grant.subjectSessionId !== sessionId) return false;
	return true;
}

export function listGrants(workspaceRoot, {
	activeOnly = false,
	env = process.env,
} = {}) {
	const store = readStore(workspaceRoot, { env });
	return store.grants.filter((grant) => !activeOnly || activeGrant(grant));
}

export function findApplicableGrant(workspaceRoot, {
	action,
	sessionId = null,
	resource = null,
	env = process.env,
} = {}) {
	const paths = grantStorePaths(workspaceRoot, { env });
	const store = readStore(workspaceRoot, { env });
	return store.grants.find((grant) =>
		grantMatches(grant, { action, sessionId, resource, paths }),
	) || null;
}

export function consumeApplicableGrant(workspaceRoot, {
	action,
	sessionId = null,
	resource = null,
	env = process.env,
} = {}) {
	const policy = evaluateGrantPolicy(workspaceRoot, action, { env });
	if (!policy.grantable || policy.hardDenied) return null;
	return withGrantMutex(workspaceRoot, (paths) => {
		const store = readStore(workspaceRoot, { env });
		const index = store.grants.findIndex((grant) =>
			grantMatches(grant, { action, sessionId, resource, paths }),
		);
		if (index < 0) return null;
		const grant = { ...store.grants[index] };
		if (grant.scope === "once") {
			grant.remainingUses = Math.max(0, Number(grant.remainingUses || 0) - 1);
			if (grant.remainingUses === 0) grant.consumedAt = new Date().toISOString();
			store.grants[index] = grant;
			writeStore(workspaceRoot, store, { env });
		}
		return grant;
	}, { env });
}

export function revokeGrant(workspaceRoot, grantId, {
	env = process.env,
} = {}) {
	if (!grantId) throw error("GRANT_ID_REQUIRED", "grant id required");
	return withGrantMutex(workspaceRoot, () => {
		const store = readStore(workspaceRoot, { env });
		const index = store.grants.findIndex((grant) => grant.grantId === grantId);
		if (index < 0) throw error("GRANT_NOT_FOUND", `grant not found: ${grantId}`);
		const grant = { ...store.grants[index], revokedAt: new Date().toISOString() };
		store.grants[index] = grant;
		writeStore(workspaceRoot, store, { env });
		return grant;
	}, { env });
}
