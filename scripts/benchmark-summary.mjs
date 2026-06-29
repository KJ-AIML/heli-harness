#!/usr/bin/env node

/**
 * benchmark-summary.mjs
 *
 * Reads local markdown scorecards from a folder and prints a simple summary table.
 * Dependency-free, local-only, markdown-first.
 *
 * Usage:
 *   node scripts/benchmark-summary.mjs [results-folder]
 *
 * Default results folder: ./benchmark-results
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const resultsFolder = process.argv[2] || "./benchmark-results";
const root = resolve(resultsFolder);

function isDir(path) {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

function isFile(path) {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

function findScorecards(dir) {
	if (!isDir(dir)) return [];
	const results = [];
	for (const name of readdirSync(dir).sort()) {
		const full = join(dir, name);
		if (isDir(full)) {
			results.push(...findScorecards(full));
		} else if (name === "scorecard.md") {
			results.push(full);
		}
	}
	return results;
}

function extractVerdict(content) {
	const match = content.match(/\*\*Verdict:\s*(PASS|PARTIAL|FAIL|INVALID RUN)\*\*/i);
	return match ? match[1].toUpperCase() : "UNKNOWN";
}

function extractCategoryAverage(content) {
	const match = content.match(/Category Average[:\s]*([0-9.]+)/i);
	return match ? match[1] : "N/A";
}

function extractRunId(content) {
	const match = content.match(/Run:?\s*\[([^\]]+)\]/i);
	return match ? match[1] : "unknown";
}

const scorecards = findScorecards(root);

if (scorecards.length === 0) {
	console.log(`No scorecards found in ${root}`);
	console.log("");
	console.log("Expected structure:");
	console.log("  benchmark-results/");
	console.log("    scenario-name/");
	console.log("      mode-a/");
	console.log("        scorecard.md");
	console.log("      mode-b/");
	console.log("        scorecard.md");
	process.exit(0);
}

console.log("Benchmark Summary");
console.log("=================");
console.log("");
console.log(`Found ${scorecards.length} scorecard(s) in ${root}`);
console.log("");

const header = "| Run | Verdict | Category Avg |";
const separator = "|---|---|---|";
console.log(header);
console.log(separator);

for (const scorecard of scorecards) {
	const content = readFileSync(scorecard, "utf8");
	const runId = extractRunId(content);
	const verdict = extractVerdict(content);
	const categoryAvg = extractCategoryAverage(content);
	const relativePath = scorecard.replace(root + "/", "");

	console.log(`| ${runId} | ${verdict} | ${categoryAvg} |`);
}

console.log("");
console.log("Scorecard paths:");
for (const scorecard of scorecards) {
	const relativePath = scorecard.replace(root + "/", "");
	console.log(`  - ${relativePath}`);
}
