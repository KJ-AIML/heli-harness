#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTask } from "../lib/concurrency/task.mjs";
import { createSession, readSession } from "../lib/concurrency/session.mjs";
import { acquireWriteLease, readLease } from "../lib/concurrency/lease.mjs";
import { effectiveSessionAuthority, transferWriteAuthority } from "../lib/concurrency/authority.mjs";

const root = mkdtempSync(join(tmpdir(), "heli-session-hierarchy-"));
try {
	mkdirSync(join(root, ".heli-harness"), { recursive: true });
	createTask(root, { taskId: "hierarchy-t1", repositoryId: "demo", allowDuplicate: true });
	const parent = createSession(root, { sessionId: "hs_parent", taskId: "hierarchy-t1", mode: "write", delegation: { mode: "write" }, host: "test" });
	acquireWriteLease(root, { taskId: "hierarchy-t1", sessionId: parent.sessionId });
	const child = createSession(root, { sessionId: "hs_child", parentSessionId: parent.sessionId, mode: "observe", delegation: { mode: "write" }, role: "implementer", host: "test" });
	const sibling = createSession(root, { sessionId: "hs_sibling", parentSessionId: parent.sessionId, mode: "write", delegation: { mode: "write" }, role: "reviewer", host: "test" });
	assert.equal(child.taskId, "hierarchy-t1");
	assert.equal(effectiveSessionAuthority(root, child.sessionId).writeAllowed, false);
	const moved = transferWriteAuthority(root, { parentSessionId: parent.sessionId, childSessionId: child.sessionId });
	assert.equal(moved.parent.mode, "observe");
	assert.equal(moved.child.mode, "write");
	assert.equal(readLease(root, "hierarchy-t1").sessionId, child.sessionId);
	assert.equal(effectiveSessionAuthority(root, child.sessionId).writeAllowed, true);
	assert.equal(effectiveSessionAuthority(root, parent.sessionId).writeAllowed, false);
	assert.throws(() => acquireWriteLease(root, { taskId: "hierarchy-t1", sessionId: sibling.sessionId }), (error) => error.code === "LEASE_HELD");

	const sessionsDir = join(root, ".heli-harness", "sessions");
	mkdirSync(sessionsDir, { recursive: true });
	writeFileSync(join(sessionsDir, "legacy.json"), JSON.stringify({ schemaVersion: 1, sessionId: "legacy", host: "test", taskId: null, mode: "observe", status: "active" }));
	const legacy = readSession(root, "legacy");
	assert.equal(legacy.schemaVersion, 2);
	assert.equal(legacy.parentSessionId, null);
	assert.equal(legacy.role, "controller");
	console.log("session hierarchy smoke ok");
} finally {
	rmSync(root, { recursive: true, force: true });
}
