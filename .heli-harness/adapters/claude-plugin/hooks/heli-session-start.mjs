#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function lastDecisionSections(text, max = 5) {
	if (!text) return "";
	const sections = text.split(/(?=^## )/m).filter((part) => part.startsWith("## "));
	return sections.slice(-max).join("").trim();
}

const cwd = process.cwd();
const lines = [
	"Heli-Harness plugin context:",
	"Read .heli-harness/HARNESS.md before substantive work.",
	"Identify the active target repo from .heli-harness/workspace/target.json when present.",
	"Instruction files are not a sandbox; plugin hooks are guardrails only.",
];

if (existsSync(join(cwd, ".heli-harness", "HARNESS.md"))) {
	const taskPath = join(cwd, ".heli-harness", "state", "current-task.md");
	if (existsSync(taskPath)) {
		const taskText = readFileSync(taskPath, "utf8").trim();
		if (taskText) {
			lines.push(
				"",
				"Carried-over task state from .heli-harness/state/current-task.md:",
				taskText,
				"",
				"Acknowledge this before your first edit this session: confirm with the user whether to resume, abandon, or reset it. If it shows a target-repo mismatch against workspace/target.json, or 2+ failed attempts on an incomplete task, the PreToolUse hook will block Edit/Write/apply_patch calls until you update current-task.md (or target.json) to resolve it.",
			);
		}
	}

	const decisionsPath = join(cwd, ".heli-harness", "state", "decisions.md");
	if (existsSync(decisionsPath)) {
		const recentDecisions = lastDecisionSections(readFileSync(decisionsPath, "utf8"));
		if (recentDecisions) {
			lines.push(
				"",
				"Recent durable decisions from .heli-harness/state/decisions.md:",
				recentDecisions,
			);
		}
	}
}

process.stdout.write(JSON.stringify({
	hookSpecificOutput: {
		hookEventName: "SessionStart",
		additionalContext: lines.join("\n"),
	},
}));
