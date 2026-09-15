#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { scoreBenchmarkExperiment } from "../lib/benchmark/scorer.mjs";

const args = process.argv.slice(2);
const json = args.includes("--json");
const outIndex = args.indexOf("--out");
const outPath = outIndex >= 0 && args[outIndex + 1] ? args[outIndex + 1] : null;
const positional = args.filter((arg, index) => {
	if (arg === "--json" || arg === "--out") return false;
	if (outIndex >= 0 && index === outIndex + 1) return false;
	return true;
});
const inputPath = positional[0];

if (!inputPath) {
	console.error("Usage: node scripts/benchmark-score.mjs <experiment.json> [--json] [--out report.json]");
	process.exit(1);
}

let experiment;
try {
	experiment = JSON.parse(readFileSync(resolve(inputPath), "utf8"));
} catch (error) {
	console.error(`Failed to read benchmark experiment: ${error.message}`);
	process.exit(2);
}

const report = scoreBenchmarkExperiment(experiment);
if (outPath) writeFileSync(resolve(outPath), `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (json) {
	process.stdout.write(`${JSON.stringify(report)}\n`);
} else {
	console.log(`Benchmark: ${report.experimentId || "unknown"}`);
	console.log(`Validity: ${report.valid ? "valid" : "invalid"}`);
	console.log(`Verdict: ${report.verdict}`);
	if (report.valid) {
		for (const run of report.runs) {
			console.log(`- ${run.runId} [${run.mode}] ${run.verdict}; overall=${run.overallAverage ?? "n/a"}; required_failures=${run.requiredFailures.length}`);
		}
		for (const comparison of report.comparisons) {
			console.log(`  compare ${comparison.candidateRunId} vs ${comparison.baselineRunId}: score_delta=${comparison.overallAverageDelta ?? "n/a"}`);
		}
	} else {
		for (const error of report.errors) console.log(`- ${error.code}: ${error.message}`);
	}
}

if (!report.valid) process.exitCode = 2;
