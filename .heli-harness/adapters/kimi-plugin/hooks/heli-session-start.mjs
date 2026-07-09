#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function lastDecisionSections(text, max = 5) {
	if (!text) return "";
	const sections = text.split(/(?=^## )/m).filter((part) => part.startsWith("## "));
	return sections.slice(-max).join("").trim();
}

function field(text, label) {
	const match = new RegExp(`^${label}:[ \\t]*(.*)$`, "m").exec(text);
	return match ? match[1].trim() : "";
}

function stepCountPlanWarning(text) {
	const stepCount = parseInt(field(text, "Step count") || "0", 10) || 0;
	const planField = field(text, "Plan").toLowerCase();
	if (stepCount >= 3 && (planField === "" || planField === "n/a")) {
		return `Warning: current-task.md declares Step count: ${stepCount} but Plan: is n/a — per HARNESS.md, a task with 3+ steps should have a plan.md. Consider creating one from .heli-harness/templates/plan.md, especially before a cross-CLI handoff.`;
	}
	return "";
}

function planRollup(text) {
	if (!text) return "";
	const sections = text.split(/(?=^## )/m).filter((part) => part.startsWith("## "));
	if (!sections.length) return "";
	const titleMatch = /^# Plan: (.+)$/m.exec(text);
	const title = titleMatch ? titleMatch[1].trim() : "Untitled plan";
	const total = sections.length;
	const completeCount = sections.filter((section) => field(section, "Status").toLowerCase() === "complete").length;
	const current = sections.find((section) => field(section, "Status").toLowerCase() !== "complete");
	const lines = [`Active plan: ${title}`, `Progress: ${completeCount}/${total} steps complete`];
	if (current) {
		const stepTitleMatch = /^## (.+)$/m.exec(current);
		const stepTitle = stepTitleMatch ? stepTitleMatch[1].trim() : "current step";
		const status = field(current, "Status") || "(empty)";
		const attempts = field(current, "Attempts") || "0";
		lines.push(`Current step: ${stepTitle} — status: ${status} — attempts: ${attempts}`);
	} else {
		lines.push("All steps complete.");
	}
	return lines.join("\n");
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
			const stepWarning = stepCountPlanWarning(taskText);
			if (stepWarning) lines.push("", stepWarning);
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

	const planPath = join(cwd, ".heli-harness", "state", "plan.md");
	if (existsSync(planPath)) {
		const rollup = planRollup(readFileSync(planPath, "utf8"));
		if (rollup) {
			lines.push(
				"",
				"Read the full plan file before resuming: .heli-harness/state/plan.md",
				rollup,
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
