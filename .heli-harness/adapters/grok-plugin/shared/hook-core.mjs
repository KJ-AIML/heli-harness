/**
 * Shared Heli-Harness guard logic for adapter hooks/plugins.
 * Host wrappers handle stdin/stdout protocol differences; this module stays pure.
 *
 * v0.5.24: concurrent session foundation via ./concurrency/*
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
	resolveExecutionContext,
	evaluateOwnershipGate,
	buildConcurrentSessionContext,
	readTaskGateForContext,
	readPlanGateForContext,
	isTaskStateWriteForContext,
} from "./concurrency/resolve.mjs";
import { resolveYolo, allowGitPushScoped, allowEnvWriteScoped } from "./concurrency/yolo-scope.mjs";
import { sessionHoldsWriteLease, refreshLease } from "./concurrency/lease.mjs";
import { findWorkspaceRoot } from "./concurrency/paths.mjs";

export function field(text, label) {
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

/**
 * Compact skill-usage bootstrap for SessionStart.
 * Distinct from task/session/lease governance context. Injected once per context build.
 * Does not dump the skill library; points at host inventory + using-heli-skills.
 */
export function buildSkillUsageBootstrap() {
	return [
		"Heli skill usage:",
		"Heli skills are mandatory workflow resources when they match the task — not optional docs.",
		"Before substantive action, check for a relevant Heli skill (host skill inventory when the plugin is loaded, or .heli-harness/skills/<name>/SKILL.md).",
		"Load only matching skills; read the current skill body; do not invent skills; do not load every skill.",
		"Process/workflow skills outrank implementation detail. Explicitly requested skills must be loaded.",
		"User instructions and Heli safety/ownership rules remain authoritative. Skill use does not change task, session, worktree, or lease identity.",
		"Subagents on a tightly scoped task should not restart the full controller skill stack.",
		"Protocol skill: using-heli-skills.",
	].join("\n");
}

export function appendSkillUsageBootstrap(contextText) {
	const text = contextText || "";
	if (text.includes("Heli skill usage:")) return text;
	const bootstrap = buildSkillUsageBootstrap();
	if (!text.trim()) return bootstrap;
	return `${text}\n\n${bootstrap}`;
}

export function buildSessionContext(cwd, { host = "unknown", hookPayload = null, env = process.env } = {}) {
	const ctx = resolveExecutionContext({
		cwd,
		environment: env,
		hookPayload,
		host,
		createIfMissing: true,
		refreshLeaseOnResolve: true,
	});

	if (ctx.concurrentMode) {
		return appendSkillUsageBootstrap(buildConcurrentSessionContext(ctx));
	}

	const lines = [
		"Heli-Harness plugin context:",
		"Read .heli-harness/HARNESS.md before substantive work.",
		"Identify the active target repo from .heli-harness/workspace/target.json when present.",
		"Instruction files are not a sandbox; plugin hooks are guardrails only.",
		"",
		"Workspace mode: legacy",
	];

	const root = ctx.workspaceRoot || cwd;
	if (!existsSync(join(root, ".heli-harness", "HARNESS.md"))) {
		return appendSkillUsageBootstrap(lines.join("\n"));
	}

	const taskPath = join(root, ".heli-harness", "state", "current-task.md");
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

	const decisionsPath = join(root, ".heli-harness", "state", "decisions.md");
	if (existsSync(decisionsPath)) {
		const recentDecisions = lastDecisionSections(readFileSync(decisionsPath, "utf8"));
		if (recentDecisions) {
			lines.push("", "Recent durable decisions from .heli-harness/state/decisions.md:", recentDecisions);
		}
	}

	const planPath = join(root, ".heli-harness", "state", "plan.md");
	if (existsSync(planPath)) {
		const rollup = planRollup(readFileSync(planPath, "utf8"));
		if (rollup) {
			lines.push("", "Read the full plan file before resuming: .heli-harness/state/plan.md", rollup);
		}
	}

	return appendSkillUsageBootstrap(lines.join("\n"));
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
	const ctx = resolveExecutionContext({ cwd, createIfMissing: false, host: "legacy-gate" });
	if (!ctx.workspaceRoot && !existsSync(join(cwd, ".heli-harness", "HARNESS.md"))) return null;
	if (!ctx.workspaceRoot) {
		return null;
	}
	return readTaskGateForContext(ctx);
}

export function readPlanGate(cwd) {
	const ctx = resolveExecutionContext({ cwd, createIfMissing: false, host: "legacy-gate" });
	if (!ctx.workspaceRoot) return null;
	return readPlanGateForContext(ctx);
}

export function isTaskStateWrite(paths) {
	return paths.some(
		(path) =>
			path.endsWith(".heli-harness/state/current-task.md") ||
			path.endsWith(".heli-harness/state/plan.md") ||
			path.endsWith(".heli-harness/workspace/target.json") ||
			path.endsWith(".heli-harness/state/yolo.json") ||
			path.includes(".heli-harness/tasks/") ||
			path.includes(".heli-harness/sessions/") ||
			path.includes(".heli-harness/locks/") ||
			path.includes(".heli-harness/bindings/"),
	);
}

