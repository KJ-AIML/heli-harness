/**
 * Shared Heli-Harness guard logic for adapter hooks/plugins.
 * Host wrappers handle stdin/stdout protocol differences; this module stays pure.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function field(text, label) {
	// [ \t]*, not \s*: \s matches newlines, so a blank field value would
	// greedily capture the next labeled line's label as the value.
	const match = new RegExp(`^${label}:[ \\t]*(.*)$`, "m").exec(text);
	return match ? match[1].trim() : "";
}

export function lastDecisionSections(text, max = 5) {
	if (!text) return "";
	const sections = text.split(/(?=^## )/m).filter((part) => part.startsWith("## "));
	return sections.slice(-max).join("").trim();
}

export function stepCountPlanWarning(text) {
	const stepCount = parseInt(field(text, "Step count") || "0", 10) || 0;
	const planField = field(text, "Plan").toLowerCase();
	if (stepCount >= 3 && (planField === "" || planField === "n/a")) {
		return `Warning: current-task.md declares Step count: ${stepCount} but Plan: is n/a — per HARNESS.md, a task with 3+ steps should have a plan.md. Consider creating one from .heli-harness/templates/plan.md, especially before a cross-CLI handoff.`;
	}
	return "";
}

export function planRollup(text) {
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

export function buildSessionContext(cwd) {
	const lines = [
		"Heli-Harness plugin context:",
		"Read .heli-harness/HARNESS.md before substantive work.",
		"Identify the active target repo from .heli-harness/workspace/target.json when present.",
		"Instruction files are not a sandbox; plugin hooks are guardrails only.",
	];

	if (!existsSync(join(cwd, ".heli-harness", "HARNESS.md"))) {
		return lines.join("\n");
	}

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

	return lines.join("\n");
}

export function pathsFrom(value, out = []) {
	if (!value || typeof value !== "object") return out;
	for (const [key, item] of Object.entries(value)) {
		if (/path|file/i.test(key) && typeof item === "string") out.push(item);
		else if (item && typeof item === "object") pathsFrom(item, out);
	}
	return out;
}

export function patchPathsFrom(commandText, out = []) {
	const re = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;
	let match;
	while ((match = re.exec(commandText))) out.push(match[1].trim());
	const moveRe = /^\*\*\* Move to: (.+)$/gm;
	while ((match = moveRe.exec(commandText))) out.push(match[1].trim());
	return out;
}

export function readTaskGate(cwd) {
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
		} catch { /* malformed target.json */ }
		if (workspaceTarget && workspaceTarget.toLowerCase() !== taskTarget.toLowerCase()) {
			return `Heli-Harness: current-task.md says target repo "${taskTarget}" but .heli-harness/workspace/target.json is set to "${workspaceTarget}" — confirm which repo you're working in and update current-task.md before continuing.`;
		}
	}

	return null;
}

