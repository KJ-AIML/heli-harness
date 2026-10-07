/**
 * Flow-first governance for Heli v0.11.
 *
 * Valid work flows. Heli blocks a write only when it can prove a live overlapping
 * mutation, or when a stricter profile still requires the older fail-closed gate.
 * Stale, closed, orphaned, and unknown authority is recovered. It is not inherited
 * and it is not a blanket denial.
 */
import { dirname, join } from "node:path";
import { appendJsonl, ensureDir, pathExists, readJson, releaseDir, writeJsonAtomic } from "./fs-atomic.mjs";
import { clearBindingSession, listAllBindings } from "./binding.mjs";
import { linkedWorkspaceTasksDir, resolveWorkspaceLayout } from "./project-binding.mjs";
import { canonicalizePath, pathsFor } from "./paths.mjs";
import {
	isMutationActivityFresh,
	listMutationLeases,
	acquireMutationLease,
	removeMutationLease,
	MUTATION_TTL_SECONDS,
} from "./mutation-lease.mjs";
import {
	listResourceLeases,
	releaseResourceWriteAuthorityForWorktree,
	upsertCooperativeResourceLease,
} from "./resource-authority.mjs";
import { closeSession, listSessions, readSession, writeSession } from "./session.mjs";

export const GOVERNANCE_PROFILES = Object.freeze(["flow", "strict", "observe"]);
export const DEFAULT_GOVERNANCE_PROFILE = "flow";
export const AUTHORITY_STATES = Object.freeze(["ACTIVE", "CLOSED", "ORPHANED", "UNKNOWN"]);
const DEFAULT_ORPHAN_SESSION_MS = 30 * 60 * 1000;

function profileError(profile) {
	const error = new Error(`governance profile must be one of: ${GOVERNANCE_PROFILES.join(", ")}`);
	error.code = "INVALID_GOVERNANCE_PROFILE";
	error.profile = profile;
	throw error;
}

export function workspaceGovernancePath(workspaceRoot, { env = process.env } = {}) {
	const layout = resolveWorkspaceLayout(workspaceRoot, { env });
	if (layout.mode === "linked" && layout.binding?.workspaceId) {
		return join(dirname(linkedWorkspaceTasksDir(layout.binding.workspaceId, env)), "governance.json");
	}
	return join(layout.operationalRoot, "workspace", "governance.json");
}

function governanceAuditPath(workspaceRoot, env) {
	return join(dirname(workspaceGovernancePath(workspaceRoot, { env })), "governance-audit.jsonl");
}

export function readGovernanceProfile(workspaceRoot, { env = process.env } = {}) {
	if (!workspaceRoot) return DEFAULT_GOVERNANCE_PROFILE;
	const raw = readJson(workspaceGovernancePath(workspaceRoot, { env }), null);
	const profile = String(raw?.profile || "").trim();
	return GOVERNANCE_PROFILES.includes(profile) ? profile : DEFAULT_GOVERNANCE_PROFILE;
}

export function readGovernanceRecord(workspaceRoot, { env = process.env } = {}) {
	return readJson(workspaceGovernancePath(workspaceRoot, { env }), null);
}

/**
 * Create the default flow profile once. An explicit profile already on disk is kept.
 * Safe to call on every reconciliation.
 */
export function ensureGovernanceProfile(workspaceRoot, { env = process.env } = {}) {
	const path = workspaceGovernancePath(workspaceRoot, { env });
	const existing = readJson(path, null);
	if (existing && GOVERNANCE_PROFILES.includes(existing.profile)) return existing;
	const record = {
		schemaVersion: 1,
		profile: DEFAULT_GOVERNANCE_PROFILE,
		migratedFrom: existing ? "legacy" : "0.10",
		updatedAt: new Date().toISOString(),
	};
	ensureDir(dirname(path));
	writeJsonAtomic(path, record);
	return record;
}

export function setGovernanceProfile(workspaceRoot, profile, { env = process.env } = {}) {
	const next = String(profile || "").trim();
	if (!GOVERNANCE_PROFILES.includes(next)) profileError(next);
	const path = workspaceGovernancePath(workspaceRoot, { env });
	const existing = readJson(path, null);
	const record = {
		schemaVersion: 1,
		profile: next,
		migratedFrom: existing?.migratedFrom || null,
		updatedAt: new Date().toISOString(),
	};
	ensureDir(dirname(path));
	writeJsonAtomic(path, record);
	return record;
}

