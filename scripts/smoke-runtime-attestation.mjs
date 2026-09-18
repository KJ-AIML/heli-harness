#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTask } from "../lib/concurrency/task.mjs";
import { createSession, readSession } from "../lib/concurrency/session.mjs";
import {
	observeRuntimeCapability,
	currentObservedCapabilityMap,
	runtimeObservationStatus,
} from "../lib/concurrency/attestation.mjs";
import { recordGuardDecision } from "../lib/concurrency/governance-decision.mjs";

const root = mkdtempSync(join(tmpdir(), "heli-runtime-attestation-"));
try {
	mkdirSync(join(root, ".heli-harness"), { recursive: true });
	createTask(root, { taskId: "runtime-t1", repositoryId: "demo", allowDuplicate: true });
	createSession(root, { sessionId: "hs_runtime", taskId: "runtime-t1", mode: "observe", host: "claude" });
	observeRuntimeCapability(root, "hs_runtime", {
		host: "claude",
		capability: "session_start",
		source: "SessionStart",
		runtimeInstanceId: "runtime-a",
		adapterDigest: "adapter-a",
	});
	observeRuntimeCapability(root, "hs_runtime", {
		host: "claude",
		capability: "pre_tool",
		source: "PreToolUse",
		runtimeInstanceId: "runtime-a",
		adapterDigest: "adapter-a",
	});
	const session = readSession(root, "hs_runtime");
	assert.equal(session.runtimeAttestation.host, "claude");
	assert.equal(session.runtimeAttestation.observedCapabilities.session_start.observed, true);
	assert.equal(session.runtimeAttestation.observedCapabilities.pre_tool.source, "PreToolUse");
	assert.equal(session.runtimeAttestation.observedCapabilities.pre_tool.runtimeInstanceId, "runtime-a");
	assert.equal(
		currentObservedCapabilityMap(session, {
			host: "claude",
			runtimeInstanceId: "runtime-a",
			adapterDigest: "adapter-a",
		}).pre_tool.current,
		true,
	);
	assert.equal(
		runtimeObservationStatus(session.runtimeAttestation.observedCapabilities.pre_tool, {
			host: "claude",
			runtimeInstanceId: "runtime-b",
		}).current,
		false,
		"runtime identity mismatch must invalidate current capability evidence",
	);

	const result = { deny: true, code: "NO_LEASE", reason: "test denial", ctx: { workspaceRoot: root, taskId: "runtime-t1", sessionId: "hs_runtime" } };
	const decision = recordGuardDecision(result, { host: "claude", toolName: "Write", source: "PreToolUse" });
	assert.equal(decision.code, "NO_LEASE");
	assert.equal(result.decision.effect, "deny");
	assert.equal(result.decision.decisionSchemaVersion, 1);
	assert.match(result.decision.decisionId, /^heli-dec-/);
	const events = readFileSync(join(root, ".heli-harness", "tasks", "runtime-t1", "events.jsonl"), "utf8").trim().split(/\r?\n/).map(JSON.parse);
	const guard = events.find((event) => event.type === "guard.decision");
	assert.ok(guard, "denied guard decision should be durable");
	assert.equal(guard.eventSchemaVersion, 2);
	assert.equal(guard.payload.decision.code, "NO_LEASE");
	console.log("runtime attestation smoke ok");
} finally {
	rmSync(root, { recursive: true, force: true });
}
