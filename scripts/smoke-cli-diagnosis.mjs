#!/usr/bin/env node
/** Prove diagnosis transitions are available through the embedded CLI surface. */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { install } from "../lib/cli/install.mjs";

const root = process.cwd();
const parent = mkdtempSync(join(tmpdir(), "heli-cli-diagnosis-"));
const heli = join(root, "bin", "heli.mjs");
const session = "heli-ses-cli-diagnosis";

function run(args, { expectFail = false } = {}) {
	const result = spawnSync(process.execPath, [heli, ...args, parent], {
		encoding: "utf8",
		env: { ...process.env, HELI_SESSION_ID: session },
	});
	const out = `${result.stdout}\n${result.stderr}`;
	if (expectFail) assert.notEqual(result.status, 0, `expected failure: ${out}`);
	else assert.equal(result.status, 0, `command failed: ${out}`);
	return out;
}

try {
	install(join(root, ".heli-harness"), parent);
	run(["task", "create", "cli-diagnosis", "--repo", "heli-harness"]);
	run(["task", "claim", "cli-diagnosis", "--mode", "write"]);
	run([
		"diagnosis",
		"init",
		"cli-diagnosis",
		"--json",
		JSON.stringify({ symptom: "fixture failed", closestProvenBoundary: "fixture assertion failed", responsibleSubsystem: "fixture", riskTier: "S1" }),
	]);
	run([
		"diagnosis",
		"record",
		"cli-diagnosis",
		"--type",
		"hypothesis",
		"--json",
		JSON.stringify({
			hypothesis: "the fixture never emitted a provider request",
			falsifier: "provider request event exists",
			expectedResult: "no provider request event is present",
		}),
	]);
	run([
		"diagnosis",
		"record",
		"cli-diagnosis",
		"--type",
		"evidence",
		"--json",
		JSON.stringify({ kind: "contradicting", claim: "provider request event exists", source: "fixture:event-1" }),
	]);
	const contradicted = run(["diagnosis", "show", "cli-diagnosis"]);
	assert.match(contradicted, /CONTRADICTED/);
	run(["diagnosis", "route", "cli-diagnosis", "--route", "verify-premise", "--reason", "provider request evidence invalidated the initial premise"]);
	run([
		"diagnosis",
		"record",
		"cli-diagnosis",
		"--type",
		"run",
		"--json",
		JSON.stringify({ runId: "cli-run-1", status: "passed" }),
	]);
	const show = run(["diagnosis", "show", "cli-diagnosis"]);
	assert.match(show, /cli-diagnosis/);
	assert.match(show, /cli-run-1/);
	const gate = run([
		"diagnosis",
		"gate",
		"cli-diagnosis",
		"--json",
		JSON.stringify({ actionId: "cheap-fixture", costClass: "normal", riskTier: "S1" }),
	]);
	assert.match(gate, /allowed|true/i);
	assert.ok(existsSync(join(parent, ".heli-harness", "tasks", "cli-diagnosis", "diagnosis.json")));
	const state = JSON.parse(readFileSync(join(parent, ".heli-harness", "tasks", "cli-diagnosis", "diagnosis.json"), "utf8"));
	assert.equal(state.lastVerification.outcome, "passed");
	run([
		"diagnosis",
		"record",
		"cli-diagnosis",
		"--type",
		"run",
		"--json",
		JSON.stringify({
			runId: "cli-run-2",
			status: "failed",
			closestProvenBoundary: "fake provider returned a timeout",
			failureSignature: {
				operationStage: "provider-run",
				subsystem: "provider",
				errorClass: "timeout",
				terminalStatus: "failed",
				environment: "fixture",
				provider: "fake-provider",
				normalizedMessage: "provider timeout",
				sourceSha: "sha-cli-a",
			},
		}),
	]);
	run([
		"diagnosis",
		"record",
		"cli-diagnosis",
		"--type",
		"checkpoint",
		"--json",
		JSON.stringify({
			whatWeKnow: "the fixture reached the provider boundary and the provider timed out",
			whatChanged: "the observed failure moved from fixture assertion to provider request",
			whyPreviousSubsystemNoLongerPrimary: "the fixture emitted the provider request successfully",
			newClosestProvenBoundary: "provider request timed out before a response",
			nextDiscriminatingAction: "run the bounded provider fixture after the adapter change",
			fromSubsystem: "fixture",
			newResponsibleSubsystem: "provider",
		}),
	]);
	const deniedRetry = run([
		"diagnosis",
		"gate",
		"cli-diagnosis",
		"--json",
		JSON.stringify({ actionId: "provider-backed-generation", costClass: "expensive", riskTier: "S1" }),
	], { expectFail: true });
	assert.match(deniedRetry, /RETRY_JUSTIFICATION_REQUIRED/);
	const justifiedRetry = run([
		"diagnosis",
		"gate",
		"cli-diagnosis",
		"--json",
		JSON.stringify({
			actionId: "provider-backed-generation",
			costClass: "expensive",
			riskTier: "S1",
			materialChange: {
				changed: true,
				summary: "replace the fixture provider timeout path",
				predictedEffect: "the provider request reaches the response boundary",
				files: ["fixtures/provider.mjs"],
				sourceShaBefore: "sha-cli-a",
				sourceShaAfter: "sha-cli-b",
			},
		}),
	]);
	assert.match(justifiedRetry, /MATERIAL_CHANGE/);
	run([
		"diagnosis",
		"record",
		"cli-diagnosis",
		"--type",
		"run",
		"--json",
		JSON.stringify({ runId: "cli-run-3", status: "passed" }),
	]);
	const completed = run(["task", "complete", "cli-diagnosis"]);
	assert.match(completed, /marked complete/i);
	console.log("smoke-cli-diagnosis: ok");
} finally {
	rmSync(parent, { recursive: true, force: true });
}
