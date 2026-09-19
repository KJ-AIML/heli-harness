#!/usr/bin/env node
import { findWorkspaceRoot } from "../lib/concurrency/paths.mjs";
import { suggestLearnings } from "../lib/learning/suggest.mjs";

const args = process.argv.slice(2);
const json = args.includes("--json");
const thresholdIndex = args.indexOf("--threshold");
const threshold = thresholdIndex >= 0 ? Number(args[thresholdIndex + 1]) : 2;
const positional = args.filter((arg, index) => {
	if (arg === "--json" || arg === "--threshold") return false;
	if (thresholdIndex >= 0 && index === thresholdIndex + 1) return false;
	return true;
});
const cwd = positional[0] || process.cwd();
const workspaceRoot = findWorkspaceRoot(cwd);
if (!workspaceRoot) {
	console.error(`No Heli workspace found from ${cwd}`);
	process.exit(1);
}
const report = suggestLearnings(workspaceRoot, { threshold });
if (json) {
	process.stdout.write(`${JSON.stringify(report)}\n`);
} else {
	console.log(`Learning candidates: ${report.candidates.length} (tasks scanned: ${report.tasksScanned})`);
	for (const candidate of report.candidates) {
		console.log(`- ${candidate.candidateId} [${candidate.kind}/${candidate.confidence}] ${candidate.observation}`);
		console.log(`  ${candidate.suggestion}`);
	}
	console.log("Read-only: yes. Nothing was written to policy, profile, skill, or memory state.");
}
