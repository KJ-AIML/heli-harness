#!/usr/bin/env node
/**
 * The two-strike counter counts consecutive failures, and completion asks for a root cause only when something failed.
 *
 * - The implementation-failure counter only ever grew (only a new failure class or a restart reset it), so after the first
 *   two strikes every further same-class failure forced another reroute, however much had changed. It now starts again
 *   after a reroute (two strikes per route) and after a passing run.
 * - An S2/S3 task whose diagnosis held only passing runs (nothing ever failed) could not complete without an "established
 *   root cause" of a failure that never happened. Completion now asks for one only when the diagnosis was activated by a
 *   failure or a disputed premise, as the write gate already did.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTask } from "../lib/concurrency/task.mjs";
import {
	evaluateDiagnosisCompletion,
	evaluateDiagnosisWriteGate,
	readDiagnosis,
	recordRun,
	routeDiagnosis,
} from "../.heli-harness/adapters/shared/concurrency/diagnosis.mjs";
import { scrubHeliProcessEnv } from "./lib/hermetic-env.mjs";

scrubHeliProcessEnv();
const root = mkdtempSync(join(tmpdir(), "heli-diagnosis-counters-"));
process.on("exit", () => rmSync(root, { recursive: true, force: true }));
mkdirSync(join(root, ".heli-harness", "workspace"), { recursive: true });
mkdirSync(join(root, ".heli-harness", "safety"), { recursive: true });
writeFileSync(join(root, ".heli-harness", "HARNESS.md"), "# Heli-Harness\n");
writeFileSync(join(root, ".heli-harness", "workspace", "schema.json"), JSON.stringify({ schemaVersion: 1, mode: "concurrent" }));
writeFileSync(join(root, ".heli-harness", "safety", "expensive-actions.json"), JSON.stringify({ schemaVersion: 1, actions: [] }));

const signature = {
	operationStage: "unit",
	subsystem: "parser",
	errorClass: "assertion",
	terminalStatus: "failed",
	assertion: "parses heredocs",
	environment: "fixture",
	provider: "none",
	normalizedMessage: "expected clean, got rm",
};
let runs = 0;
const fail = (taskId) => recordRun(root, taskId, { runId: `run-${(runs += 1)}`, status: "failed", failureSignature: signature, implementationFailure: true });
const pass = (taskId) => recordRun(root, taskId, { runId: `run-${(runs += 1)}`, status: "passed" });
function task(taskId) {
	createTask(root, { taskId, title: taskId, workItemKey: taskId, repositoryId: "demo", worktreePath: root });
	return taskId;
}

// 1. Two strikes per route: a reroute starts the count again.
{
	const id = task("per-route");
	fail(id);
	fail(id);
	assert.equal(readDiagnosis(root, id).rerouteRequired, true, "two same-class implementation failures require a reroute");
	assert.equal(readDiagnosis(root, id).routeReason, "TWO_STRIKES_SAME_FAILURE");
	routeDiagnosis(root, id, { route: "debug", reason: "two strikes" });
	assert.equal(readDiagnosis(root, id).attempts.implementationFailures, 0, "the reroute starts the count again");
	fail(id);
	assert.equal(readDiagnosis(root, id).rerouteRequired, false, "one failure on the new route is not two strikes");
	fail(id);
	assert.equal(readDiagnosis(root, id).rerouteRequired, true, "two on the new route are");
}

// 2. A passing run ends a streak.
{
	const id = task("streak");
	fail(id);
	pass(id);
	assert.equal(readDiagnosis(root, id).attempts.implementationFailures, 0, "a passing run starts the count again");
	fail(id);
	assert.equal(readDiagnosis(root, id).rerouteRequired, false, "fail, pass, fail is not two strikes");
}

// 3. Completion: a root cause only for a failure that happened.
{
	const id = task("only-passed");
	pass(id);
	const diagnosis = readDiagnosis(root, id);
	assert.equal(evaluateDiagnosisCompletion(diagnosis, { riskTier: "S2" }).allowed, true, "nothing failed: no root cause to establish");
	assert.equal(evaluateDiagnosisWriteGate(diagnosis, { riskTier: "S2", isWrite: true }).allowed, true);
}
{
	const id = task("failed-then-passed");
	recordRun(root, id, { runId: `run-${(runs += 1)}`, status: "failed", failureSignature: signature });
	pass(id);
	const completion = evaluateDiagnosisCompletion(readDiagnosis(root, id), { riskTier: "S2" });
	assert.equal(completion.allowed, false, "a recorded failure still needs its root cause before an S2 task completes");
	assert.equal(completion.code, "ROOT_CAUSE_EVIDENCE_REQUIRED");
	assert.equal(evaluateDiagnosisCompletion(readDiagnosis(root, id), { riskTier: "S1" }).allowed, true, "S1 never asked for one");
}

console.log("diagnosis counters smoke ok");
