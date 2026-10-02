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
import { hashCanonicalPath, newGrantId, hashText } from "./ids.mjs";
import { evaluateGrantPolicy, actionMatchesPattern } from "./policy-composition.mjs";
import { appendJsonl, readText } from "./fs-atomic.mjs";

export const GRANT_SCHEMA_VERSION = 1;
const SCOPES = new Set(["once", "session", "workspace", "time"]);

/**
 * Consumption ledger for grant idempotency (issue #35): one host tool call may run
 * several identical PreToolUse hooks (Grok global + installed plugin), and each would
 * otherwise spend one `once` use of the same approval. The first consume of a call
 * writes a ledger record keyed on hostSessionId + toolCallId + action; later hooks
 * for the same key replay it instead of spending another use.
 */
const CONSUMPTION_LEDGER_TTL_MS = 24 * 60 * 60 * 1000;

function consumptionLedgerPath(workspaceRoot, options) {
	const paths = grantStorePaths(workspaceRoot, options);
	return join(paths.dir, "consumed.jsonl");
}

function pruneConsumptionLedger(entries, now = Date.now()) {
	const kept = [];
	for (const entry of entries) {
		const at = Date.parse(entry.consumedAt || "");
		if (!Number.isNaN(at) && now - at > CONSUMPTION_LEDGER_TTL_MS) continue;
		kept.push(entry);
	}
	return kept;
}

function readConsumptionLedger(workspaceRoot, options) {
	const path = consumptionLedgerPath(workspaceRoot, options);
	const text = readText(path, "");
	if (!text.trim()) return [];
	const entries = [];
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		try {
			const value = JSON.parse(line);
			if (value && typeof value === "object") entries.push(value);
		} catch {
			// A torn append never blocks the next evaluation; the store's use count
			// is the authority, the ledger only dedupes within one call.
		}
	}
	return entries;
}

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
	// Grant store is per workspace, not per execution (issue #35): a grant binds to
	// workspace + action + resource + usage/expiry, so every checkout of the same
	// workspace reads the same store. The caller's execution id stays on the paths
	// for matching explicitly pinned grants and for new pinned records.
	const dir = join(
		globalDataDir(env),
		"grants",
		"workspaces",
		workspaceKey,
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
	// Explicit execution pin (issue #35): null means the grant is usable from any
	// checkout of this workspace+resource. Passing an execution id narrows it.
	executionId = null,
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
			// Default grant model (issue #35): the grant binds to workspace + action +
			// resource + usage/expiry. An execution pin is an explicit narrower choice,
			// not the place the user happened to run `heli grant issue` from.
			executionId: executionId || null,
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
	// Execution pin (issue #35): only grants explicitly pinned to an execution are
	// execution-scoped. The default grant is usable from any checkout of the
	// workspace because it binds to workspace + action + resource + usage/expiry.
	if (grant.executionId && grant.executionId !== paths.executionId) return false;
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

/**
 * Read-only lookup used by the hook to decide: policy-permitted AND a matching
 * active grant exists. Never creates directories and never consumes a use.
 */
export function findUsableGrant(workspaceRoot, {
	action,
	sessionId = null,
	resource = null,
	env = process.env,
} = {}) {
	const policy = evaluateGrantPolicy(workspaceRoot, action, { env });
	if (!policy.grantable || policy.hardDenied) return null;
	return findApplicableGrant(workspaceRoot, { action, sessionId, resource, env });
}

/**
 * Read-only plan for several approvals of one call: for each request, in order, the grant
 * consuming would spend. Uses that earlier requests take are counted, so a `once` grant
 * (one use) is never counted for more requests than it can pay for. Entries are null where
 * no usable grant is left. Never creates directories and never consumes a use.
 * Requests are `{ action, sessionId, resource, callKey }` like findUsableGrant's.
 * A request whose callKey already sits in the consumption ledger is planned from the
 * recorded grant: this evaluation of the same tool call replays an earlier consume.
 */
export function findUsableGrants(workspaceRoot, requests = [], { env = process.env } = {}) {
	if (!requests.length) return [];
	const paths = grantStorePaths(workspaceRoot, { env });
	const store = readStore(workspaceRoot, { env });
	const ledger = pruneConsumptionLedger(readConsumptionLedger(workspaceRoot, { env }));
	const now = Date.now();
	const taken = new Map();
	return requests.map(({ action, sessionId = null, resource = null, callKey = null }) => {
		const policy = evaluateGrantPolicy(workspaceRoot, action, { env });
		if (!policy.grantable || policy.hardDenied) return null;
		if (callKey) {
			const replayed = ledger.find((entry) => entry.key === callKey);
			if (replayed) {
				const recorded = store.grants.find((grant) => grant.grantId === replayed.grantId);
				return recorded
					? { ...recorded, replayed: true }
					: { grantId: replayed.grantId, action, scope: "once", resource: replayed.resource || null, replayed: true };
			}
		}
		const grant = store.grants.find((candidate) =>
			grantMatches(candidate, { action, sessionId, resource, paths, now }) &&
			(candidate.scope !== "once" || Number(candidate.remainingUses || 0) > (taken.get(candidate.grantId) || 0)),
		);
		if (!grant) return null;
		taken.set(grant.grantId, (taken.get(grant.grantId) || 0) + 1);
		return grant;
	});
}

export function consumeApplicableGrant(workspaceRoot, {
	action,
	sessionId = null,
	resource = null,
	env = process.env,
	// Per-call identity from the host hook payload: one tool call may be evaluated
	// by more than one registered hook set. Same key replays the first consume.
	callKey = null,
} = {}) {
	const policy = evaluateGrantPolicy(workspaceRoot, action, { env });
	if (!policy.grantable || policy.hardDenied) return null;
	// Replay check BEFORE the active-grant probe: after the first hook of a call
	// spent the `once` use, the store holds no active grant for the action, so the
	// probe below would return null and the second hook would wrongly deny.
	if (callKey) {
		const replayed = pruneConsumptionLedger(readConsumptionLedger(workspaceRoot, { env }))
			.find((entry) => entry.key === callKey);
		if (replayed) {
			const grantRecord = readStore(workspaceRoot, { env }).grants.find((grant) => grant.grantId === replayed.grantId);
			return grantRecord
				? { ...grantRecord, replayed: true }
				: { grantId: replayed.grantId, action, scope: "once", resource: replayed.resource || null, replayed: true };
		}
	}
	// Read-only probe first: hooks call this on every guarded action, and the
	// mutex below creates the grant-store directory. No matching grant means
	// nothing to consume, so never touch the filesystem in that case.
	if (!findApplicableGrant(workspaceRoot, { action, sessionId, resource, env })) return null;
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
			if (callKey) {
				appendJsonl(consumptionLedgerPath(workspaceRoot, { env }), {
					schemaVersion: 1,
					key: callKey,
					grantId: grant.grantId,
					action,
					resource: grant.resource,
					consumedAt: new Date().toISOString(),
				});
			}
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
