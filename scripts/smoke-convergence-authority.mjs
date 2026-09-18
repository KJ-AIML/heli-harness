#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTask } from "../lib/concurrency/task.mjs";
import { createSession, attachSession, closeSession } from "../lib/concurrency/session.mjs";
import { acquireWriteLease, readLease } from "../lib/concurrency/lease.mjs";
import { effectiveSessionAuthority, transferWriteAuthority } from "../lib/concurrency/authority.mjs";
import {
	evaluatePreToolUse,
	resolveExecutionContext,
} from "../.heli-harness/adapters/shared/hook-core.mjs";

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "heli-convergence-authority-"));
	mkdirSync(join(root, ".heli-harness", "workspace"), { recursive: true });
	writeFileSync(join(root, ".heli-harness", "HARNESS.md"), "# Heli-Harness\n");
	writeFileSync(join(root, ".heli-harness", "workspace", "schema.json"), JSON.stringify({ schemaVersion: 1, mode: "concurrent" }) + "\n");
	return root;
}

{
	const root = fixture();
	try {
		createTask(root, { taskId: "lease-a", repositoryId: "demo", worktreePath: root, allowDuplicate: true });
		createTask(root, { taskId: "lease-b", repositoryId: "demo", worktreePath: root, allowDuplicate: true });
		const a = createSession(root, { sessionId: "lease_owner_a", taskId: "lease-a", mode: "write", worktreePath: root });
		const b = createSession(root, { sessionId: "lease_owner_b", taskId: "lease-b", mode: "write", worktreePath: root });
		acquireWriteLease(root, { taskId: "lease-a", sessionId: a.sessionId, worktreePath: root, ttlSeconds: 0.001 });
		await new Promise((resolve) => setTimeout(resolve, 10));
		acquireWriteLease(root, { taskId: "lease-b", sessionId: b.sessionId, worktreePath: root });
		assert.equal(readLease(root, "lease-b").sessionId, b.sessionId);
		assert.throws(
			() => acquireWriteLease(root, { taskId: "lease-a", sessionId: a.sessionId, worktreePath: root }),
			(error) => error.code === "WORKTREE_WRITER_HELD",
		);
		console.log("ok: expired owner cannot self-renew beside a new worktree writer");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

{
	const root = fixture();
	try {
		createTask(root, { taskId: "hierarchy", repositoryId: "demo", worktreePath: root, allowDuplicate: true });
		const parent = createSession(root, { sessionId: "parent", taskId: "hierarchy", mode: "write", delegation: { mode: "write" }, worktreePath: root });
		acquireWriteLease(root, { taskId: "hierarchy", sessionId: parent.sessionId, worktreePath: root });
		const child = createSession(root, { sessionId: "child", parentSessionId: parent.sessionId, mode: "observe", delegation: { mode: "write" }, worktreePath: root });
		transferWriteAuthority(root, { parentSessionId: parent.sessionId, childSessionId: child.sessionId, worktreePath: root });
		assert.equal(effectiveSessionAuthority(root, child.sessionId).writeAllowed, true);
		closeSession(root, parent.sessionId);
		const afterClose = effectiveSessionAuthority(root, child.sessionId);
		assert.equal(afterClose.delegationActive, false);
		assert.equal(afterClose.writeAllowed, false);
		assert.match(afterClose.reason, /PARENT|ANCESTOR/);
		const denied = evaluatePreToolUse({ cwd: root, host: "test", env: { ...process.env, HELI_SESSION_ID: child.sessionId }, toolName: "Write", toolInput: { file_path: "src/after-close.js" } });
		assert.equal(denied.deny, true);
		assert.match(denied.code || "", /PARENT|ANCESTOR|SESSION/);
		console.log("ok: parent closure revokes descendant effective write authority");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

{
	const root = fixture();
	try {
		createTask(root, { taskId: "surface", repositoryId: "demo", worktreePath: root, allowDuplicate: true });
		const writer = createSession(root, { sessionId: "writer", taskId: "surface", mode: "write", worktreePath: root });
		acquireWriteLease(root, { taskId: "surface", sessionId: writer.sessionId, worktreePath: root });
		const reviewer = createSession(root, { sessionId: "reviewer", mode: "observe", worktreePath: root });
		attachSession(root, reviewer.sessionId, "surface", { mode: "observe", worktreePath: root });
		const env = { ...process.env, HELI_SESSION_ID: reviewer.sessionId };
		const mixed = evaluatePreToolUse({
			cwd: root,
			host: "test",
			env,
			toolName: "multi_edit",
			toolInput: { edits: [
				{ file_path: ".heli-harness/tasks/surface/current-task.md", content: "x" },
				{ file_path: "src/app.js", content: "y" },
			] },
		});
		assert.equal(mixed.deny, true);
		assert.equal(mixed.code, "NOT_WRITE_MODE");
		const shell = evaluatePreToolUse({ cwd: root, host: "test", env, toolName: "Bash", toolInput: { command: "printf x > src/app.js" } });
		assert.equal(shell.deny, true);
		assert.equal(shell.code, "NOT_WRITE_MODE");
		assert.equal(shell.coverage, "shell-mutation-best-effort");
		console.log("ok: mixed structured paths and common shell writes face ownership authority");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}
console.log("smoke-convergence-authority: passed");


{
	const root = fixture();
	try {
		const claude = createSession(root, {
			sessionId: "host-claude",
			host: "claude",
			externalHostSessionId: "same-external-id",
			worktreePath: root,
		});
		const opencode = createSession(root, {
			sessionId: "host-opencode",
			host: "opencode",
			externalHostSessionId: "same-external-id",
			worktreePath: root,
		});
		const claudeCtx = resolveExecutionContext({
			cwd: root,
			host: "claude",
			hookPayload: { session_id: "same-external-id" },
			createIfMissing: false,
		});
		const opencodeCtx = resolveExecutionContext({
			cwd: root,
			host: "opencode",
			hookPayload: { session_id: "same-external-id" },
			createIfMissing: false,
		});
		assert.equal(claudeCtx.sessionId, claude.sessionId);
		assert.equal(opencodeCtx.sessionId, opencode.sessionId);
		const unknownHost = resolveExecutionContext({
			cwd: root,
			host: "other-host",
			hookPayload: { session_id: "same-external-id" },
			createIfMissing: false,
		});
		assert.equal(unknownHost.sessionId, null, "explicit unmatched host session must not inherit another host binding");
		console.log("ok: external host session identity is namespaced by host");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}
