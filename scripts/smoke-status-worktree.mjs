#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { install } from "../lib/cli/install.mjs";
import { status, resolveTaskWorktreeProjection } from "../lib/cli/status.mjs";
import {
	createTask,
	readTask,
	createSession,
	acquireWriteLease,
	writeBinding,
	attachSession,
	releaseWriteLease,
	readLease,
	canonicalizePath,
} from "../lib/concurrency/index.mjs";

const root = process.cwd();
const parent = mkdtempSync(join(tmpdir(), "heli-status-wt-"));
try {
	install(join(root, ".heli-harness"), parent);
	const ws = parent;
	const wtA = join(parent, "wt-a");
	const wtB = join(parent, "wt-b");
	mkdirSync(wtA, { recursive: true });
	mkdirSync(wtB, { recursive: true });

	createTask(ws, { taskId: "t-status", title: "Status", workItemKey: "S", repositoryId: "repo-a", worktreePath: wtB });
	// metadata points at wtB but live lease will be wtA
	const ses = createSession(ws, {
		host: "test",
		taskId: "t-status",
		mode: "write",
		worktreePath: wtA,
	});
	acquireWriteLease(ws, { taskId: "t-status", sessionId: ses.sessionId, worktreePath: wtA });
	writeBinding(ws, { worktreePath: wtA, taskId: "t-status", sessionId: ses.sessionId, mode: "write" });

	const s = status(ws);
	assert.equal(s.mode, "concurrent");
	const row = s.taskSummaries.find((t) => t.taskId === "t-status");
	assert.ok(row, "task summary present");
	assert.equal(row.writer, ses.sessionId);
	assert.equal(canonicalizePath(row.worktree), canonicalizePath(wtA));
	assert.equal(row.worktreeSource, "write-lease");
	assert.match(row.leaseStatus, /active/);
	assert.ok(row.warnings.some((w) => /differs from live/i.test(w)) || canonicalizePath(wtA) !== canonicalizePath(wtB));
	console.log("smoke-status-worktree: active writer projection ok");

	const staleMetadata = readTask(ws, "t-status");
	staleMetadata.target.worktreePath = "/source-machine/workspace/repos/old-demo";
	delete staleMetadata.target.workspaceRelativeWorktreePath;
	delete staleMetadata.target.workspaceRelativeRepositoryPath;
	writeFileSync(join(ws, ".heli-harness", "tasks", "t-status", "task.json"), JSON.stringify(staleMetadata, null, 2) + "\n");
	const liveWinsOverStale = status(ws).taskSummaries.find((t) => t.taskId === "t-status");
	assert.equal(liveWinsOverStale.worktreeSource, "write-lease");
	assert.equal(liveWinsOverStale.worktreeStale, false);
	console.log("smoke-status-worktree: live lease wins over stale metadata");

	// no-writer task
	createTask(ws, { taskId: "t-idle", workItemKey: "I", repositoryId: "repo-b" });
	const s2 = status(ws);
	const idle = s2.taskSummaries.find((t) => t.taskId === "t-idle");
	assert.equal(idle.writer, "none");
	assert.match(idle.leaseStatus, /none|stale|malformed/i);
	console.log("smoke-status-worktree: no-writer ok");

	createTask(ws, { taskId: "t-missing", workItemKey: "M", repositoryId: "repo-missing", worktreePath: join(ws, "missing-repo") });
	const missing = status(ws).taskSummaries.find((t) => t.taskId === "t-missing");
	assert.equal(missing.worktreeSource, "task-metadata-relative");
	assert.equal(missing.worktreeStale, true);
	assert.equal(missing.worktreeStaleReason, "missing-destination");
	console.log("smoke-status-worktree: missing relative target is stale");

	const legacy = createTask(ws, { taskId: "t-legacy", workItemKey: "L", repositoryId: "repo-legacy" });
	legacy.target.worktreePath = "/source-machine/workspace/repos/legacy";
	delete legacy.target.workspaceRelativeWorktreePath;
	delete legacy.target.workspaceRelativeRepositoryPath;
	writeFileSync(join(ws, ".heli-harness", "tasks", "t-legacy", "task.json"), JSON.stringify(legacy, null, 2) + "\n");
	const legacyRow = status(ws).taskSummaries.find((t) => t.taskId === "t-legacy");
	assert.equal(legacyRow.worktreeSource, "task-metadata-stale");
	assert.equal(legacyRow.worktreeStale, true);
	assert.equal(legacyRow.worktreeStaleReason, "legacy-no-index-match");
	console.log("smoke-status-worktree: unsafe legacy target is stale");

	// review-only
	const rev = createSession(ws, { host: "review", worktreePath: wtB, mode: "review" });
	attachSession(ws, rev.sessionId, "t-status", { mode: "review", worktreePath: wtB });
	const s3 = status(ws);
	const row3 = s3.taskSummaries.find((t) => t.taskId === "t-status");
	assert.ok(row3.reviewerCount >= 1);
	assert.equal(row3.writer, ses.sessionId);
	console.log("smoke-status-worktree: reviewers counted ok");

	// stale lease projection warns
	const lease = readLease(ws, "t-status");
	lease.expiresAt = new Date(Date.now() - 1000).toISOString();
	writeFileSync(
		join(ws, ".heli-harness", "locks", "tasks", "t-status.write.lock", "lease.json"),
		JSON.stringify(lease, null, 2),
	);
	const task = readTask(ws, "t-status");
	const proj = resolveTaskWorktreeProjection(ws, task);
	assert.match(proj.leaseStatus, /stale/);
	assert.ok(proj.warnings.some((w) => /stale/i.test(w)));
	console.log("smoke-status-worktree: stale lease ok");
} finally {
	rmSync(parent, { recursive: true, force: true });
}

console.log("smoke-status-worktree: ok");
