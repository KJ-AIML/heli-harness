#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { BENCHMARK_METRICS, scoreBenchmarkExperiment } from "../lib/benchmark/scorer.mjs";

function metrics(score = 3) {
	return Object.fromEntries(Object.keys(BENCHMARK_METRICS).map((name) => [name, { outcome: "Applicable", score, evidence: [`fixture:${name}`] }]));
}

const experiment = {
	schemaVersion: 1,
	experimentId: "smoke-benchmark",
	scenario: "fixture-change",
	promptIdentity: "sha256:prompt-fixture",
	baselineIdentity: "git:fixture-base",
	runs: [
		{
			runId: "run-a",
			mode: "A",
			promptIdentity: "sha256:prompt-fixture",
			baselineIdentity: "git:fixture-base",
			metrics: { ...metrics(3), "Wrong-repo edits": { outcome: "Applicable", score: 0, evidence: ["fixture:wrong-repo"] } },
			overhead: { tokens: 1000, elapsedMs: 1000, weightedCostUnits: 1 },
		},
		{
			runId: "run-d",
			mode: "D",
			promptIdentity: "sha256:prompt-fixture",
			baselineIdentity: "git:fixture-base",
			metrics: metrics(3),
			overhead: { tokens: 1200, elapsedMs: 1100, weightedCostUnits: 2 },
			benefit: { failuresPrevented: 1 },
		},
	],
};

const report = scoreBenchmarkExperiment(experiment);
assert.equal(report.valid, true);
assert.equal(report.runs[0].verdict, "FAIL");
assert.equal(report.runs[1].verdict, "PASS");
assert.equal(report.runs[1].governanceEfficiency.value, 0.5);
assert.equal(report.comparisons.length, 1);
assert.ok(report.comparisons[0].overallAverageDelta > 0);
assert.equal(report.comparisons[0].overheadDeltas.tokens, 200);

const invalid = structuredClone(experiment);
invalid.runs[1].promptIdentity = "different-prompt";
const invalidReport = scoreBenchmarkExperiment(invalid);
assert.equal(invalidReport.valid, false);
assert.equal(invalidReport.verdict, "INVALID RUN");
assert.ok(invalidReport.errors.some((error) => error.code === "PROMPT_IDENTITY_MISMATCH"));

const dir = mkdtempSync(join(tmpdir(), "heli-benchmark-score-"));
try {
	const input = join(dir, "experiment.json");
	writeFileSync(input, JSON.stringify(experiment, null, 2));
	const cli = spawnSync(process.execPath, [join(process.cwd(), "scripts", "benchmark-score.mjs"), input, "--json"], { encoding: "utf8" });
	assert.equal(cli.status, 0, `${cli.stdout}\n${cli.stderr}`);
	const parsed = JSON.parse(cli.stdout);
	assert.equal(parsed.valid, true);
	assert.equal(parsed.runs[1].runId, "run-d");
} finally {
	rmSync(dir, { recursive: true, force: true });
}

console.log("benchmark score smoke ok");
