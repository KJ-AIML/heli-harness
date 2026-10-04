#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const api = await import(pathToFileURL(join(root, "lib/concurrency/index.mjs")).href);
const { evaluatePreToolUse } = await import(pathToFileURL(join(root, ".heli-harness/adapters/shared/hook-core.mjs")).href);
const {
	createTask,
	createSession,
	writeBinding,
	resolveExecutionContext,
	evaluateOwnershipGate,
	acquireWriteLease,
	readLease,
} = api;

function workspace(label) {
	const dir = mkdtempSync(join(tmpdir(), `heli-flow-first-${label}-`));
	mkdirSync(join(dir, ".heli-harness", "state"), { recursive: true });
	mkdirSync(join(dir, ".heli-harness", "workspace"), { recursive: true });
	mkdirSync(join(dir, ".heli-harness", "safety"), { recursive: true });
	writeFileSync(join(dir, ".heli-harness", "HARNESS.md"), "# Heli-Harness\n");
	writeFileSync(
		join(dir, ".heli-harness", "workspace", "index.json"),
		JSON.stringify({
			schemaVersion: 1,
			workspaceRoot: ".",
			repos: [{ name: "demo", path: ".", gitRoot: "." }],
		}) + "\n",
	);
	writeFileSync(
		join(dir, ".heli-harness", "workspace", "target.json"),
		JSON.stringify({ schemaVersion: 1, targetRepo: "demo", targetGitRoot: dir, writesAllowedUnder: dir }) + "\n",
	);
	writeFileSync(
		join(dir, ".heli-harness", "safety", "command-rules.json"),
		JSON.stringify({ rules: [] }) + "\n",
	);
	return dir;
}

function boundWriteSession(dir, taskId, sessionId) {
	createTask(dir, {
		taskId,
		title: taskId,
		repositoryId: "demo",
		worktreePath: dir,
		mode: "strict",
	});
	const session = createSession(dir, {
		sessionId,
		host: "test-host",
		taskId,
		mode: "write",
		worktreePath: dir,
	});
	writeBinding(dir, {
		worktreePath: dir,
		taskId,
		sessionId,
		host: "test-host",
		mode: "write",
	});
	return session;
}

function ctxFor(dir, sessionId) {
	return resolveExecutionContext({
		cwd: dir,
		environment: { ...process.env, HELI_SESSION_ID: sessionId },
		host: "test-host",
		createIfMissing: false,
	});
}

