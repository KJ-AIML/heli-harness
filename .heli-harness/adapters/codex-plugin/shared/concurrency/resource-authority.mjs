/**
 * Resource-scoped cooperative write authority for linked workspaces.
 *
 * One canonical worktree resource maps to one lock directory. Task ids are
 * provenance only; they are not the exclusivity key. Transitions are serialized
 * by a short-lived local mutex. This is cooperative local authority, not an OS
 * sandbox or remote fencing mechanism.
 */
import { dirname, join } from "node:path";
import {
	claimDirExclusive,
	ensureDir,
	listDirNames,
	pathExists,
	readJson,
	releaseDir,
	writeJsonAtomic,
} from "./fs-atomic.mjs";
import { canonicalizePath, pathsFor } from "./paths.mjs";
import { hashCanonicalPath, newLeaseId } from "./ids.mjs";
import { LEASE_SCHEMA_VERSION } from "./schema.mjs";
import { appendTaskEvent } from "./events.mjs";

export const RESOURCE_AUTHORITY_SCHEMA_VERSION = 1;

function error(code, message, extra = {}) {
	const value = new Error(message);
	value.code = code;
	Object.assign(value, extra);
	return value;
}

export function resourceIdForWorktree(worktreePath) {
	const canonical = canonicalizePath(worktreePath || "");
	if (!canonical) return null;
	return `worktree-${hashCanonicalPath(canonical)}`;
}

export function resourceAuthorityPaths(workspaceRoot, worktreePath) {
	const canonical = canonicalizePath(worktreePath || "");
	const resourceId = resourceIdForWorktree(canonical);
	if (!resourceId) return null;
	const root = pathsFor(workspaceRoot);
	const lockDir = join(root.resourceLocksDir, `${resourceId}.write.lock`);
	return {
		resourceId,
		canonicalWorktreePath: canonical,
		lockDir,
		leasePath: join(lockDir, "lease.json"),
		mutexDir: join(root.heliDir, "locks", "mutex", `${resourceId}.mutex`),
	};
}

function parseResourceLease(path, expected = {}) {
	if (!pathExists(path)) return null;
	const raw = readJson(path, null);
	if (!raw || typeof raw !== "object") {
		return { invalid: true, path, reason: "unreadable or non-object resource lease" };
	}
	if (!raw.sessionId || !raw.leaseId || !raw.expiresAt || !raw.resource?.id) {
		return {
			invalid: true,
			path,
			reason: "resource lease missing required fields (sessionId, leaseId, expiresAt, resource.id)",
			raw,
		};
	}
	if (expected.resourceId && raw.resource.id !== expected.resourceId) {
		return { invalid: true, path, reason: "resource id/path mismatch", raw };
	}
	return raw;
}

export function isResourceLeaseExpired(lease, now = Date.now()) {
	if (!lease?.expiresAt) return false;
	const exp = Date.parse(lease.expiresAt);
	return Number.isFinite(exp) && now > exp;
}

export function readResourceLeaseForWorktree(workspaceRoot, worktreePath) {
	const paths = resourceAuthorityPaths(workspaceRoot, worktreePath);
	if (!paths) return null;
	return parseResourceLease(paths.leasePath, { resourceId: paths.resourceId });
}

export function listResourceLeases(workspaceRoot) {
	const { resourceLocksDir } = pathsFor(workspaceRoot);
	if (!pathExists(resourceLocksDir)) return [];
	const leases = [];
	for (const name of listDirNames(resourceLocksDir)) {
		if (!name.endsWith(".write.lock")) continue;
		const path = join(resourceLocksDir, name, "lease.json");
		const lease = parseResourceLease(path);
		if (lease) leases.push(lease);
	}
	return leases;
}

