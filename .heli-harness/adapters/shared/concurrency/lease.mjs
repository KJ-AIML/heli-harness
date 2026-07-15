import {
	claimDirExclusive,
	pathExists,
	readJson,
	releaseDir,
	writeJsonAtomic,
} from "./fs-atomic.mjs";
import {
	DEFAULT_LEASE_TTL_SECONDS,
	canonicalizePath,
	leasePath,
	writeLockDir,
} from "./paths.mjs";
import { newLeaseId } from "./ids.mjs";
import { LEASE_SCHEMA_VERSION } from "./schema.mjs";
import { appendTaskEvent } from "./events.mjs";

export function readLease(workspaceRoot, taskId) {
	return readJson(leasePath(workspaceRoot, taskId), null);
}

export function isLeaseExpired(lease, now = Date.now()) {
	if (!lease?.expiresAt) return false;
	const exp = Date.parse(lease.expiresAt);
	if (Number.isNaN(exp)) return false;
	return now > exp;
}

export function leaseStatus(lease, now = Date.now()) {
	if (!lease) return { state: "none" };
	if (isLeaseExpired(lease, now)) return { state: "stale", lease };
	return { state: "active", lease };
}

function buildLease({ taskId, sessionId, worktreePath, ttlSeconds, revision }) {
	const now = new Date();
	const ttl = Number(ttlSeconds) > 0 ? Number(ttlSeconds) : DEFAULT_LEASE_TTL_SECONDS;
	const acquiredAt = now.toISOString();
	const expiresAt = new Date(now.getTime() + ttl * 1000).toISOString();
	return {
		schemaVersion: LEASE_SCHEMA_VERSION,
		leaseId: newLeaseId(),
		taskId,
		sessionId,
		mode: "write",
		worktreePath: canonicalizePath(worktreePath || ""),
		acquiredAt,
		lastActivityAt: acquiredAt,
		expiresAt,
		ttlSeconds: ttl,
		revision: revision || 1,
	};
}

/**
 * Acquire exclusive write lease via atomic lock directory creation.
 * Never silently steals stale leases — returns STALE_LEASE requiring takeover.
 */
export function acquireWriteLease(workspaceRoot, {
	taskId,
	sessionId,
	worktreePath = "",
	ttlSeconds = DEFAULT_LEASE_TTL_SECONDS,
} = {}) {
	if (!taskId || !sessionId) {
		const err = new Error("taskId and sessionId required for write lease");
		err.code = "INVALID_LEASE_ARGS";
		throw err;
	}
	const lockDir = writeLockDir(workspaceRoot, taskId);
	const existing = readLease(workspaceRoot, taskId);
	if (existing) {
		if (existing.sessionId === sessionId && !isLeaseExpired(existing)) {
			return refreshLease(workspaceRoot, taskId, { sessionId });
		}
		if (!isLeaseExpired(existing)) {
			const err = new Error(
				`write lease held by session ${existing.sessionId} on task ${taskId} until ${existing.expiresAt}`,
			);
			err.code = "LEASE_HELD";
			err.lease = existing;
			throw err;
		}
		const err = new Error(
			`stale write lease on task ${taskId} from session ${existing.sessionId} (expired ${existing.expiresAt}). Use heli task takeover ${taskId} --confirm`,
		);
		err.code = "STALE_LEASE";
		err.lease = existing;
		throw err;
	}

	// If lock dir exists without lease.json, treat carefully
	if (pathExists(lockDir) && !existing) {
		const err = new Error(`lock directory exists without readable lease for task ${taskId}`);
		err.code = "LEASE_LOCK_DIR_EXISTS";
		throw err;
	}

	const claim = claimDirExclusive(lockDir);
	if (!claim.ok) {
		// race: someone else won
		const raced = readLease(workspaceRoot, taskId);
		const err = new Error(
			`failed to acquire write lease for task ${taskId}${raced ? ` (held by ${raced.sessionId})` : ""}`,
		);
		err.code = "LEASE_RACE";
		err.lease = raced;
		throw err;
	}

	const lease = buildLease({ taskId, sessionId, worktreePath, ttlSeconds });
	try {
		writeJsonAtomic(leasePath(workspaceRoot, taskId), lease);
	} catch (error) {
		releaseDir(lockDir);
		throw error;
	}
	appendTaskEvent(workspaceRoot, taskId, "lease_acquired", {
		sessionId,
		leaseId: lease.leaseId,
		expiresAt: lease.expiresAt,
		worktreePath: lease.worktreePath,
	});
	return lease;
}