export function authorityStateForSession(session) {
	if (!session) return "UNKNOWN";
	if (session.status === "closed") return "CLOSED";
	if (session.status === "active") return "ACTIVE";
	return "ORPHANED";
}

export function classifyHeldAuthority(workspaceRoot, lease, now = Date.now()) {
	if (!lease || lease.invalid) {
		return { state: "UNKNOWN", live: false, session: null, reason: "malformed-or-missing" };
	}
	const session = lease.sessionId ? readSession(workspaceRoot, lease.sessionId) : null;
	const sessionState = authorityStateForSession(session);
	if (sessionState === "CLOSED") return { state: "CLOSED", live: false, session, reason: "session-closed" };
	if (sessionState === "UNKNOWN") return { state: "UNKNOWN", live: false, session: null, reason: "owner-session-missing" };
	if (sessionState === "ORPHANED") return { state: "ORPHANED", live: false, session, reason: "session-not-active" };
	if (!isMutationActivityFresh(lease, now)) {
		const expired = Number.isFinite(Date.parse(lease.expiresAt || "")) && now > Date.parse(lease.expiresAt);
		return { state: "ORPHANED", live: false, session, reason: expired ? "expired" : "idle" };
	}
	return { state: "ACTIVE", live: true, session, reason: "live-mutation" };
}

function pathsOf(record) {
	return (record?.paths || []).map((value) => canonicalizePath(value)).filter(Boolean);
}

function isWorktreeScoped(record) {
	if (!record) return false;
	if (record.exclusive === true) return true;
	if (record.scope === "worktree") return true;
	if (!record.scope && pathsOf(record).length === 0 && record.worktreePath) return true;
	return false;
}

function sameWorktree(left, right) {
	const a = canonicalizePath(left?.worktreePath || left?.resource?.canonicalPath || "");
	const b = canonicalizePath(right?.worktreePath || right?.resource?.canonicalPath || "");
	return Boolean(a && b && a === b);
}

function pathOverlaps(left, right) {
	if (!left || !right) return false;
	if (left === right) return true;
	const a = left.endsWith("/") ? left : `${left}/`;
	const b = right.endsWith("/") ? right : `${right}/`;
	return right.startsWith(a) || left.startsWith(b);
}

export function mutationRecordsOverlap(left, right) {
	if (isWorktreeScoped(left) || isWorktreeScoped(right)) return sameWorktree(left, right);
	const a = pathsOf(left);
	const b = pathsOf(right);
	if (!a.length || !b.length) return false;
	for (const path of a) {
		for (const other of b) {
			if (pathOverlaps(path, other)) return true;
		}
	}
	return false;
}

function audit(workspaceRoot, record, env) {
	try {
		const path = governanceAuditPath(workspaceRoot, env);
		ensureDir(dirname(path));
		appendJsonl(path, { at: new Date().toISOString(), ...record });
	} catch {
		// Audit evidence must not turn recovery into a denial.
	}
}

function worktreeOf(lease) {
	return lease?.worktreePath || lease?.resource?.canonicalPath || "";
}

export function reconcileResourceLeases(workspaceRoot, { now = Date.now(), env = process.env, profile = null } = {}) {
	const resolved = profile || readGovernanceProfile(workspaceRoot, { env });
	if (resolved === "strict") return [];
	const repairs = [];
	for (const lease of listResourceLeases(workspaceRoot)) {
		if (!lease || lease.invalid || !worktreeOf(lease)) continue;
		const classified = classifyHeldAuthority(workspaceRoot, lease, now);
		if (classified.live) continue;
		try {
			releaseResourceWriteAuthorityForWorktree(workspaceRoot, worktreeOf(lease), {
				sessionId: lease.sessionId,
				force: true,
			});
		} catch (error) {
			repairs.push({
				kind: "blocked",
				sessionId: lease.sessionId || null,
				reason: error?.message || "release failed",
			});
			continue;
		}
		const kind = classified.state === "CLOSED"
			? "stale-session"
			: classified.state === "UNKNOWN"
				? "unknown-authority"
				: "orphaned-lease";
		const repair = {
			kind,
			sessionId: lease.sessionId || null,
			state: classified.state,
			reason: classified.reason,
			worktreePath: worktreeOf(lease),
		};
		repairs.push(repair);
		audit(workspaceRoot, { type: "resource-authority-released", ...repair }, env);
	}
	return repairs;
}

