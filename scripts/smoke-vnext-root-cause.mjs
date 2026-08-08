#!/usr/bin/env node
/**
 * Deterministic Heli vNext behavior contract.
 * This is a local governance smoke, not an agent or provider benchmark.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTask } from "../lib/concurrency/task.mjs";
import {
	startDiagnosis,
	readDiagnosis,
	setHypothesis,
	recordEvidence,
	classifyHypothesis,
	establishRootCause,
	recordRun,
	recordCheckpoint,
	authorizeAction,
	evaluateActionGate,
	evaluateDiagnosisWriteGate,
	evaluateDiagnosisCompletion,
} from "../.heli-harness/adapters/shared/concurrency/diagnosis.mjs";

const root = mkdtempSync(join(tmpdir(), "heli-vnext-root-cause-"));

function signature(overrides = {}) {
	return {
		operationStage: "browser-observer",
		subsystem: "observer",
		errorClass: "timeout",
		terminalStatus: "failed",
		assertion: "job reaches terminal state",
		environment: "fixture",
		provider: "fake-provider",
		normalizedMessage: "observer deadline expired before terminal state",
		sourceSha: "sha-a",
		...overrides,
	};
}

function fixtureTask(taskId, riskTier = "S2") {
	const task = createTask(root, {
		taskId,
		title: taskId,
		workItemKey: taskId,
		repositoryId: "heli-harness",
		worktreePath: root,
	});
	const currentPath = join(root, ".heli-harness", "tasks", taskId, "current-task.md");
	writeFileSync(currentPath, `# Current Task\n\nTask: ${taskId}\n\nRisk tier: ${riskTier}\n\nCurrent status: active\n`);
	return task;
}

try {
	mkdirSync(join(root, ".heli-harness", "workspace"), { recursive: true });
	mkdirSync(join(root, ".heli-harness", "safety"), { recursive: true });
	writeFileSync(join(root, ".heli-harness", "HARNESS.md"), "# Heli-Harness\n");
	writeFileSync(join(root, ".heli-harness", "workspace", "schema.json"), JSON.stringify({ schemaVersion: 1, mode: "concurrent" }));
	writeFileSync(join(root, ".heli-harness", "safety", "expensive-actions.json"), JSON.stringify({ schemaVersion: 1, actions: [] }));

	// Scenario 1 — false premise: observer timeout does not prove worker death.
	fixtureTask("false-premise");
	startDiagnosis(root, "false-premise", {
		symptom: "worker is dead",
		closestProvenBoundary: "observer deadline expired before terminal job state was observed",
		responsibleSubsystem: "observer",
		activationReason: "disputed-premise",
	});
	const falsePremise = readDiagnosis(root, "false-premise");
	assert.equal(falsePremise.premiseStatus, "UNVERIFIED");
	assert.equal(falsePremise.closestProvenBoundary.kind, "observed-fact");
	assert.equal(evaluateDiagnosisWriteGate(falsePremise, { riskTier: "S2", isWrite: true }).allowed, false);

	// Scenario 1b — malformed diagnosis state fails closed instead of looking absent.
	const malformedDir = join(root, ".heli-harness", "tasks", "malformed");
	mkdirSync(malformedDir, { recursive: true });
	writeFileSync(join(malformedDir, "diagnosis.json"), "{not-json", "utf8");
	const malformed = readDiagnosis(root, "malformed");
	assert.equal(malformed.stateIntegrity, "malformed");
	assert.equal(evaluateDiagnosisWriteGate(malformed, { riskTier: "S2", isWrite: true }).code, "DIAGNOSIS_STATE_INVALID");
	assert.equal(evaluateDiagnosisCompletion(malformed, { riskTier: "S2" }).code, "DIAGNOSIS_STATE_INVALID");

	// Scenario 2 — a worker claim event contradicts "queue never delivered".
	fixtureTask("contradicted");
	startDiagnosis(root, "contradicted", {
		symptom: "queue did not deliver the job",
		closestProvenBoundary: "worker has not reported completion",
		responsibleSubsystem: "queue",
	});
	setHypothesis(root, "contradicted", {
		hypothesis: "queue never delivered job",
		falsifier: "worker claim event exists",
		expectedResult: "no worker claim event is present",
	});
	recordEvidence(root, "contradicted", {
		kind: "contradicting",
		claim: "worker claim event exists",
		source: "fixture:event-17",
	});
	assert.equal(readDiagnosis(root, "contradicted").hypothesisStatus, "CONTRADICTED");
	assert.equal(readDiagnosis(root, "contradicted").rerouteRequired, true);

	// Scenario 3 — same failure after a relevant fix remains the same class.
	fixtureTask("same-failure", "S1");
	startDiagnosis(root, "same-failure", {
		symptom: "job observation failed",
		closestProvenBoundary: "observer deadline expired",
		responsibleSubsystem: "observer",
	});
	recordEvidence(root, "same-failure", { kind: "supporting", claim: "timeout is reproducible", source: "fixture:test-1" });
	setHypothesis(root, "same-failure", {
		hypothesis: "observer budget is too short",
		falsifier: "heartbeat disappears before deadline",
		expectedResult: "longer observation budget reaches terminal state",
	});
	classifyHypothesis(root, "same-failure", { status: "SUPPORTED_HYPOTHESIS" });
	establishRootCause(root, "same-failure", {
		rootCause: "observer budget expires before this fixture's terminal state",
		proposedSmallestCausalChange: "increase the local observer budget",
		verificationPrediction: "the fixture reaches terminal state without a timeout",
		falsifier: "heartbeat disappears before the new deadline",
	});	recordRun(root, "same-failure", { runId: "run-1", status: "failed", failureSignature: signature(), implementationFailure: false });
	const sameAfterFix = recordRun(root, "same-failure", { runId: "run-2", status: "failed", failureSignature: signature({ sourceSha: "sha-b" }), implementationFailure: true });
	assert.equal(sameAfterFix.failureSignature.classKey, readDiagnosis(root, "same-failure").failureSignature.classKey);
	assert.equal(sameAfterFix.attempts.sameFailureClass, 1);
	assert.equal(sameAfterFix.rerouteRequired, false);
	assert.equal(readDiagnosis(root, "same-failure").previousFailureContext.run.runId, "run-1");
	assert.equal(readDiagnosis(root, "same-failure").previousFailureContext.signature.classKey, sameAfterFix.failureSignature.classKey);

	// Scenario 4 — different downstream stage reroutes and does not burn the old count.
	fixtureTask("new-downstream");
	startDiagnosis(root, "new-downstream", { symptom: "verification failed", closestProvenBoundary: "observer timeout", responsibleSubsystem: "observer" });
	recordRun(root, "new-downstream", { runId: "run-a", status: "failed", failureSignature: signature() });
	const rerouted = recordRun(root, "new-downstream", {
		runId: "run-b",
		status: "failed",
		failureSignature: signature({ operationStage: "api-request", subsystem: "api", errorClass: "schema-mismatch", normalizedMessage: "api response schema mismatch" }),
	});
	assert.equal(rerouted.rerouteRequired, true);
	assert.equal(rerouted.routeReason, "NEW_FAILURE_CLASS");
	assert.equal(rerouted.attempts.sameFailureClass, 0);

	// Scenario 5 — subsystem change creates a checkpoint.
	fixtureTask("subsystem-change", "S1");
	startDiagnosis(root, "subsystem-change", { symptom: "job failed", closestProvenBoundary: "browser observer timed out", responsibleSubsystem: "browser" });
	recordRun(root, "subsystem-change", { runId: "run-c", status: "failed", failureSignature: signature({ subsystem: "browser" }) });
	const checkpointed = recordRun(root, "subsystem-change", {
		runId: "run-d",
		status: "failed",
		failureSignature: signature({ operationStage: "api", subsystem: "api", errorClass: "connection-reset", normalizedMessage: "api connection reset" }),
		checkpoint: {
			whatWeKnow: "browser observer reached the API call",
			whatChanged: "failure boundary moved from browser harness to API",
			whyPreviousSubsystemNoLongerPrimary: "request was emitted successfully",
			newClosestProvenBoundary: "API connection reset after request emission",
			nextDiscriminatingAction: "run the focused API fixture",
		},
	});
	assert.equal(checkpointed.subsystemCheckpoint.newResponsibleSubsystem, "api");
	assert.equal(checkpointed.checkpointRequired, false);

	// Scenarios 6–8 — expensive retries: deny no-change, allow material/discriminating/transient evidence.
	fixtureTask("retry-gate", "S1");
	startDiagnosis(root, "retry-gate", { symptom: "provider run failed", closestProvenBoundary: "provider returned timeout", responsibleSubsystem: "provider" });
	const firstAction = { actionId: "provider-backed-generation", costClass: "expensive", riskTier: "S1" };
	assert.equal((await authorizeAction(root, "retry-gate", firstAction)).allowed, true);
	recordRun(root, "retry-gate", { runId: "provider-run-1", status: "failed", failureSignature: signature({ subsystem: "provider", operationStage: "provider" }) });
	assert.equal(readDiagnosis(root, "retry-gate").previousFailureContext.retryGate.action.actionId, "provider-backed-generation");
	const deniedRetry = evaluateActionGate(readDiagnosis(root, "retry-gate"), firstAction);
	assert.equal(deniedRetry.allowed, false);
	assert.equal(deniedRetry.code, "RETRY_JUSTIFICATION_REQUIRED");
	assert.equal(evaluateActionGate(readDiagnosis(root, "retry-gate"), { ...firstAction, materialChange: { changed: true, summary: "sha-only claim", predictedEffect: "timeout path is removed", sourceShaBefore: "sha-a", sourceShaAfter: "sha-b" } }).allowed, false);
	assert.equal(evaluateActionGate(readDiagnosis(root, "retry-gate"), { ...firstAction, materialChange: { changed: true, summary: "provider adapter fix", predictedEffect: "timeout path is removed", files: ["adapters/provider.mjs"], sourceShaBefore: "sha-a", sourceShaAfter: "sha-b" } }).allowed, true);
	assert.equal(evaluateActionGate(readDiagnosis(root, "retry-gate"), { ...firstAction, discriminatingEvidence: { summary: "one bounded run distinguishes queue vs provider", cheaperActionsChecked: ["fixture", "logs"], cheaperUnavailableReason: "both are inconclusive" } }).allowed, true);
	assert.equal(evaluateActionGate(readDiagnosis(root, "retry-gate"), { ...firstAction, transientPolicy: { classification: "transient", policyId: "provider-timeout-once", maxRetries: 1, retryCount: 0 } }).allowed, true);

	// Scenario 9 — S1 remains autonomous after a self-checkable diagnosis.
	const s1 = readDiagnosis(root, "retry-gate");
	assert.equal(evaluateDiagnosisWriteGate(s1, { riskTier: "S1", isWrite: true }).allowed, true);

	// Scenario 10 — S2 exposes independent review for a material action.
	const s2Gate = evaluateActionGate(s1, { actionId: "shared-api-change", costClass: "normal", riskTier: "S2", materialChange: { changed: true, summary: "shared API change", predictedEffect: "changes response boundary", files: ["src/shared-api.mjs"] } });
	assert.equal(s2Gate.allowed, true);
	assert.equal(s2Gate.review.required, true);

	// Scenario 11 — S3 is human-controlled.
	const s3Gate = evaluateActionGate(s1, { actionId: "production-mutation", costClass: "expensive", riskTier: "S3", productionMutation: true });
	assert.equal(s3Gate.allowed, false);
	assert.equal(s3Gate.code, "HUMAN_APPROVAL_REQUIRED");

	// Scenario 12 — no diagnosis means no ceremony for a successful simple task.
	fixtureTask("simple-success", "S1");
	assert.equal(evaluateDiagnosisWriteGate(readDiagnosis(root, "simple-success"), { riskTier: "S1", isWrite: true }).allowed, true);
	assert.equal(evaluateDiagnosisCompletion(readDiagnosis(root, "simple-success"), { riskTier: "S1" }).allowed, true);
	assert.ok(existsSync(join(root, ".heli-harness", "tasks", "new-downstream", "events.jsonl")));

	console.log("smoke-vnext-root-cause: all 12 scenarios passed");
} finally {
	rmSync(root, { recursive: true, force: true });
}