export function readPlanGate(cwd) {
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

export function isTaskStateWrite(paths) {
	return paths.some((path) =>
		path.endsWith(".heli-harness/state/current-task.md") ||
		path.endsWith(".heli-harness/state/plan.md") ||
		path.endsWith(".heli-harness/workspace/target.json") ||
		path.endsWith(".heli-harness/state/yolo.json"));
}

function envTruthy(name) {
	return /^(1|true|yes|on)$/i.test(String(process.env[name] ?? "").trim());
}

function envGuardsOff() {
	return /^(0|false|off|disabled|yolo|none)$/i.test(String(process.env.HELI_GUARDS ?? "").trim());
}

/**
 * Opt-in unguarded ("yolo") mode. Default is always strict.
 *
 * Enable with any of:
 * - HELI_YOLO=1|true|yes|on
 * - HELI_GUARDS=off|0|false|disabled|yolo
 * - .heli-harness/state/yolo.json  { "enabled": true, "expiresAt"?: ISO }
 * - current-task.md  Mode: yolo | unguarded | dangerous
 *
 * Granular (when full yolo is off):
 * - HELI_ALLOW_GIT_PUSH=1
 * - HELI_ALLOW_ENV_WRITE=1
 *
 * @returns {{ active: boolean, source?: string }}
 */
export function isYoloActive(cwd = process.cwd()) {
	if (envTruthy("HELI_YOLO")) return { active: true, source: "env:HELI_YOLO" };
	if (envGuardsOff()) return { active: true, source: "env:HELI_GUARDS" };

	const yoloPath = join(cwd, ".heli-harness", "state", "yolo.json");
	if (existsSync(yoloPath)) {
		try {
			const data = JSON.parse(readFileSync(yoloPath, "utf8"));
			if (data && data.enabled === true) {
				if (data.expiresAt) {
					const exp = Date.parse(data.expiresAt);
					if (!Number.isNaN(exp) && Date.now() > exp) {
						return { active: false };
					}
				}
				return { active: true, source: "state/yolo.json" };
			}
		} catch {
			/* ignore malformed yolo.json */
		}
	}

	const taskPath = join(cwd, ".heli-harness", "state", "current-task.md");
	if (existsSync(taskPath)) {
		const mode = field(readFileSync(taskPath, "utf8"), "Mode").toLowerCase();
		if (mode === "yolo" || mode === "unguarded" || mode === "dangerous") {
			return { active: true, source: `current-task.md Mode: ${mode}` };
		}
	}

	return { active: false };
}

export function allowGitPush(cwd = process.cwd()) {
	return isYoloActive(cwd).active || envTruthy("HELI_ALLOW_GIT_PUSH");
}

export function allowEnvWrite(cwd = process.cwd()) {
	return isYoloActive(cwd).active || envTruthy("HELI_ALLOW_ENV_WRITE");
}

/**
 * @param {object} opts
 * @param {string} opts.cwd
 * @param {string} [opts.toolName]
 * @param {object} [opts.toolInput]
 * @param {string[]} [opts.writeToolNames] tools that should trigger task/plan gates
 * @returns {{ deny: boolean, reason?: string, yolo?: boolean, yoloSource?: string }}
 */
export function evaluatePreToolUse({
	cwd,
	toolName = "",
	toolInput = {},
	writeToolNames = ["Edit", "Write", "apply_patch", "write", "edit", "WriteFile", "StrReplaceFile", "write_to_file", "replace_file_content", "multi_replace_file_content"],
}) {
	const yolo = isYoloActive(cwd);
	if (yolo.active) {
		return { deny: false, yolo: true, yoloSource: yolo.source };
	}

	const rawCommand = String(toolInput?.command ?? toolInput?.description ?? "");
	const command = rawCommand.replace(/\s+/g, " ").trim().toLowerCase();
	const paths = [...pathsFrom(toolInput), ...patchPathsFrom(rawCommand)]
		.map((path) => path.replaceAll("\\", "/").toLowerCase());
	const name = String(toolName);

	if (/\bgit\s+push\b/.test(command) && !allowGitPush(cwd)) {
		return {
			deny: true,
			reason: "Heli-Harness blocks git push in agent sessions — this is a blanket rule, not gated on release approval. Push manually outside the session if needed. Opt-in: HELI_YOLO=1, HELI_ALLOW_GIT_PUSH=1, or `heli yolo on`.",
		};
	}
	if (paths.some((path) => /(^|\/)\.env(\.|$)/.test(path)) && !allowEnvWrite(cwd)) {
		return {
			deny: true,
			reason: "Heli-Harness blocks writes to .env-style secret files. Opt-in: HELI_YOLO=1, HELI_ALLOW_ENV_WRITE=1, or `heli yolo on`.",
		};
	}

	const isWrite = writeToolNames.some((t) => t.toLowerCase() === name.toLowerCase())
		|| /write|edit|replace|strreplace|apply_patch|multi_replace/i.test(name);
	if (isWrite && !isTaskStateWrite(paths)) {
		const gateReason = readTaskGate(cwd) || readPlanGate(cwd);
		if (gateReason) return { deny: true, reason: gateReason };
	}

	return { deny: false };
}
