#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTask } from "../lib/concurrency/task.mjs";
import { createSession, readSession } from "../lib/concurrency/session.mjs";
import { observeRuntimeCapability } from "../lib/concurrency/attestation.mjs";
import { recordGuardDecision } from "../lib/concurrency/governance-decision.mjs";

const root = mkdtempSync(join(tmpdir(), "heli-runtime-attestation-"));
try {
	mkdirSync(join(root, ".heli-harness"), { recursive: true });
	createTask(root, { taskId: "runtime-t1", repositoryId: "demo", allowDuplicate: true });
	createSession(root, { sessionId: "hs_runtime", taskId: "runtime-t1", mode: "observe", host: "claude" });
	observeRuntimeCapability(root, "hs_runtime", { host: "claude", capability: "session_start", source: "SessionStart" });
	observeRuntimeCapability(root, "hs_runtime", { host: "claude", capability: "pre_tool", source: "PreToolUse" });
	const session = readSession(root, "hs_runtime");
	assert.equal(session.runtimeAttestation.host, "claude");
	assert.equal(session.runtimeAttestation.observedCapabilities.session_start.observed, true);
	assert.equal(session.runtimeAttestation.observedCapabilities.pre_tool.source, "PreToolUse");

	const result = { deny: true, code: "NO_LEASE", reason: "test denial", ctx: { workspaceRoot: root, taskId: "runtime-t1", sessionId: "hs_runtime" } };
	const decision = recordGuardDecision(result, { host: "claude", toolName: "Write", source: "PreToolUse" });
	assert.equal(decision.code, "NO_LEASE");
	assert.equal(result.decision.effect, "deny");
	const events = readFileSync(join(root, ".heli-harness", "tasks", "runtime-t1", "events.jsonl"), "utf8").trim().split(/\r?\n/).map(JSON.parse);
	const guard = events.find((event) => event.type === "guard.decision");
	assert.ok(guard, "denied guard decision should be durable");
	assert.equal(guard.eventSchemaVersion, 2);
	assert.equal(guard.payload.decision.code, "NO_LEASE");
	console.log("runtime attestation smoke ok");
} finally {
	rmSync(root, { recursive: true, force: true });
}
