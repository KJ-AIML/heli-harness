/**
 * OpenCode local plugin for Heli-Harness (self-contained).
 * Copy to: .opencode/plugins/heli-harness.mjs
 *
 * tool.execute.before — throw Error to block
 * experimental.session.compacting — inject context when supported
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function field(text, label) {
	const match = new RegExp(`^${label}:[ \\t]*(.*)$`, "m").exec(text);
	return match ? match[1].trim() : "";
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

function readTaskGate(cwd) {
	if (!existsSync(join(cwd, ".heli-harness", "HARNESS.md"))) return null;
	const taskPath = join(cwd, ".heli-harness", "state", "current-task.md");
	if (!existsSync(taskPath)) return null;
	const taskText = readFileSync(taskPath, "utf8");
	const taskTarget = field(taskText, "Target repo");
	const status = field(taskText, "Current status");
	const failedAttempts = parseInt(field(taskText, "Failed attempts count") || "0", 10) || 0;
	if (failedAttempts >= 2 && status.toLowerCase() !== "complete") {
		return `Heli-Harness: current-task.md shows ${failedAttempts} failed attempts and status "${status || "(empty)"}" on an incomplete task.`;
	}
	const targetPath = join(cwd, ".heli-harness", "workspace", "target.json");
	if (taskTarget && existsSync(targetPath)) {
		let workspaceTarget = "";
		try {
			workspaceTarget = JSON.parse(readFileSync(targetPath, "utf8")).targetRepo || "";
		} catch { /* ignore */ }
		if (workspaceTarget && workspaceTarget.toLowerCase() !== taskTarget.toLowerCase()) {
			return `Heli-Harness: target mismatch task="${taskTarget}" workspace="${workspaceTarget}".`;
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
		return `Heli-Harness: plan.md current step has ${attempts} failed attempts.`;
	}
	return null;
}

function isTaskStateWrite(paths) {
	return paths.some((path) =>
		path.endsWith(".heli-harness/state/current-task.md") ||
		path.endsWith(".heli-harness/state/plan.md") ||
		path.endsWith(".heli-harness/workspace/target.json") ||
		path.endsWith(".heli-harness/state/yolo.json"));
}

function envTruthy(name) {
	return /^(1|true|yes|on)$/i.test(String(process.env[name] ?? "").trim());
}

function isYoloActive(cwd) {
	if (envTruthy("HELI_YOLO")) return true;
	if (/^(0|false|off|disabled|yolo|none)$/i.test(String(process.env.HELI_GUARDS ?? "").trim())) return true;
	const yoloPath = join(cwd, ".heli-harness", "state", "yolo.json");
	if (existsSync(yoloPath)) {
		try {
			const data = JSON.parse(readFileSync(yoloPath, "utf8"));
			if (data && data.enabled === true) {
				if (data.expiresAt) {
					const exp = Date.parse(data.expiresAt);
					if (!Number.isNaN(exp) && Date.now() > exp) return false;
				}
				return true;
			}
		} catch { /* ignore */ }
	}
	const taskPath = join(cwd, ".heli-harness", "state", "current-task.md");
	if (existsSync(taskPath)) {
		const m = /^Mode:[ \t]*(.*)$/m.exec(readFileSync(taskPath, "utf8"));
		const mode = m ? m[1].trim().toLowerCase() : "";
		if (mode === "yolo" || mode === "unguarded" || mode === "dangerous") return true;
	}
	return false;
}

function evaluate({ cwd, toolName, toolInput }) {
	if (isYoloActive(cwd)) return { deny: false, yolo: true };

	const rawCommand = String(toolInput?.command ?? toolInput?.cmd ?? toolInput?.description ?? "");
	const command = rawCommand.replace(/\s+/g, " ").trim().toLowerCase();
	const paths = [...pathsFrom(toolInput), ...patchPathsFrom(rawCommand)]
		.map((p) => String(p).replaceAll("\\", "/").toLowerCase());
	const name = String(toolName || "");

	if (/\bgit\s+push\b/.test(command) && !envTruthy("HELI_ALLOW_GIT_PUSH")) {
		return {
			deny: true,
			reason: "Heli-Harness blocks git push. Opt-in: HELI_YOLO=1 or heli yolo on.",
		};
	}
	if (paths.some((path) => /(^|\/)\.env(\.|$)/.test(path)) && !envTruthy("HELI_ALLOW_ENV_WRITE")) {
		return { deny: true, reason: "Heli-Harness blocks .env-style writes. Opt-in: HELI_YOLO=1 or heli yolo on." };
	}
	const isWrite = /write|edit|replace|strreplace|apply_patch|multi_replace/i.test(name);
	if (isWrite && !isTaskStateWrite(paths)) {
		const gate = readTaskGate(cwd) || readPlanGate(cwd);
		if (gate) return { deny: true, reason: gate };
	}
	return { deny: false };
}

function buildSessionContext(cwd) {
	const lines = [
		"Heli-Harness plugin context:",
		"Read .heli-harness/HARNESS.md before substantive work.",
		"Identify the active target repo from .heli-harness/workspace/target.json when present.",
	];
	const taskPath = join(cwd, ".heli-harness", "state", "current-task.md");
	if (existsSync(taskPath)) {
		const t = readFileSync(taskPath, "utf8").trim();
		if (t) lines.push("", "Carried-over task state:", t);
	}
	return lines.join("\n");
}

export const HeliHarness = async (ctx) => {
	const directory = ctx?.directory || process.cwd();
	return {
		"tool.execute.before": async (input, output) => {
			const tool = String(input?.tool ?? "");
			const args = output?.args ?? input?.args ?? {};
			const toolInput = {
				...args,
				command: args.command ?? args.cmd,
				file_path: args.filePath ?? args.file_path ?? args.path,
				path: args.path ?? args.filePath ?? args.file_path,
			};
			const result = evaluate({ cwd: directory, toolName: tool, toolInput });
			if (result.deny) throw new Error(result.reason);
		},
		"experimental.session.compacting": async (_input, output) => {
			if (output && Array.isArray(output.context)) {
				output.context.push(buildSessionContext(directory));
			}
		},
	};
};

export default HeliHarness;

// Named export some OpenCode loaders expect as the file basename
export const heliHarness = HeliHarness;