export function isYoloActive(cwd = process.cwd(), env = process.env) {
	const ctx = resolveExecutionContext({
		cwd,
		environment: env,
		createIfMissing: false,
		host: "yolo-check",
	});
	return resolveYolo({
		workspaceRoot: ctx.workspaceRoot || findWorkspaceRoot(cwd) || cwd,
		cwd,
		taskId: ctx.taskId,
		sessionId: ctx.sessionId,
		env,
		legacyMode: ctx.legacyMode,
	});
}

export function allowGitPush(cwd = process.cwd(), env = process.env) {
	const ctx = resolveExecutionContext({ cwd, environment: env, createIfMissing: false, host: "yolo-check" });
	return allowGitPushScoped({
		workspaceRoot: ctx.workspaceRoot || cwd,
		cwd,
		taskId: ctx.taskId,
		sessionId: ctx.sessionId,
		env,
		legacyMode: ctx.legacyMode,
	});
}

export function allowEnvWrite(cwd = process.cwd(), env = process.env) {
	const ctx = resolveExecutionContext({ cwd, environment: env, createIfMissing: false, host: "yolo-check" });
	return allowEnvWriteScoped({
		workspaceRoot: ctx.workspaceRoot || cwd,
		cwd,
		taskId: ctx.taskId,
		sessionId: ctx.sessionId,
		env,
		legacyMode: ctx.legacyMode,
	});
}

export function evaluatePreToolUse({
	cwd,
	toolName = "",
	toolInput = {},
	writeToolNames = [
		"Edit",
		"Write",
		"apply_patch",
		"write",
		"edit",
		"WriteFile",
		"StrReplaceFile",
		"write_to_file",
		"replace_file_content",
		"multi_replace_file_content",
	],
	host = "unknown",
	hookPayload = null,
	env = process.env,
} = {}) {
	// PreToolUse must NOT mint a new session on every call — that recreates
	// global last-writer pollution via session spam. Resume via HELI_SESSION_ID,
	// external host id mapping, or worktree binding only.
	const ctx = resolveExecutionContext({
		cwd,
		environment: env,
		hookPayload: hookPayload || { tool_name: toolName, tool_input: toolInput },
		host,
		createIfMissing: false,
		refreshLeaseOnResolve: false,
	});

	const rawCommand = String(toolInput?.command ?? toolInput?.description ?? "");
	const command = rawCommand.replace(/\s+/g, " ").trim().toLowerCase();
	const paths = [...pathsFrom(toolInput), ...patchPathsFrom(rawCommand)].map((path) =>
		path.replaceAll("\\", "/").toLowerCase(),
	);
	const name = String(toolName);

	const isWrite =
		writeToolNames.some((t) => t.toLowerCase() === name.toLowerCase()) ||
		/write|edit|replace|strreplace|apply_patch|multi_replace/i.test(name);

	// Ownership gates — NEVER bypassed by YOLO
	if (isWrite && !isTaskStateWriteForContext(ctx, paths) && !isTaskStateWrite(paths)) {
		const ownership = evaluateOwnershipGate(ctx, { isWrite: true });
		if (ownership.deny) {
			return { deny: true, reason: ownership.reason, code: ownership.code, ctx };
		}
	}

	if (
		isWrite &&
		ctx.concurrentMode &&
		ctx.taskId &&
		ctx.sessionId &&
		sessionHoldsWriteLease(ctx.workspaceRoot, ctx.taskId, ctx.sessionId)
	) {
		try {
			refreshLease(ctx.workspaceRoot, ctx.taskId, { sessionId: ctx.sessionId });
		} catch {
			/* ignore */
		}
	}

	const yolo = resolveYolo({
		workspaceRoot: ctx.workspaceRoot || cwd,
		cwd,
		taskId: ctx.taskId,
		sessionId: ctx.sessionId,
		env,
		legacyMode: ctx.legacyMode,
	});
	if (yolo.active) {
		return { deny: false, yolo: true, yoloSource: yolo.source, ctx };
	}

	if (
		/\bgit\s+push\b/.test(command) &&
		!allowGitPushScoped({
			workspaceRoot: ctx.workspaceRoot || cwd,
			cwd,
			taskId: ctx.taskId,
			sessionId: ctx.sessionId,
			env,
			legacyMode: ctx.legacyMode,
		})
	) {
		return {
			deny: true,
			reason:
				"Heli-Harness blocks git push in agent sessions — this is a blanket rule, not gated on release approval. Push manually outside the session if needed. Opt-in: HELI_YOLO=1, HELI_ALLOW_GIT_PUSH=1, or `heli yolo on`.",
			ctx,
		};
	}
	if (
		paths.some((path) => /(^|\/)\.env(\.|$)/.test(path)) &&
		!allowEnvWriteScoped({
			workspaceRoot: ctx.workspaceRoot || cwd,
			cwd,
			taskId: ctx.taskId,
			sessionId: ctx.sessionId,
			env,
			legacyMode: ctx.legacyMode,
		})
	) {
		return {
			deny: true,
			reason:
				"Heli-Harness blocks writes to .env-style secret files. Opt-in: HELI_YOLO=1, HELI_ALLOW_ENV_WRITE=1, or `heli yolo on`.",
			ctx,
		};
	}

	if (isWrite && !isTaskStateWriteForContext(ctx, paths) && !isTaskStateWrite(paths)) {
		const gateReason = readTaskGateForContext(ctx) || readPlanGateForContext(ctx);
		if (gateReason) return { deny: true, reason: gateReason, ctx };
	}

	return { deny: false, ctx };
}

export { resolveExecutionContext };