export function reconcileMutationLeases(workspaceRoot, { now = Date.now(), env = process.env } = {}) {
	const repairs = [];
	for (const lease of listMutationLeases(workspaceRoot)) {
		const classified = classifyHeldAuthority(workspaceRoot, lease, now);
		if (classified.live) continue;
		removeMutationLease(workspaceRoot, lease.leaseId);
		const repair = {
			kind: classified.state === "CLOSED" ? "stale-session" : "orphaned-lease",
			sessionId: lease.sessionId || null,
			state: classified.state,
			reason: classified.reason,
			leaseId: lease.leaseId || null,
		};
		repairs.push(repair);
		audit(workspaceRoot, { type: "mutation-lease-released", ...repair }, env);
	}
	return repairs;
}

function withHost(workspaceRoot, lease, classified) {
	return {
		...lease,
		host: lease.host || classified.session?.host || null,
		scope: isWorktreeScoped(lease) ? "worktree" : (lease.scope || "paths"),
	};
}

export function findLiveMutationConflicts(workspaceRoot, {
	sessionId = null,
	worktreePath = "",
	paths = [],
	now = Date.now(),
} = {}) {
	const candidate = {
		scope: paths.length ? "paths" : "unscoped",
		exclusive: false,
		paths,
		worktreePath,
	};
	const conflicts = [];
	const seen = new Set();
	const consider = (lease) => {
		if (!lease || lease.invalid) return;
		if (sessionId && lease.sessionId === sessionId) return;
		const classified = classifyHeldAuthority(workspaceRoot, lease, now);
		if (!classified.live) return;
		const shaped = withHost(workspaceRoot, lease, classified);
		if (!mutationRecordsOverlap(shaped, candidate)) return;
		const key = `${shaped.sessionId}|${shaped.leaseId || shaped.resource?.id || ""}|${(shaped.paths || []).join(",")}`;
		if (seen.has(key)) return;
		seen.add(key);
		conflicts.push(shaped);
	};
	for (const lease of listMutationLeases(workspaceRoot)) consider(lease);
	for (const lease of listResourceLeases(workspaceRoot)) consider(lease);
	return conflicts;
}

function relativeLabel(path) {
	const text = String(path || "");
	const parts = text.split("/").filter(Boolean);
	return parts.slice(-2).join("/") || text || "resource";
}

export function worktreeHeldReason(lease) {
	const resource = lease?.resource?.id || "unknown";
	const task = lease?.taskId ? ` (work record ${lease.taskId})` : "";
	return `Heli linked mode: worktree resource ${resource} is held by session ${lease.sessionId}${task} until ${lease.expiresAt}.`;
}

export function liveConflictMessage(lease, paths = []) {
	const target = paths[0] ? relativeLabel(paths[0]) : relativeLabel(lease?.paths?.[0] || lease?.worktreePath);
	const activity = Date.parse(lease?.lastActivityAt || lease?.acquiredAt || "");
	const age = Number.isFinite(activity) ? `${Math.max(0, Math.round((Date.now() - activity) / 1000))}s ago` : "unknown";
	const host = lease?.host || "unknown host";
	return [
		`Active write conflict on ${target}`,
		`Owner: ${host} / ${lease?.sessionId || "unknown"}`,
		`Last mutation activity: ${age}`,
	].join("\n");
}

export function makeFlowDecision({
	action,
	className,
	reasonCode,
	message,
	recovery = null,
} = {}) {
	return {
		action,
		class: className,
		reasonCode,
		message: message || "",
		recovery,
	};
}

function recoveryNotice(repairs, host) {
	const sessionIds = [...new Set(repairs.map((repair) => repair.sessionId).filter(Boolean))];
	if (!sessionIds.length) return "";
	return [
		...sessionIds.map((sessionId) => `Recovered stale writer session ${sessionId}`),
		`Continuing with current ${host || "host"} session.`,
	].join("\n");
}

