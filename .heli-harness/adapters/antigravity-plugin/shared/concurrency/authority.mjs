import { readSession, writeSession, sessionModeRank, normalizeSessionMode } from "./session.mjs";
import {
	readLease,
	isLeaseExpired,
	sessionHoldsWriteLease,
	releaseWriteLease,
	acquireWriteLease,
} from "./lease.mjs";
import { appendTaskEvent } from "./events.mjs";

function minMode(a, b) {
	return sessionModeRank(a) <= sessionModeRank(b) ? normalizeSessionMode(a) : normalizeSessionMode(b);
}

export function effectiveSessionAuthority(workspaceRoot, sessionId, { visited = new Set() } = {}) {
	const session = readSession(workspaceRoot, sessionId);
	if (!session) {
		return { sessionId, exists: false, status: "missing", mode: "observe", delegationActive: false, writeAllowed: false, reason: "SESSION_NOT_FOUND", chain: [sessionId] };
	}
	const status = String(session.status || "active");
	if (status !== "active") {
		return { sessionId, exists: true, status, mode: "observe", taskId: session.taskId || null, parentSessionId: session.parentSessionId || null, role: session.role, delegationActive: false, writeAllowed: false, reason: "SESSION_INACTIVE", chain: [sessionId] };
	}
	if (visited.has(sessionId)) {
		return { sessionId, exists: true, status, mode: "observe", taskId: session.taskId || null, delegationActive: false, writeAllowed: false, reason: "SESSION_PARENT_CYCLE", chain: [sessionId] };
	}
	visited.add(sessionId);
	let mode = normalizeSessionMode(session.mode);
	const chain = [sessionId];
	let delegationActive = true;
	if (session.parentSessionId) {
		const parent = readSession(workspaceRoot, session.parentSessionId);
		if (!parent) {
			return { sessionId, exists: true, status, mode: "observe", taskId: session.taskId || null, parentSessionId: session.parentSessionId, role: session.role, delegationActive: false, writeAllowed: false, reason: "PARENT_SESSION_NOT_FOUND", chain };
		}
		if (String(parent.status || "active") !== "active") {
			return { sessionId, exists: true, status, mode: "observe", taskId: session.taskId || null, parentSessionId: session.parentSessionId, role: session.role, delegationActive: false, writeAllowed: false, reason: "PARENT_SESSION_INACTIVE", chain: [sessionId, parent.sessionId] };
		}
		const parentAuthority = effectiveSessionAuthority(workspaceRoot, parent.sessionId, { visited });
		chain.push(...(parentAuthority.chain || [parent.sessionId]));
		if (!parentAuthority.delegationActive) {
			return { sessionId, exists: true, status, mode: "observe", taskId: session.taskId || null, parentSessionId: session.parentSessionId, role: session.role, delegationActive: false, writeAllowed: false, reason: "ANCESTOR_DELEGATION_INACTIVE", parentReason: parentAuthority.reason, chain };
		}
		mode = minMode(mode, session.delegation?.mode || "observe");
		if (parent.taskId && session.taskId && parent.taskId !== session.taskId) {
			return { sessionId, exists: true, status, mode: "observe", taskId: session.taskId || null, parentSessionId: session.parentSessionId, role: session.role, delegationActive: false, writeAllowed: false, reason: "CHILD_TASK_MISMATCH", chain };
		}
	}
	const lease = session.taskId ? readLease(workspaceRoot, session.taskId) : null;
	const leaseActive = Boolean(lease && !lease.invalid && !isLeaseExpired(lease));
	const writeAllowed = delegationActive && mode === "write" && Boolean(session.taskId) && leaseActive && sessionHoldsWriteLease(workspaceRoot, session.taskId, sessionId);
	return {
		sessionId,
		exists: true,
		status,
		mode,
		taskId: session.taskId || null,
		parentSessionId: session.parentSessionId || null,
		role: session.role,
		chain,
		delegationActive,
		lease: lease ? { sessionId: lease.sessionId || null, expiresAt: lease.expiresAt || null, active: leaseActive } : null,
		writeAllowed,
		reason: writeAllowed ? "WRITE_AUTHORITY_ACTIVE" : mode !== "write" ? "EFFECTIVE_MODE_READ_ONLY" : "WRITE_LEASE_REQUIRED",
	};
}

export function transferWriteAuthority(workspaceRoot, {
	parentSessionId,
	childSessionId,
	worktreePath = "",
} = {}) {
	const parent = readSession(workspaceRoot, parentSessionId);
	const child = readSession(workspaceRoot, childSessionId);
	if (!parent || !child) {
		const error = new Error("parent and child sessions must exist");
		error.code = "SESSION_NOT_FOUND";
		throw error;
	}
	if (child.parentSessionId !== parent.sessionId) {
		const error = new Error(`${childSessionId} is not a child of ${parentSessionId}`);
		error.code = "INVALID_PARENT_CHILD_RELATION";
		throw error;
	}
	if (!parent.taskId || child.taskId !== parent.taskId) {
		const error = new Error("parent and child must be bound to the same task");
		error.code = "CHILD_TASK_MISMATCH";
		throw error;
	}
	if (sessionModeRank(child.delegation?.mode) < sessionModeRank("write")) {
		const error = new Error("child does not have delegated write authority");
		error.code = "DELEGATION_EXCEEDED";
		throw error;
	}
	if (!sessionHoldsWriteLease(workspaceRoot, parent.taskId, parent.sessionId)) {
		const error = new Error("parent does not own the active write lease");
		error.code = "LEASE_NOT_OWNER";
		throw error;
	}
	const previousParentMode = parent.mode;
	const previousChildMode = child.mode;
	releaseWriteLease(workspaceRoot, parent.taskId, { sessionId: parent.sessionId });
	try {
		parent.mode = "observe";
		child.mode = "write";
		writeSession(workspaceRoot, parent);
		writeSession(workspaceRoot, child);
		const lease = acquireWriteLease(workspaceRoot, {
			taskId: child.taskId,
			sessionId: child.sessionId,
			worktreePath: worktreePath || child.worktreePath || parent.worktreePath || "",
		});
		appendTaskEvent(workspaceRoot, child.taskId, "lease.writer_transferred", {
			sessionId: child.sessionId,
			fromSessionId: parent.sessionId,
			toSessionId: child.sessionId,
			parentMode: parent.mode,
			childMode: child.mode,
			leaseId: lease.leaseId,
		});
		return { parent: readSession(workspaceRoot, parent.sessionId), child: readSession(workspaceRoot, child.sessionId), lease };
	} catch (error) {
		parent.mode = previousParentMode;
		child.mode = previousChildMode;
		writeSession(workspaceRoot, parent);
		writeSession(workspaceRoot, child);
		try {
			acquireWriteLease(workspaceRoot, {
				taskId: parent.taskId,
				sessionId: parent.sessionId,
				worktreePath: parent.worktreePath || worktreePath || "",
			});
		} catch {
			// Preserve the original failure; caller can use explicit takeover/admin recovery.
		}
		throw error;
	}
}
