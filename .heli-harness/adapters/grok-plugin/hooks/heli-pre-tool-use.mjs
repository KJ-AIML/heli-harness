#!/usr/bin/env node
/**
 * Grok Build PreToolUse hook (Claude-compatible plugin layout).
 * Emits Claude hookSpecificOutput and Grok { decision, reason } + exit 2 on deny.
 */

import { stdin } from "node:process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const input = await new Promise((resolve) => {
	let data = "";
	stdin.setEncoding("utf8");
	stdin.on("data", (chunk) => { data += chunk; });
	stdin.on("end", () => resolve(data));
});

function deny(reason) {
	// Grok: explicit JSON decision:"deny" blocks (exit 2 also denies; exit 0 + deny JSON is accepted).
	// Claude-compat hosts read hookSpecificOutput.
	process.stdout.write(JSON.stringify({
		decision: "deny",
		reason,
		hookSpecificOutput: {
			hookEventName: "PreToolUse",
			permissionDecision: "deny",
			permissionDecisionReason: reason,
		},
	}));
	// Prefer exit 2 for Grok; JSON decision remains authoritative if the host remaps exit codes.
	process.exit(2);
}

function commandFrom(event) {
	return String(event?.tool_input?.command ?? event?.tool_input?.description ?? event?.toolInput?.command ?? "");
}

function pathsFrom(value, out = []) {
	if (!value || typeof value !== "object") return out;
	for (const [key, item] of Object.entries(value)) {
		if (/path|file/i.test(key) && typeof item === "string") out.push(item);
		else if (item && typeof item === "object") pathsFrom(item, out);
	}
	return out;
}

function patchPathsFrom(commandText, out = []) {
	const re = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;
	let match;
	while ((match = re.exec(commandText))) out.push(match[1].trim());
	const moveRe = /^\*\*\* Move to: (.+)$/gm;
	while ((match = moveRe.exec(commandText))) out.push(match[1].trim());
	return out;
}

function field(text, label) {
	const match = new RegExp(`^${label}:[ \\t]*(.*)$`, "m").exec(text);
	return match ? match[1].trim() : "";
}

function readTaskGate(cwd) {
	if (!existsSync(join(cwd, ".heli-harness", "HARNESS.md"))) return null;
	const taskPath = join(cwd, ".heli-harness", "state", "current-task.md");
	if (!existsSync(taskPath)) return null;

	const taskText = readFileSync(taskPath, "utf8");
	const taskTarget = field(taskText, "Target repo");
	const status = field(taskText, "Current status");
	const failedAttempts = parseInt(field(taskText, "Failed attempts count") || "0", 10) || 0;

	if (failedAttempts >= 2 && status.toLowerCase() !== "complete") {
		return `Heli-Harness: current-task.md shows ${failedAttempts} failed attempts and status "${status || "(empty)"}" on an incomplete task — this looks carried over from a previous session. Read .heli-harness/state/current-task.md, diagnose or reset it, and update the file before continuing.`;
	}

	const targetPath = join(cwd, ".heli-harness", "workspace", "target.json");
	if (taskTarget && existsSync(targetPath)) {
		let workspaceTarget = "";
		try {
			workspaceTarget = JSON.parse(readFileSync(targetPath, "utf8")).targetRepo || "";
		} catch { /* ignore */ }
		if (workspaceTarget && workspaceTarget.toLowerCase() !== taskTarget.toLowerCase()) {
			return `Heli-Harness: current-task.md says target repo "${taskTarget}" but .heli-harness/workspace/target.json is set to "${workspaceTarget}" — confirm which repo you're working in and update current-task.md before continuing.`;
		}
	}

	return null;
}

function readPlanGate(cwd) {
	if (!existsSync(join(cwd, ".heli-harness", "HARNESS.md"))) return null;
	const planPath = join(cwd, ".heli-harness", "state", "plan.md");
	if (!existsSync(planPath)) return null;

	const planText = readFileSync(planPath, "utf8");
	const sections = planText.split(/(?=^## )/m).filter((part) => part.startsWith("## "));
	const current = sections.find((section) => field(section, "Status").toLowerCase() !== "complete");
	if (!current) return null;

	const status = field(current, "Status");
	const attempts = parseInt(field(current, "Attempts") || "0", 10) || 0;
	if (attempts >= 2 && status.toLowerCase() !== "complete") {
		const stepTitleMatch = /^## (.+)$/m.exec(current);
		const stepTitle = stepTitleMatch ? stepTitleMatch[1].trim() : "current step";
		return `Heli-Harness: plan.md step "${stepTitle}" shows ${attempts} failed attempts and status "${status || "(empty)"}" — update .heli-harness/state/plan.md to resolve it before continuing.`;
	}
	return null;
}

function isTaskStateWrite(paths) {
	return paths.some((path) =>
		path.endsWith(".heli-harness/state/current-task.md") ||
		path.endsWith(".heli-harness/state/plan.md") ||
		path.endsWith(".heli-harness/workspace/target.json"));
}

const event = input.trim() ? JSON.parse(input) : {};
const toolInput = event?.tool_input ?? event?.toolInput ?? {};
const rawCommand = commandFrom(event);
const command = rawCommand.replace(/\s+/g, " ").trim().toLowerCase();
const paths = [...pathsFrom(toolInput), ...patchPathsFrom(rawCommand)]
	.map((path) => path.replaceAll("\\", "/").toLowerCase());
const toolName = String(event?.tool_name ?? event?.toolName ?? "");

if (/\bgit\s+push\b/.test(command)) {
	deny("Heli-Harness blocks git push in agent sessions — this is a blanket rule, not gated on release approval. Push manually outside the session if needed.");
} else if (paths.some((path) => /(^|\/)\.env(\.|$)/.test(path))) {
	deny("Heli-Harness blocks writes to .env-style secret files.");
} else if (["Edit", "Write", "apply_patch", "edit", "write"].includes(toolName) && !isTaskStateWrite(paths)) {
	const gateReason = readTaskGate(process.cwd()) || readPlanGate(process.cwd());
	if (gateReason) deny(gateReason);
}
