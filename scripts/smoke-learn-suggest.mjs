#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { install } from "../lib/cli/install.mjs";
import { createTask } from "../lib/concurrency/task.mjs";
import { appendTaskEvent } from "../lib/concurrency/events.mjs";
import { taskPaths } from "../lib/concurrency/paths.mjs";
import { writeJsonAtomic } from "../lib/concurrency/fs-atomic.mjs";
import { suggestLearnings } from "../lib/learning/suggest.mjs";

const root = process.cwd();
const workspace = mkdtempSync(join(tmpdir(), "heli-learn-suggest-"));
try {
	install(join(root, ".heli-harness"), workspace);
	for (const taskId of ["learn-a", "learn-b"]) {
		createTask(workspace, {
			taskId,
			title: taskId,
			repositoryId: "demo",
			repositoryPath: workspace,
			worktreePath: workspace,
			allowDuplicate: true,
		});
		appendTaskEvent(workspace, taskId, "guard.decision", {
			sessionId: `session-${taskId}`,
			decision: {
				code: "TIER_APPROVAL_REQUIRED",
				effect: "deny",
				host: "fixture",
				toolName: "bash",
				reason: "release command requires approval",
			},
		});
		writeJsonAtomic(taskPaths(workspace, taskId).diagnosisJson, {
			diagnosisId: `diagnosis-${taskId}`,
			rootCauseStatus: "ESTABLISHED",
			rootCause: "adapter config omitted the provider key",
			responsibleSubsystem: "adapter",
			lastVerification: { outcome: "passed", runId: `verify-${taskId}` },
		});
	}

	const report = suggestLearnings(workspace, { threshold: 2 });
	assert.equal(report.readOnly, true);
	assert.equal(report.autoApply, false);
	assert.equal(report.tasksScanned, 2);
	assert.ok(report.candidates.some((candidate) => candidate.key === "guard:TIER_APPROVAL_REQUIRED"));
	assert.ok(report.candidates.some((candidate) => candidate.kind === "verified-pattern-review"));
	assert.ok(report.candidates.every((candidate) => candidate.autoApply === false));
	console.log("learning suggestion smoke ok");
} finally {
	rmSync(workspace, { recursive: true, force: true });
}