export function readResourceLeaseForTask(workspaceRoot, taskId) {
	if (!taskId) return null;
	const leases = listResourceLeases(workspaceRoot);
	const valid = leases.find((lease) => !lease.invalid && lease.taskId === taskId);
	if (valid) return valid;
	// Preserve malformed-state truthfulness when the raw payload still identifies
	// the task; callers can then fail closed as MALFORMED_LEASE.
	return leases.find(
		(lease) => lease.invalid && String(lease.raw?.taskId || "") === String(taskId),
	) || null;
}

function withResourceMutex(paths, fn) {
	ensureDir(dirname(paths.mutexDir));
	const claimed = claimDirExclusive(paths.mutexDir);
	if (!claimed.ok) {
		throw error(
			"AUTHORITY_BUSY",
			`resource authority transition already in progress for ${paths.resourceId}`,
		);
	}
	try {
		return fn();
	} finally {
		releaseDir(paths.mutexDir);
	}
}

function ttlValue(ttlSeconds, fallback = 14400) {
	const value = Number(ttlSeconds);
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

function buildLease({
	taskId,
	sessionId,
	paths,
	ttlSeconds,
	generation = 1,
	revision = 1,
	previousLeaseId = null,
}) {
	const now = new Date();
	const ttl = ttlValue(ttlSeconds);
	const acquiredAt = now.toISOString();
	return {
		schemaVersion: LEASE_SCHEMA_VERSION,
		authoritySchemaVersion: RESOURCE_AUTHORITY_SCHEMA_VERSION,
		authorityClass: "cooperative-local",
		leaseId: newLeaseId(),
		previousLeaseId,
		taskId: taskId || null,
		sessionId,
		mode: "write",
		resource: {
			type: "worktree",
			id: paths.resourceId,
			canonicalPath: paths.canonicalWorktreePath,
		},
		worktreePath: paths.canonicalWorktreePath,
		generation,
		acquiredAt,
		lastActivityAt: acquiredAt,
		expiresAt: new Date(now.getTime() + ttl * 1000).toISOString(),
		ttlSeconds: ttl,
		revision,
	};
}

function writeLease(paths, lease) {
	ensureDir(paths.lockDir);
	writeJsonAtomic(paths.leasePath, lease);
	return lease;
}

export function findActiveResourceLeaseForWorktree(
	workspaceRoot,
	worktreePath,
	{ exceptSessionId = null } = {},
) {
	const lease = readResourceLeaseForWorktree(workspaceRoot, worktreePath);
	if (!lease || lease.invalid || isResourceLeaseExpired(lease)) return null;
	if (exceptSessionId && lease.sessionId === exceptSessionId) return null;
	return { taskId: lease.taskId, lease };
}

export function acquireResourceWriteAuthority(workspaceRoot, {
	taskId,
	sessionId,
	worktreePath,
	ttlSeconds = 14400,
} = {}) {
	if (!sessionId || !worktreePath) {
		throw error("INVALID_LEASE_ARGS", "sessionId and worktreePath required for resource authority; taskId is optional provenance");
	}
	const paths = resourceAuthorityPaths(workspaceRoot, worktreePath);
	return withResourceMutex(paths, () => {
		const existing = parseResourceLease(paths.leasePath, { resourceId: paths.resourceId });
		if (existing?.invalid) {
			throw error("MALFORMED_LEASE", existing.reason, { lease: existing });
		}
		if (existing && !isResourceLeaseExpired(existing)) {
			if (existing.sessionId === sessionId) {
				const now = new Date();
				const ttl = ttlValue(ttlSeconds, existing.ttlSeconds || 14400);
				const refreshed = {
					...existing,
					lastActivityAt: now.toISOString(),
					expiresAt: new Date(now.getTime() + ttl * 1000).toISOString(),
					ttlSeconds: ttl,
					revision: (existing.revision || 0) + 1,
				};
				writeJsonAtomic(paths.leasePath, refreshed);
				if (taskId) appendTaskEvent(workspaceRoot, taskId, "resource_authority_refreshed", {
					sessionId,
					resource: refreshed.resource,
					generation: refreshed.generation,
					leaseId: refreshed.leaseId,
				});
				return refreshed;
			}
			throw error(
				"WORKTREE_WRITER_HELD",
				`worktree resource already held by ${existing.taskId ? `task ${existing.taskId}, ` : ""}session ${existing.sessionId}`,
				{ lease: existing, taskId: existing.taskId },
			);
		}
		if (existing && isResourceLeaseExpired(existing)) {
			if (existing.sessionId !== sessionId) {
				throw error(
					"STALE_LEASE",
					`stale resource authority from ${existing.taskId ? `task ${existing.taskId}, ` : ""}session ${existing.sessionId}; explicit takeover required`,
					{ lease: existing },
				);
			}
			const next = buildLease({
				taskId,
				sessionId,
				paths,
				ttlSeconds,
				generation: (existing.generation || 0) + 1,
				revision: (existing.revision || 0) + 1,
				previousLeaseId: existing.leaseId,
			});
			writeLease(paths, next);
			if (taskId) appendTaskEvent(workspaceRoot, taskId, "resource_authority_reacquired", {
				sessionId,
				resource: next.resource,
				generation: next.generation,
				leaseId: next.leaseId,
				previousLeaseId: existing.leaseId,
			});
			return next;
		}
		if (pathExists(paths.lockDir)) {
			throw error("LEASE_LOCK_DIR_EXISTS", `resource lock exists without readable lease: ${paths.lockDir}`);
		}
		const claimed = claimDirExclusive(paths.lockDir);
		if (!claimed.ok) throw error("LEASE_RACE", `failed to claim resource lock ${paths.resourceId}`);
		const lease = buildLease({ taskId, sessionId, paths, ttlSeconds, generation: 1, revision: 1 });
		try {
			writeJsonAtomic(paths.leasePath, lease);
		} catch (cause) {
			releaseDir(paths.lockDir);
			throw cause;
		}
		if (taskId) appendTaskEvent(workspaceRoot, taskId, "resource_authority_acquired", {
			sessionId,
			resource: lease.resource,
			generation: lease.generation,
			leaseId: lease.leaseId,
			expiresAt: lease.expiresAt,
		});
		return lease;
	});
}

export function refreshResourceWriteAuthority(workspaceRoot, taskId, {
	sessionId,
	ttlSeconds,
	allowExpiredOwn = false,
} = {}) {
	const current = readResourceLeaseForTask(workspaceRoot, taskId);
	if (!current) throw error("NO_LEASE", `no resource authority for task ${taskId}`);
	if (current.invalid) throw error("MALFORMED_LEASE", current.reason, { lease: current });
	const paths = resourceAuthorityPaths(workspaceRoot, current.worktreePath);
	return withResourceMutex(paths, () => {
		const lease = parseResourceLease(paths.leasePath, { resourceId: paths.resourceId });
		if (!lease) throw error("NO_LEASE", `resource authority disappeared for task ${taskId}`);
		if (lease.invalid) throw error("MALFORMED_LEASE", lease.reason, { lease });
		if (sessionId && lease.sessionId !== sessionId) {
			throw error("LEASE_NOT_OWNER", `session ${sessionId} does not own resource authority`, { lease });
		}
		const expired = isResourceLeaseExpired(lease);
		if (expired && !(allowExpiredOwn && sessionId && lease.sessionId === sessionId)) {
			throw error("STALE_LEASE", `resource authority expired for task ${taskId}; explicit takeover required`, { lease });
		}
		const now = new Date();
		const ttl = ttlValue(ttlSeconds, lease.ttlSeconds || 14400);
		const refreshed = {
			...lease,
			lastActivityAt: now.toISOString(),
			expiresAt: new Date(now.getTime() + ttl * 1000).toISOString(),
			ttlSeconds: ttl,
			revision: (lease.revision || 0) + 1,
			generation: expired ? (lease.generation || 0) + 1 : lease.generation || 1,
			...(expired ? { previousLeaseId: lease.leaseId, leaseId: newLeaseId(), acquiredAt: now.toISOString() } : {}),
		};
		writeJsonAtomic(paths.leasePath, refreshed);
		appendTaskEvent(workspaceRoot, taskId, expired ? "resource_authority_reacquired" : "resource_authority_refreshed", {
			sessionId: refreshed.sessionId,
			resource: refreshed.resource,
			generation: refreshed.generation,
			leaseId: refreshed.leaseId,
			expiresAt: refreshed.expiresAt,
		});
		return refreshed;
	});
}

export function releaseResourceWriteAuthority(workspaceRoot, taskId, {
	sessionId,
	force = false,
} = {}) {
	const current = readResourceLeaseForTask(workspaceRoot, taskId);
	if (!current) return null;
	if (current.invalid) {
		if (!force) throw error("MALFORMED_LEASE", current.reason, { lease: current });
		return null;
	}
	const paths = resourceAuthorityPaths(workspaceRoot, current.worktreePath);
	return withResourceMutex(paths, () => {
		const lease = parseResourceLease(paths.leasePath, { resourceId: paths.resourceId });
		if (!lease) return null;
		if (!force) {
			if (!sessionId) throw error("SESSION_REQUIRED", "sessionId required to release resource authority", { lease });
			if (lease.sessionId !== sessionId) {
				throw error("LEASE_NOT_OWNER", `session ${sessionId} cannot release authority owned by ${lease.sessionId}`, { lease });
			}
		}
		appendTaskEvent(workspaceRoot, lease.taskId, "resource_authority_released", {
			sessionId: sessionId || lease.sessionId,
			resource: lease.resource,
			generation: lease.generation,
			leaseId: lease.leaseId,
			force: Boolean(force),
		});
		releaseDir(paths.lockDir);
		return lease;
	});
}

export function takeoverResourceWriteAuthority(workspaceRoot, {
	taskId,
	sessionId,
	worktreePath,
	ttlSeconds = 14400,
	confirm = false,
} = {}) {
	if (!confirm) throw error("CONFIRM_REQUIRED", "resource authority takeover requires --confirm");
	if (!taskId || !sessionId || !worktreePath) {
		throw error("INVALID_LEASE_ARGS", "taskId, sessionId, and worktreePath required for takeover");
	}
	const paths = resourceAuthorityPaths(workspaceRoot, worktreePath);
	return withResourceMutex(paths, () => {
		const previous = parseResourceLease(paths.leasePath, { resourceId: paths.resourceId });
		if (previous?.invalid) throw error("MALFORMED_LEASE", previous.reason, { lease: previous });
		const generation = (previous?.generation || 0) + 1;
		if (pathExists(paths.lockDir)) releaseDir(paths.lockDir);
		const claimed = claimDirExclusive(paths.lockDir);
		if (!claimed.ok) throw error("LEASE_RACE", `failed to claim resource lock ${paths.resourceId}`);
		const lease = buildLease({
			taskId,
			sessionId,
			paths,
			ttlSeconds,
			generation,
			revision: (previous?.revision || 0) + 1,
			previousLeaseId: previous?.leaseId || null,
		});
		writeJsonAtomic(paths.leasePath, lease);
		appendTaskEvent(workspaceRoot, taskId, "resource_authority_takeover", {
			sessionId,
			resource: lease.resource,
			generation,
			leaseId: lease.leaseId,
			previousLease: previous || null,
			confirmed: true,
		});
		return lease;
	});
}

export function sessionHoldsResourceWriteAuthority(workspaceRoot, taskId, sessionId) {
	const lease = readResourceLeaseForTask(workspaceRoot, taskId);
	if (!lease || lease.invalid || !sessionId) return false;
	return lease.sessionId === sessionId && !isResourceLeaseExpired(lease);
}