function canonicalMutationPaths(paths) {
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

/**
 * Decide a linked-mode write under flow or observe.
 * Strict returns handled:false so the legacy gate stays authoritative.
 */
export function decideFlowWrite(ctx, {
	mutationPaths = [],
	toolUseId = null,
	now = Date.now(),
	env = process.env,
} = {}) {
	if (!ctx?.workspaceRoot) return { handled: false };
	const record = ensureGovernanceProfile(ctx.workspaceRoot, { env });
	const profile = record.profile || DEFAULT_GOVERNANCE_PROFILE;
	if (profile === "strict") return { handled: false, profile };

	const repairs = [
		...reconcileResourceLeases(ctx.workspaceRoot, { now, env, profile }),
		...reconcileMutationLeases(ctx.workspaceRoot, { now, env }),
	];
	const paths = canonicalMutationPaths(mutationPaths);
	const conflicts = findLiveMutationConflicts(ctx.workspaceRoot, {
		sessionId: ctx.sessionId,
		worktreePath: ctx.worktreeRoot,
		paths,
		now,
	});
	const sessionLive = Boolean(ctx.session && ctx.session.status === "active" && ctx.sessionId);
	const degraded = !sessionLive || ctx.runtimeDegraded === true;
	const host = ctx.host || ctx.session?.host || "host";

	if (conflicts.length && profile !== "observe") {
		const owner = conflicts[0];
		const worktree = isWorktreeScoped(owner);
		const reasonCode = worktree ? "RESOURCE_WRITER_HELD" : "MUTATION_CONFLICT";
		const message = worktree
			? `${liveConflictMessage(owner, paths)}\n${worktreeHeldReason(owner)}`
			: liveConflictMessage(owner, paths);
		const governance = makeFlowDecision({
			action: "block",
			className: "conflict",
			reasonCode,
			message,
			recovery: {
				recoverability: "HUMAN_REQUIRED",
				retryable: false,
				nextAction: "Wait for the active writer to finish, change a non-overlapping path, or explicitly approve takeover of this live mutation.",
			},
		});
		return {
			handled: true,
			deny: true,
			code: reasonCode,
			reason: message,
			authority: owner,
			governance,
			profile,
		};
	}

	let authority = null;
	if (sessionLive && profile !== "observe") {
		authority = acquireMutationLease(ctx.workspaceRoot, {
			sessionId: ctx.sessionId,
			host,
			worktreePath: ctx.worktreeRoot,
			paths,
			toolUseId,
		});
		upsertCooperativeResourceLease(ctx.workspaceRoot, {
			sessionId: ctx.sessionId,
			taskId: ctx.taskId || null,
			worktreePath: ctx.worktreeRoot,
			paths,
			host,
			toolUseId,
			ttlSeconds: MUTATION_TTL_SECONDS,
		});
	} else if (sessionLive && profile === "observe") {
		authority = acquireMutationLease(ctx.workspaceRoot, {
			sessionId: ctx.sessionId,
			host,
			worktreePath: ctx.worktreeRoot,
			paths,
			toolUseId,
		});
	}

	const notices = [];
	const recovered = recoveryNotice(repairs.filter((repair) => repair.kind !== "blocked"), host);
	if (recovered) notices.push(recovered);
	if (degraded) notices.push("Runtime evidence incomplete.\nContinuing in degraded mode.");
	if (conflicts.length && profile === "observe") {
		notices.push(liveConflictMessage(conflicts[0], paths));
		notices.push("Governance profile is observe. The conflict was recorded and the write was not blocked.");
	}
	const reasonCode = conflicts.length
		? "CONFLICT_OBSERVED"
		: repairs.some((repair) => repair.kind !== "blocked")
			? "AUTHORITY_RECOVERED"
			: degraded
				? "RUNTIME_DEGRADED"
				: "MUTATION_AUTHORITY_ACQUIRED";
	const action = reasonCode === "MUTATION_AUTHORITY_ACQUIRED" ? "allow" : "allow_degraded";
	const governance = makeFlowDecision({
		action,
		className: action === "allow" ? "normal" : "degraded",
		reasonCode,
		message: notices.join("\n"),
		recovery: null,
	});
	return {
		handled: true,
		deny: false,
		ok: true,
		linked: true,
		code: reasonCode,
		authority,
		governance,
		notice: notices.filter(Boolean).join("\n") || null,
		repaired: repairs,
		profile,
		degraded: action === "allow_degraded",
	};
}

function quarantineMalformed(workspaceRoot, lease) {
	const source = lease?.path;
	if (!source || !pathExists(source)) return false;
	const destDir = join(pathsFor(workspaceRoot).heliDir, "locks", "quarantine");
	ensureDir(destDir);
	const dest = join(destDir, `${Date.now()}-${lease.raw?.resource?.id || "lease"}.json`);
	try {
		writeJsonAtomic(dest, lease.raw || { reason: lease.reason || "malformed" });
		releaseDir(dirname(source));
		return true;
	} catch {
		return false;
	}
}

function normalizePathAliases(workspaceRoot, { env = process.env } = {}) {
	let count = 0;
	for (const session of listSessions(workspaceRoot)) {
		if (!session?.worktreePath) continue;
		const canonical = canonicalizePath(session.worktreePath);
		if (!canonical || canonical === session.worktreePath) continue;
		session.worktreePath = canonical;
		writeSession(workspaceRoot, session);
		count += 1;
	}
	const indexPath = pathsFor(workspaceRoot, { env }).indexPath;
	const index = readJson(indexPath, null);
	if (index && Array.isArray(index.repos)) {
		let changed = false;
		for (const repo of index.repos) {
			const raw = String(repo?.path || repo?.gitRoot || "").replaceAll("\\", "/");
			const normalized = raw.replace(/\/+/g, "/").replace(/^\.\//, "");
			if (!raw || raw === normalized) continue;
			repo.path = normalized;
			repo.gitRoot = normalized;
			changed = true;
			count += 1;
		}
		if (changed) writeJsonAtomic(indexPath, index);
	}
	return count;
}

export function repairGovernanceState(workspaceRoot, {
	env = process.env,
	now = Date.now(),
	orphanSessionAfterMs = DEFAULT_ORPHAN_SESSION_MS,
} = {}) {
	ensureGovernanceProfile(workspaceRoot, { env });
	const profile = readGovernanceProfile(workspaceRoot, { env });
	const repairs = profile === "strict"
		? []
		: [
			...reconcileResourceLeases(workspaceRoot, { now, env, profile }),
			...reconcileMutationLeases(workspaceRoot, { now, env }),
		];
	let blocked = repairs.filter((repair) => repair.kind === "blocked").length;
	const staleSessionIds = new Set(
		repairs.filter((repair) => repair.kind === "stale-session" && repair.sessionId).map((repair) => repair.sessionId),
	);

	if (profile !== "strict") {
		for (const lease of listResourceLeases(workspaceRoot)) {
			if (!lease?.invalid) continue;
			if (quarantineMalformed(workspaceRoot, lease)) {
				repairs.push({ kind: "malformed-quarantine", sessionId: lease.raw?.sessionId || null });
			} else {
				blocked += 1;
			}
		}
		for (const session of listSessions(workspaceRoot)) {
			if (session.status !== "active") continue;
			const seen = Date.parse(session.lastSeenAt || session.createdAt || "");
			const idle = Number.isFinite(seen) && now - seen >= orphanSessionAfterMs;
			const holdsLive = findLiveMutationConflicts(workspaceRoot, {
				worktreePath: session.worktreePath,
				paths: [],
				now,
			}).some((lease) => lease.sessionId === session.sessionId)
				|| listResourceLeases(workspaceRoot).some((lease) => {
					if (lease.sessionId !== session.sessionId) return false;
					return classifyHeldAuthority(workspaceRoot, lease, now).live;
				})
				|| listMutationLeases(workspaceRoot).some((lease) => {
					if (lease.sessionId !== session.sessionId) return false;
					return classifyHeldAuthority(workspaceRoot, lease, now).live;
				});
			if (!idle || holdsLive) continue;
			closeSession(workspaceRoot, session.sessionId);
			staleSessionIds.add(session.sessionId);
			repairs.push({ kind: "stale-session", sessionId: session.sessionId, reason: "idle-session" });
		}
		for (const binding of listAllBindings(workspaceRoot)) {
			const ids = [
				binding?.defaultSessionId,
				...Object.values(binding?.hostBindings || {}).map((info) => info?.sessionId),
			].filter(Boolean);
			for (const sessionId of new Set(ids)) {
				const session = readSession(workspaceRoot, sessionId);
				if (session && session.status !== "closed") continue;
				if (!binding.canonicalWorktreePath) continue;
				clearBindingSession(workspaceRoot, binding.canonicalWorktreePath, sessionId);
				repairs.push({ kind: "stale-binding", sessionId });
			}
		}
	}

	const pathAliases = normalizePathAliases(workspaceRoot, { env });
	return {
		profile,
		staleSessions: staleSessionIds.size,
		orphanedLeases: repairs.filter((repair) => repair.kind === "orphaned-lease" || repair.kind === "unknown-authority").length,
		pathAliases,
		staleBindings: repairs.filter((repair) => repair.kind === "stale-binding").length,
		blocked,
		repairs,
	};
}

export function formatRepairReport(report) {
	const lines = [
		"Repaired:",
		`  ${report.staleSessions} stale sessions`,
		`  ${report.orphanedLeases} orphaned mutation lease${report.orphanedLeases === 1 ? "" : "s"}`,
		`  ${report.pathAliases} path aliases normalized`,
		"",
		"Blocked:",
		`  ${report.blocked}`,
	];
	if (report.staleBindings) lines.push("", `Bindings cleared: ${report.staleBindings}`);
	lines.push("", `Governance profile: ${report.profile}`);
	return lines.join("\n");
}
