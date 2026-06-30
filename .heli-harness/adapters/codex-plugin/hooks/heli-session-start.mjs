#!/usr/bin/env node

const context = [
	"Heli-Harness plugin context:",
	"Read .heli-harness/HARNESS.md before substantive work.",
	"Identify the active target repo from .heli-harness/workspace/target.json when present.",
	"Instruction files are not a sandbox; plugin hooks are guardrails only.",
].join("\n");

process.stdout.write(JSON.stringify({
	hookSpecificOutput: {
		hookEventName: "SessionStart",
		additionalContext: context,
	},
}));
