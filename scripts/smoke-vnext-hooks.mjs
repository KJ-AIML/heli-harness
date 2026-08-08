#!/usr/bin/env node
/** Prove supported shared PreToolUse semantics for reroute and retry gates. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTask } from "../lib/concurrency/task.mjs";
import { createSession, attachSession } from "../lib/concurrency/session.mjs";
import { acquireWriteLease } from "../lib/concurrency/lease.mjs";
import { startDiagnosis, recordRun } from "../.heli-harness/adapters/shared/concurrency/diagnosis.mjs";
import { buildSessionContext, evaluatePreToolUse } from "../.heli-harness/adapters/shared/hook-core.mjs";

const root = mkdtempSync(join(tmpdir(), "heli-vnext-hooks-"));
const sessionId = "heli-ses-vnext-hooks";

function failure(overrides = {}) {
	return {
		operationStage: "provider-run",
		subsystem: "provider",
		errorClass: "timeout",
		terminalStatus: "failed",
		environment: "fixture",
		provider: "fake",
		normalizedMessage: "provider timeout",
		sourceSha: "sha-a",
		...overrides,
	};
}

try {
	mkdirSync(join(root, ".heli-harness", "workspace"), { recursive: true });
	mkdirSync(join(root, ".heli-harness", "safety"), { recursive: true });
	writeFileSync(join(root, ".heli-harness", "HARNESS.md"), "# Heli-Harness\n");
	writeFileSync(join(root, ".heli-harness", "workspace", "schema.json"), JSON.stringify({ schemaVersion: 1, mode: "concurrent" }));
	writeFileSync(join(root, ".heli-harness", "safety", "expensive-actions.json"), JSON.stringify({ schemaVersion: 1, actions: [{ id: "provider-backed-generation", match: ["provider-backed-generation"], costClass: "expensive" }] }));
	const task = createTask(root, { taskId: "hook-gates", title: "hook-gates", workItemKey: "hook-gates", repositoryId: "heli-harness", worktreePath: root });
	writeFileSync(join(root, ".heli-harness", "tasks", task.taskId, "current-task.md"), "# Current Task\n\nTask: hook-gates\n\nRisk tier: S2\n\nCurrent status: active\n");
	const session = createSession(root, { sessionId, host: "smoke", worktreePath: root });
	attachSession(root, session.sessionId, task.taskId, { mode: "write", worktreePath: root });
	acquireWriteLease(root, { taskId: task.taskId, sessionId, worktreePath: root });
	startDiagnosis(root, task.taskId, { symptom: "provider is unavailable", closestProvenBoundary: "provider request timed out", responsibleSubsystem: "provider", riskTier: "S2" });
	recordRun(root, task.taskId, { runId: "provider-run-1", status: "failed", failureSignature: failure() });
	recordRun(root, task.taskId, { runId: "api-run-2", status: "failed", failureSignature: failure({ operationStage: "api", subsystem: "api", errorClass: "schema-mismatch", normalizedMessage: "api response schema mismatch" }) });

	const env = { ...process.env, HELI_SESSION_ID: sessionId };
	const reroute = evaluatePreToolUse({ cwd: root, toolName: "Write", toolInput: { file_path: "src/fix.mjs" }, host: "codex-style", env });
	assert.equal(reroute.deny, true);
	assert.equal(reroute.code, "DIAGNOSIS_REROUTE_REQUIRED");

	const retry = evaluatePreToolUse({
		cwd: root,
		toolName: "Bash",
		toolInput: { command: "provider-run", heli_action: { actionId: "provider-backed-generation", riskTier: "S1" } },
		host: "codex-style",
		env,
	});
	assert.equal(retry.deny, true);
	assert.equal(retry.code, "RETRY_JUSTIFICATION_REQUIRED");

	const yolo = evaluatePreToolUse({ cwd: root, toolName: "Write", toolInput: { file_path: "src/fix.mjs" }, host: "codex-style", env: { ...env, HELI_YOLO: "1" } });
	assert.equal(yolo.deny, true, "YOLO must not bypass root-cause reroute gates");
	assert.match(buildSessionContext(root, { host: "codex-style", env }), /Active diagnosis/);
	console.log("smoke-vnext-hooks: shared reroute/retry/YOLO gates passed");
} finally {
	rmSync(root, { recursive: true, force: true });
}