// A bound writer with no lease and no conflicting worktree owner should heal
// inside the ownership decision instead of returning NO_LEASE.
{
	const dir = workspace("auto-acquire");
	try {
		boundWriteSession(dir, "task-a", "session-a");
		assert.equal(readLease(dir, "task-a"), null);
		const decision = evaluateOwnershipGate(ctxFor(dir, "session-a"), { isWrite: true });
		assert.equal(decision.deny, false);
		assert.equal(decision.code, "LEASE_AUTO_ACQUIRED");
		assert.equal(decision.autoRecovered, true);
		assert.equal(readLease(dir, "task-a")?.sessionId, "session-a");
		console.log("ok: bound writer auto-acquires missing lease");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// Flow-first must not turn explicit review intent into writer authority.
{
	const dir = workspace("review-stays-review");
	try {
		createTask(dir, { taskId: "task-r", title: "task-r", repositoryId: "demo", worktreePath: dir, mode: "strict" });
		createSession(dir, { sessionId: "reviewer", host: "test-host", taskId: "task-r", mode: "review", worktreePath: dir });
		writeBinding(dir, { worktreePath: dir, taskId: "task-r", sessionId: "reviewer", host: "test-host", mode: "review" });
		const decision = evaluateOwnershipGate(ctxFor(dir, "reviewer"), { isWrite: true });
		assert.equal(decision.deny, true);
		assert.equal(decision.code, "NOT_WRITE_MODE");
		assert.equal(readLease(dir, "task-r"), null);
		console.log("ok: review intent is not auto-upgraded");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// A live writer on the same worktree remains a real conflict.
{
	const dir = workspace("live-conflict");
	try {
		boundWriteSession(dir, "task-owner", "owner");
		acquireWriteLease(dir, { taskId: "task-owner", sessionId: "owner", worktreePath: dir });
		createTask(dir, { taskId: "task-contender", title: "task-contender", repositoryId: "demo", worktreePath: dir, mode: "strict", allowDuplicate: true });
		createSession(dir, { sessionId: "contender", host: "test-host", taskId: "task-contender", mode: "write", worktreePath: dir });
		writeBinding(dir, { worktreePath: dir, taskId: "task-contender", sessionId: "contender", host: "test-host", mode: "write" });
		const decision = evaluateOwnershipGate(ctxFor(dir, "contender"), { isWrite: true });
		assert.equal(decision.deny, true);
		assert.equal(decision.code, "WORKTREE_WRITER_HELD");
		assert.equal(readLease(dir, "task-contender"), null);
		console.log("ok: live worktree writer remains fail-closed");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// The host-facing guard must tell an agent to stop retrying a live-writer
// conflict, and the blocker fingerprint must stay stable while authority state
// is unchanged.
{
	const dir = workspace("host-stop-retry");
	try {
		boundWriteSession(dir, "task-owner", "owner");
		acquireWriteLease(dir, { taskId: "task-owner", sessionId: "owner", worktreePath: dir });
		createTask(dir, { taskId: "task-contender", title: "task-contender", repositoryId: "demo", worktreePath: dir, mode: "strict", allowDuplicate: true });
		createSession(dir, { sessionId: "contender", host: "test-host", taskId: "task-contender", mode: "write", worktreePath: dir });
		writeBinding(dir, { worktreePath: dir, taskId: "task-contender", sessionId: "contender", host: "test-host", mode: "write" });
		const call = () => evaluatePreToolUse({
			cwd: dir,
			toolName: "Write",
			toolInput: { file_path: join(dir, "note.txt"), content: "x\n" },
			host: "test-host",
			env: { ...process.env, HELI_SESSION_ID: "contender" },
		});
		const first = call();
		const second = call();
		assert.equal(first.deny, true);
		assert.equal(first.recoverability, "HUMAN_REQUIRED");
		assert.equal(first.retryable, false);
		assert.match(first.reason || "", /STOP: do not try alternate write commands/i);
		assert.match(first.blockerFingerprint || "", /^heli-block-/);
		assert.equal(second.blockerFingerprint, first.blockerFingerprint);
		assert.equal(second.retryable, false);
		console.log("ok: host denial is stable and tells the agent to stop retrying");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// Recovery/read Heli control-plane commands stay usable even while another
// writer owns the worktree. Explicit takeover remains human-only.
{
	const dir = workspace("recovery-control-plane");
	try {
		boundWriteSession(dir, "task-owner", "owner");
		acquireWriteLease(dir, { taskId: "task-owner", sessionId: "owner", worktreePath: dir });
		createTask(dir, { taskId: "task-contender", title: "task-contender", repositoryId: "demo", worktreePath: dir, mode: "strict", allowDuplicate: true });
		createSession(dir, { sessionId: "contender", host: "test-host", taskId: "task-contender", mode: "write", worktreePath: dir });
		writeBinding(dir, { worktreePath: dir, taskId: "task-contender", sessionId: "contender", host: "test-host", mode: "write" });
		const env = { ...process.env, HELI_SESSION_ID: "contender" };
		for (const command of [
			"heli status",
			"heli resume --json",
			"heli explain authority",
			"heli explain capabilities",
			"heli task claim task-contender --mode write",
			"heli task release task-contender",
			"heli session status",
		]) {
			const decision = evaluatePreToolUse({ cwd: dir, toolName: "Bash", toolInput: { command }, host: "test-host", env });
			assert.equal(decision.deny, false, `${command} should remain usable as recovery/control-plane intent`);
		}
		const takeover = evaluatePreToolUse({
			cwd: dir,
			toolName: "Bash",
			toolInput: { command: "heli task takeover task-owner --confirm" },
			host: "test-host",
			env,
		});
		assert.equal(takeover.deny, true);
		assert.equal(takeover.code, "TIER_BLOCKED");
		assert.match(takeover.reason || "", /human|hard deny/i);
		console.log("ok: recovery control plane flows while takeover stays human-only");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

console.log("smoke-flow-first-governance: ok");