export function refreshLease(workspaceRoot, taskId, { sessionId, ttlSeconds } = {}) {
	const lease = readLease(workspaceRoot, taskId);
	if (!lease) {
		const err = new Error(`no lease to refresh for task ${taskId}`);
		err.code = "NO_LEASE";
		throw err;
	}
	if (sessionId && lease.sessionId !== sessionId) {
		const err = new Error(`session ${sessionId} does not own lease for task ${taskId}`);
		err.code = "LEASE_NOT_OWNER";
		err.lease = lease;
		throw err;
	}
	if (isLeaseExpired(lease)) {
		const err = new Error(`lease expired for task ${taskId}; use takeover`);
		err.code = "STALE_LEASE";
		err.lease = lease;
		throw err;
	}
	const ttl = Number(ttlSeconds) > 0 ? Number(ttlSeconds) : lease.ttlSeconds || DEFAULT_LEASE_TTL_SECONDS;
	const now = new Date();
	lease.lastActivityAt = now.toISOString();
	lease.expiresAt = new Date(now.getTime() + ttl * 1000).toISOString();
	lease.ttlSeconds = ttl;
	lease.revision = (lease.revision || 0) + 1;
	writeJsonAtomic(leasePath(workspaceRoot, taskId), lease);
	appendTaskEvent(workspaceRoot, taskId, "lease_refreshed", {
		sessionId: lease.sessionId,
		leaseId: lease.leaseId,
		expiresAt: lease.expiresAt,
	});
	return lease;
}

export function releaseWriteLease(workspaceRoot, taskId, { sessionId, force = false } = {}) {
	const lease = readLease(workspaceRoot, taskId);
	if (!lease) {
		releaseDir(writeLockDir(workspaceRoot, taskId));
		return null;
	}
	if (!force && sessionId && lease.sessionId !== sessionId) {
		const err = new Error(`session ${sessionId} cannot release lease owned by ${lease.sessionId}`);
		err.code = "LEASE_NOT_OWNER";
		err.lease = lease;
		throw err;
	}
	const lockDir = writeLockDir(workspaceRoot, taskId);
	// preserve evidence: write released snapshot event before remove
	appendTaskEvent(workspaceRoot, taskId, "lease_released", {
		sessionId: sessionId || lease.sessionId,
		leaseId: lease.leaseId,
		previous: lease,
	});
	releaseDir(lockDir);
	return lease;
}

/**
 * Explicit takeover of a lease (including stale). Requires confirm=true.
 */
export function takeoverWriteLease(workspaceRoot, {
	taskId,
	sessionId,
	worktreePath = "",
	ttlSeconds = DEFAULT_LEASE_TTL_SECONDS,
	confirm = false,
} = {}) {
	if (!confirm) {
		const err = new Error("takeover requires --confirm");
		err.code = "CONFIRM_REQUIRED";
		err.lease = readLease(workspaceRoot, taskId);
		throw err;
	}
	const previous = readLease(workspaceRoot, taskId);
	appendTaskEvent(workspaceRoot, taskId, "lease_takeover", {
		sessionId,
		previousLease: previous,
		confirmed: true,
	});
	// force release then acquire
	releaseDir(writeLockDir(workspaceRoot, taskId));
	return acquireWriteLease(workspaceRoot, { taskId, sessionId, worktreePath, ttlSeconds });
}

export function sessionHoldsWriteLease(workspaceRoot, taskId, sessionId) {
	const lease = readLease(workspaceRoot, taskId);
	if (!lease || !sessionId) return false;
	if (lease.sessionId !== sessionId) return false;
	return !isLeaseExpired(lease);
}
