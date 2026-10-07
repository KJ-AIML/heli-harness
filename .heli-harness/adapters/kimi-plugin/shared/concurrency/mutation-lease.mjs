/**
 * Short-lived mutation leases.
 *
 * A Heli session is coordination identity. Writer authority exists only while a
 * mutation is in flight, then expires. These records are not a worktree mutex.
 */
import { rmSync } from "node:fs";
import { join } from "node:path";
import {
	ensureDir,
	listFileNames,
	pathExists,
	readJson,
	writeJsonAtomic,
} from "./fs-atomic.mjs";
import { newLeaseId } from "./ids.mjs";
import { canonicalizePath, pathsFor } from "./paths.mjs";

export const MUTATION_LEASE_SCHEMA_VERSION = 1;
export const MUTATION_TTL_SECONDS = 30;

export function mutationLeaseDir(workspaceRoot) {
	return join(pathsFor(workspaceRoot).heliDir, "locks", "mutations");
}

export function isMutationActivityFresh(lease, now = Date.now()) {
	if (!lease || lease.invalid) return false;
	const expiresAt = Date.parse(lease.expiresAt || "");
	if (Number.isFinite(expiresAt) && now > expiresAt) return false;
	const activity = Date.parse(lease.lastActivityAt || lease.acquiredAt || "");
	if (!Number.isFinite(activity)) return false;
	return now - activity <= MUTATION_TTL_SECONDS * 1000;
}

function leaseFile(workspaceRoot, leaseId) {
	return join(mutationLeaseDir(workspaceRoot), `${leaseId}.json`);
}

function canonicalPaths(paths) {
	const out = [];
	const seen = new Set();
	for (const value of paths || []) {
		const canonical = canonicalizePath(value);
		if (!canonical || seen.has(canonical)) continue;
		seen.add(canonical);
		out.push(canonical);
	}
	return out;
}

export function listMutationLeases(workspaceRoot) {
	const dir = mutationLeaseDir(workspaceRoot);
	if (!pathExists(dir)) return [];
	const leases = [];
	for (const name of listFileNames(dir, { suffix: ".json" })) {
		const lease = readJson(join(dir, name), null);
		if (lease && typeof lease === "object") leases.push(lease);
	}
	return leases;
}

export function writeMutationLease(workspaceRoot, lease) {
	ensureDir(mutationLeaseDir(workspaceRoot));
	writeJsonAtomic(leaseFile(workspaceRoot, lease.leaseId), lease);
	return lease;
}

export function removeMutationLease(workspaceRoot, leaseId) {
	const path = leaseFile(workspaceRoot, leaseId);
	if (!pathExists(path)) return null;
	const lease = readJson(path, null);
	rmSync(path, { force: true });
	return lease;
}

export function releaseMutationLeasesForSession(workspaceRoot, sessionId) {
	if (!sessionId) return [];
	const released = [];
	for (const lease of listMutationLeases(workspaceRoot)) {
		if (lease?.sessionId !== sessionId) continue;
		const value = removeMutationLease(workspaceRoot, lease.leaseId);
		if (value) released.push(value);
	}
	return released;
}

/**
 * Record the paths a session is mutating right now.
 * The same tool call refreshes one lease. A later call replaces this session's
 * previous in-flight record so a missed PostTool hook cannot accumulate locks.
 */
export function acquireMutationLease(workspaceRoot, {
	sessionId,
	host = null,
	worktreePath = "",
	paths = [],
	toolUseId = null,
	ttlSeconds = MUTATION_TTL_SECONDS,
} = {}) {
	if (!sessionId) {
		const error = new Error("sessionId required for a mutation lease");
		error.code = "INVALID_LEASE_ARGS";
		throw error;
	}
	const canonical = canonicalPaths(paths);
	const now = new Date();
	const ttl = Number(ttlSeconds) > 0 ? Number(ttlSeconds) : MUTATION_TTL_SECONDS;
	const existing = listMutationLeases(workspaceRoot).filter((lease) => lease.sessionId === sessionId);
	const sameCall = toolUseId
		? existing.find((lease) => lease.toolUseId && lease.toolUseId === toolUseId)
		: null;
	if (sameCall) {
		const merged = canonicalPaths([...(sameCall.paths || []), ...canonical]);
		return writeMutationLease(workspaceRoot, {
			...sameCall,
			host: host || sameCall.host || null,
			worktreePath: canonicalizePath(worktreePath) || sameCall.worktreePath || "",
			paths: merged,
			scope: merged.length ? "paths" : "unscoped",
			lastActivityAt: now.toISOString(),
			expiresAt: new Date(now.getTime() + ttl * 1000).toISOString(),
			ttlSeconds: ttl,
			state: "active",
		});
	}
	for (const lease of existing) {
		// A different in-flight tool call from this session keeps its own paths.
		// Sequential calls with no id, and finished calls, are replaced.
		if (toolUseId && lease.toolUseId && lease.toolUseId !== toolUseId && isMutationActivityFresh(lease)) continue;
		removeMutationLease(workspaceRoot, lease.leaseId);
	}
	return writeMutationLease(workspaceRoot, {
		schemaVersion: MUTATION_LEASE_SCHEMA_VERSION,
		leaseId: newLeaseId(),
		sessionId,
		host: host || null,
		worktreePath: canonicalizePath(worktreePath) || "",
		paths: canonical,
		scope: canonical.length ? "paths" : "unscoped",
		exclusive: false,
		toolUseId: toolUseId || null,
		acquiredAt: now.toISOString(),
		lastActivityAt: now.toISOString(),
		expiresAt: new Date(now.getTime() + ttl * 1000).toISOString(),
		ttlSeconds: ttl,
		state: "active",
	});
}
