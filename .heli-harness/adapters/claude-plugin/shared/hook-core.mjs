/**
 * Shared Heli-Harness guard logic for adapter hooks/plugins.
 * Host wrappers handle stdin/stdout protocol differences; this module stays pure.
 *
 * v0.5.24: concurrent session foundation via ./concurrency/*
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

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
import { consumeApplicableGrant, findUsableGrants } from "./concurrency/grant.mjs";
import { resourceIdForWorktree } from "./concurrency/resource-authority.mjs";
import { evaluateDiagnosisWriteGate, readActionPolicy, readDiagnosis } from "./concurrency/diagnosis.mjs";
import {
	analyzeCommand,
	approvalReason,
	evaluateCommandRules,
	hardDenyReason,
	programName,
	shellWriteTargets,
} from "./command-policy.mjs";
import { COMMAND_ANALYSIS_LIMITS, argvCommandText } from "./command-policy.mjs";
import { MCP_INPUT_LIMITS, mcpToolWrites, readMcpInput } from "./mcp-input.mjs";
import {
	classifyShellWriteTargets,
	classifyToolPaths,
	disablesClaudeHooks,
	heliEnvironmentKeys,
	normalizePolicyPath,
	protectedEnvironmentReason,
	protectedWriteReason,
	settingsContentOf,
} from "./concurrency/protected-paths.mjs";

export { commandRuleTokens, commandMatchesRuleTokens } from "./command-policy.mjs";

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
		"Governance enforcement: plugin hooks active for this session (not a sandbox). Without this SessionStart marker in another host, treat governance as advisory/file-only.",
		"",
		"Workspace mode: legacy",
		"Legacy uses shared .heli-harness/state/current-task.md — multi-agent edits race (last writer wins).",
		"For parallel agents: heli task migrate-legacy --id <id> (or heli task create), then claim write + HELI_SESSION_ID. See skill concurrent-upgrade.",
	];

	const root = ctx.workspaceRoot || cwd;
	if (!existsSync(join(root, ".heli-harness", "HARNESS.md"))) {
		return appendSkillUsageBootstrap(lines.join("\n"));
	}

	const taskPath = join(root, ".heli-harness", "state", "current-task.md");
	if (existsSync(taskPath)) {
		const taskText = readFileSync(taskPath, "utf8").trim();
		if (taskText) {
			const status = field(taskText, "Current status").toLowerCase();
			const incomplete =
				status && status !== "complete" && status !== "idle" && !status.includes("none");
			lines.push(
				"",
				"Carried-over task state from .heli-harness/state/current-task.md:",
				taskText,
				"",
				"Acknowledge this before your first edit this session: confirm with the user whether to resume, abandon, or reset it. If it shows a target-repo mismatch against workspace/target.json, or 2+ failed attempts on an incomplete task, the PreToolUse hook will block Edit/Write/apply_patch calls until you update current-task.md (or run `heli target set <repo>`) to resolve it.",
			);
			if (incomplete) {
				lines.push(
					"",
					"MULTI-AGENT WARNING (legacy): this incomplete shared current-task.md is a single global ledger. A second agent editing it will swap/race. Prefer concurrent mode for parallel work.",
				);
			}
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

/**
 * Host adapters may use different names for file tools, but planning tools
 * such as `todo_write` are not repository mutations. Keep the known writer
 * list explicit, then use a path-aware fallback for equivalent names.
 */
export const DEFAULT_FILE_WRITE_TOOL_NAMES = Object.freeze([
	"Edit",
	"Write",
	// Claude Code's other file writers: one name each, so the verb-based fallback below never sees them as `edit`.
	"MultiEdit",
	"NotebookEdit",
	"apply_patch",
	"write",
	"edit",
	"WriteFile",
	"StrReplaceFile",
	"write_to_file",
	"replace_file_content",
	"multi_replace_file_content",
	"multi_edit",
	"file_write",
	"file_edit",
	"fs.write",
	"filesystem.write",
	"search_replace",
]);

const FILE_MUTATION_VERB_SEQUENCES = Object.freeze([
	Object.freeze(["write"]),
	Object.freeze(["edit"]),
	Object.freeze(["replace"]),
	Object.freeze(["strreplace"]),
	Object.freeze(["str", "replace"]),
	Object.freeze(["apply", "patch"]),
	Object.freeze(["multi", "replace"]),
]);

function normalizedToolNameTokens(toolName) {
	return String(toolName ?? "")
		.toLowerCase()
		.split(/[_\-.]+/)
		.filter(Boolean);
}

function hasMutationVerb(tokens) {
	return FILE_MUTATION_VERB_SEQUENCES.some((sequence) =>
		tokens.some((_, start) => sequence.every((token, offset) => tokens[start + offset] === token)),
	);
}

/**
 * True when `toolName` is on the write-tool list (DEFAULT_FILE_WRITE_TOOL_NAMES unless
 * the caller passes its own), compared by name only and ignoring case. Unlike
 * isFileMutationTool it has no path-aware fallback, so a tool that merely looks like a
 * file writer is not one.
 */
export function isFileWriteToolName(toolName, writeToolNames = DEFAULT_FILE_WRITE_TOOL_NAMES) {
	const name = String(toolName ?? "").toLowerCase();
	for (const knownName of writeToolNames ?? DEFAULT_FILE_WRITE_TOOL_NAMES) {
		if (String(knownName).toLowerCase() === name) return true;
	}
	return false;
}

export function isFileMutationTool(
	toolName,
	{ paths = [], writeToolNames = DEFAULT_FILE_WRITE_TOOL_NAMES } = {},
) {
	const name = String(toolName ?? "");
	if (isFileWriteToolName(name, writeToolNames)) return true;
	if (!Array.isArray(paths) || paths.length === 0) return false;
	return hasMutationVerb(normalizedToolNameTokens(name));
}

// Claude Code on Windows runs commands through `PowerShell` (no Bash tool without
// Git Bash) and `Monitor` runs a background command; both carry `command` (a Monitor
// watching a WebSocket has a `ws` source instead).
const SHELL_TOOL_NAME_RE = /(^|[_\-.])(bash|shell|terminal|exec|run_command|run-command|powershell|pwsh|monitor)($|[_\-.])/;
const POWERSHELL_WRITE_CMDLETS = /\b(set-content|add-content|out-file|new-item|remove-item|move-item|copy-item|rename-item|clear-content|tee-object)\b/;
// PowerShell/cmd aliases that are also common words only count at command position.
const WRITE_ALIASES = new Set(["sc", "ac", "ni", "ri", "mi", "cpi", "rni", "clc", "md", "del", "erase", "rd", "rmdir", "move", "copy", "ren"]);

/** MCP tools are named mcp__<server>__<tool>. */
export function isMcpTool(toolName) {
	return String(toolName ?? "").toLowerCase().startsWith("mcp__");
}

/** Tools whose `command` is executed by a shell (MCP tools never are). */
export function isShellTool(toolName) {
	if (isMcpTool(toolName)) return false;
	return SHELL_TOOL_NAME_RE.test(String(toolName ?? "").toLowerCase());
}

/**
 * Tools whose `description` is prose about the call, never a stand-in for a missing `command` (on the shell tools of some
 * hosts a lone `description` is read as the command): an MCP tool's, since issue trackers and calendars have one, and Monitor's,
 * which labels the watch (a `ws` source has no command at all). Text there that mentions `rm -rf` or `git push` is not a command.
 */
function hasProseDescription(toolName) {
	return isMcpTool(toolName) || String(toolName ?? "").toLowerCase() === "monitor";
}

// The sed/perl in-place regexes below backtrack quadratically on a long run of
// whitespace or of repeated words (1.8 s at 48 KB), so past this size they are
// replaced by a linear check.
const IN_PLACE_REGEX_MAX_CHARS = 8192;

export function isLikelyShellMutation(toolName, commandText) {
	if (!isShellTool(toolName)) return false;
	const text = String(commandText ?? "");
	// Text over the analysis limit is refused before it can run: skip the heuristics
	// below and report a likely write.
	if (text.length > COMMAND_ANALYSIS_LIMITS.maxCommandChars) return true;
	const command = text.toLowerCase();
	if (!command.trim()) return false;
	// Best-effort common mutation detection only; this is not a sandbox.
	if (/(^|[^<])>>?\s*[^&|]/m.test(command)) return true;
	if (/\b(tee|touch|mkdir|rmdir|rm|mv|cp|truncate)\b/.test(command)) return true;
	if (POWERSHELL_WRITE_CMDLETS.test(command)) return true;
	if (command.length > IN_PLACE_REGEX_MAX_CHARS) {
		// Too long for the exact check: any sed or perl invocation counts as an in-place edit.
		if (/\b(sed|perl)\s/.test(command)) return true;
	} else {
		if (/\bsed\s+[^\n;|&]*-i(?:\s|$)/.test(command)) return true;
		if (/\bperl\s+[^\n;|&]*-p?i(?:\s|$)/.test(command)) return true;
	}
	if (/\bgit\s+(add|commit|checkout|switch|restore|reset|clean|rm|mv)\b/.test(command)) return true;
	if (/\b(npm|pnpm|yarn|bun)\s+(install|add|remove|uninstall|update|upgrade)\b/.test(command)) return true;
	// The aliases are read last and by position (a segment's command word), which takes a parse: `echo sc` is not a write.
	return analyzeCommand(text).segments.some((segment) => WRITE_ALIASES.has(programName(segment.rawTokens[0])));
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

/**
 * Denial reasons reference `heli <cmd>`, but the CLI is often not on PATH in
 * agent sessions. Point at the workspace-embedded copy so the remedy always works.
 */
export function withCliHint(reason) {
	if (!reason || !/`heli /.test(reason)) return reason;
	return `${reason}\n(heli not on PATH? Run: node .heli-harness/heli.mjs <command> from the workspace root.)`;
}

function taskRiskTier(ctx) {
	const taskPath = ctx?.taskPaths?.currentTaskMd;
	if (!taskPath || !existsSync(taskPath)) return "S1";
	return field(readFileSync(taskPath, "utf8"), "Risk tier") || "S1";
}

function grantRequest(ctx, action, env) {
	return {
		action,
		sessionId: ctx.sessionId || null,
		resource: {
			type: "worktree",
			id: resourceIdForWorktree(ctx.worktreeRoot || ctx.workspaceRoot),
		},
		env,
	};
}

/**
 * Read-only: the grant each action would consume, in order, counting the uses an earlier
 * action of the same call takes (one `once` grant pays for one action). null means no usable
 * grant is left for that action. Never consumes a use.
 */
function findScopedGrants(ctx, actions, env = process.env) {
	if (!ctx?.workspaceRoot) return actions.map(() => null);
	try {
		return findUsableGrants(ctx.workspaceRoot, actions.map((action) => grantRequest(ctx, action, env)), { env });
	} catch {
		// Malformed local grant state fails closed (no grant).
		return actions.map(() => null);
	}
}

/** Consume one use; call only once the final decision is allow. */
function consumeScopedGrant(ctx, action, env = process.env) {
	if (!ctx?.workspaceRoot || !action) return null;
	try {
		return consumeApplicableGrant(ctx.workspaceRoot, grantRequest(ctx, action, env));
	} catch {
		// Grant-store contention fails closed.
		return null;
	}
}

function structuredHeliAction(toolInput) {
	const action = toolInput?.heli_action ?? toolInput?.heliAction ?? toolInput?.metadata?.heli_action;
	return action && typeof action === "object" && !Array.isArray(action) ? action : null;
}

/**
 * The fail-closed denial for an MCP input Heli refuses to read (see mcp-input.mjs): hosts treat a hook that times out as an
 * allow, so an input too large to check in time is refused, never checked in part.
 */
function mcpInputTooComplexReason(message) {
	return `Heli-Harness could not evaluate this action (MCP_INPUT_TOO_COMPLEX: ${message}); denying (fail-closed). An MCP call this large cannot be checked against Heli's protected state in time; split it into smaller calls.`;
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
	writeToolNames = DEFAULT_FILE_WRITE_TOOL_NAMES,
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

	// A `command` given as an argv list (Codex's shell tool) is read as the shell-quoted join of
	// its elements, not as their comma-joined text: the floor, the push gate and the mutation
	// checks all work on shell text. A list holding anything but strings is refused below.
	const argv = Array.isArray(toolInput?.command) ? argvCommandText(toolInput.command) : null;
	if (argv && !argv.error) toolInput = { ...toolInput, command: argv.text };

	const baseCwd = cwd || process.cwd();
	const name = String(toolName);
	// An MCP input is server-defined and has no size limit: it is read once, within limits, before anything else looks at it.
	const mcp = isMcpTool(name) ? readMcpInput(toolInput) : null;
	if (mcp?.tooLarge) {
		return { deny: true, hardDeny: true, code: "MCP_INPUT_TOO_COMPLEX", reason: mcpInputTooComplexReason(mcp.tooLarge.message), ctx };
	}
	// One cache for every path this call classifies: it saves lookups, and it counts them against the budget of an MCP call.
	const pathCache = new Map();
	if (mcp) pathCache.maxLookups = MCP_INPUT_LIMITS.maxLookups;
	const rawCommand = String(toolInput?.command ?? (hasProseDescription(toolName) ? undefined : toolInput?.description) ?? "");
	const rawPaths = [...pathsFrom(toolInput), ...patchPathsFrom(rawCommand)];
	const paths = rawPaths.map((path) => path.replaceAll("\\", "/").toLowerCase());

	const shellMutation = isLikelyShellMutation(name, rawCommand);
	const isWrite = isFileMutationTool(name, { paths, writeToolNames }) || shellMutation;
	// Only narrative state files skip the ownership gate (see isTaskStateWriteForContext), and only a write needs it.
	const taskStateOnly = isWrite && isTaskStateWriteForContext(ctx, rawPaths, { cwd: baseCwd, env, cache: pathCache });
	let ownershipDecision = null;

	// A command list that cannot be read as words could hide anything: refuse it, beyond YOLO.
	// (File-editing tools are not analyzed, see below.)
	if (argv?.error && !isFileWriteToolName(name, writeToolNames)) {
		return { deny: true, hardDeny: true, code: "COMMAND_UNPARSEABLE", reason: argv.reason, ctx };
	}

	// Command rules: EVERY rule is evaluated (built-in floor + workspace file).
	// Any T6 match is a hard deny that dominates authority, grants, YOLO and
	// HELI_ALLOW_COMMAND, so it runs before ownership and before YOLO.
	//
	// They read commands, not the content of file-editing tools: an `apply_patch` or
	// `Write` carries data being written (a Makefile line `rm -rf build`, a 100 KB file),
	// never a command being run. A tool is one of these by NAME, from the list that marks
	// it a file writer; any other tool that carries `command` text stays analyzed, whatever
	// its name suggests. Paths are still read from the input above and every write check
	// below still runs.
	const commandPolicy = rawCommand.trim() && !isFileWriteToolName(name, writeToolNames)
		? evaluateCommandRules(ctx.workspaceRoot, rawCommand, env)
		: null;
	// A command too large or too deeply nested to analyze quickly is refused: hosts
	// treat a hook that times out as an allow, and unanalyzed text could hide a T6.
	if (commandPolicy?.limitExceeded) {
		return {
			deny: true,
			hardDeny: true,
			code: "COMMAND_TOO_COMPLEX",
			reason: commandPolicy.limitExceeded.reason,
			ctx,
		};
	}
	if (commandPolicy?.hardDenies.length) {
		return {
			deny: true,
			hardDeny: true,
			code: "TIER_BLOCKED",
			ruleId: commandPolicy.hardDenies[0].id,
			ruleIds: commandPolicy.hardDenies.map((match) => match.id),
			reason: commandPolicy.hardDenies.map(hardDenyReason).join("\n"),
			ctx,
		};
	}

	// Heli's own authority state is never agent-writable: not by the lease
	// holder, not under YOLO. Structured writes are checked by their paths,
	// shell commands by the paths they write, move or delete.
	const pathScope = { workspaceRoot: ctx.workspaceRoot, cwd: baseCwd, env, cache: pathCache };
	// MCP tools: server-defined inputs, so every path-like value is checked.
	const structuredPaths = mcp ? [...new Set([...rawPaths, ...mcp.paths.map((path) => path.text)])] : rawPaths;
	// A command is read for the files it writes wherever it runs: in a shell tool, or in an MCP tool that carries one (a shell
	// server). That MCP tool is still not a shell: it is not guessed at as a write, and not refused for a missing rules file.
	const runsCommand = Boolean(commandPolicy) && (isShellTool(name) || isMcpTool(name));
	if (runsCommand && mcp && mcp.directories.length > MCP_INPUT_LIMITS.maxDirectories) {
		return { deny: true, hardDeny: true, code: "MCP_INPUT_TOO_COMPLEX", reason: mcpInputTooComplexReason(`the number of directory values in a call that carries a command is over the limit of ${MCP_INPUT_LIMITS.maxDirectories}`), ctx };
	}
	let structuredEntries;
	let shellEntries;
	try {
		structuredEntries = mcp || isWrite ? classifyToolPaths(structuredPaths, pathScope) : [];
		shellEntries = [];
		if (runsCommand) {
			// The command runs in the folder the call names (`cwd`, `root`, ...) as well as where the hook started.
			const targets = shellWriteTargets(commandPolicy.analysis);
			shellEntries = classifyShellWriteTargets(targets, pathScope);
			for (const directory of mcp?.directories ?? []) {
				const base = normalizePolicyPath(directory, { cwd: baseCwd, env, cache: pathCache })?.path ?? resolve(baseCwd, directory);
				shellEntries.push(...classifyShellWriteTargets(targets, { ...pathScope, cwd: base }));
			}
		}
	} catch (error) {
		if (error?.code !== "PATH_LOOKUP_BUDGET") throw error;
		return { deny: true, hardDeny: true, code: "MCP_INPUT_TOO_COMPLEX", reason: mcpInputTooComplexReason(error.message), ctx };
	}
	const protectedEntry = [...structuredEntries, ...shellEntries].find((entry) => entry.kind === "authority");
	if (protectedEntry) {
		return { deny: true, hardDeny: true, code: "HELI_STATE_PROTECTED", reason: protectedWriteReason(protectedEntry, { mcp: Boolean(mcp) }), ctx };
	}
	const settingsEntry = [...structuredEntries, ...shellEntries].find((entry) => entry.kind === "claude-settings");
	if (settingsEntry) {
		// A shell command is read whole, and for the assignments jq and PowerShell make; a file tool by the text it puts in the
		// file (not the text it replaces). An MCP tool that carries a command is read both ways: the assignments in its command
		// and every string the call carries (its content, too).
		const loose = isShellTool(name) || runsCommand;
		const written = isShellTool(name) ? rawCommand : settingsContentOf(toolInput);
		if (disablesClaudeHooks(written, { loose })) {
			return {
				deny: true,
				hardDeny: true,
				code: "HELI_HOOKS_PROTECTED",
				reason:
					"Heli-Harness blocks settings changes that disable Claude Code hooks or the Heli plugin (disableAllHooks / enabledPlugins). Ask the user to change Claude settings themselves.",
				ctx,
			};
		}
		// The env block of a settings file can reach Heli's hooks: HELI_YOLO or a relocated grant store is self-approval.
		const heliVariables = heliEnvironmentKeys(written, { loose });
		if (heliVariables.length) {
			return { deny: true, hardDeny: true, code: "HELI_STATE_PROTECTED", reason: protectedEnvironmentReason(settingsEntry, heliVariables), ctx };
		}
	}

	// Ownership gates — NEVER bypassed by YOLO.
	if (isWrite && !taskStateOnly) {
		ownershipDecision = evaluateOwnershipGate(ctx, { isWrite: true });
		if (ownershipDecision.deny) {
			return {
				deny: true,
				reason: withCliHint(ownershipDecision.reason),
				code: ownershipDecision.code,
				ctx,
				coverage: shellMutation ? "shell-mutation-best-effort" : "structured-write",
			};
		}
	}

	if (isWrite && !taskStateOnly && ctx.concurrentMode && ctx.taskId && ctx.sessionId) {
		const activeOwner = sessionHoldsWriteLease(ctx.workspaceRoot, ctx.taskId, ctx.sessionId);
		if (activeOwner || ownershipDecision?.renewalRequired) {
			try {
				refreshLease(ctx.workspaceRoot, ctx.taskId, {
					sessionId: ctx.sessionId,
					allowExpiredOwn: Boolean(ownershipDecision?.renewalRequired),
				});
			} catch (error) {
				return {
					deny: true,
					reason: withCliHint(`Heli-Harness could not establish current write authority before execution: ${error.message}`),
					code: error.code || "LEASE_REFRESH_FAILED",
					ctx,
					coverage: shellMutation ? "shell-mutation-best-effort" : "structured-write",
				};
			}
		}
	}

	// Root-cause/reroute and structured expensive-action gates run before YOLO.
	// YOLO may reduce legacy workflow friction, but it must not make stale
	// diagnosis or unjustified costly retries silently executable.
	const diagnosis = ctx.taskId ? readDiagnosis(ctx.workspaceRoot, ctx.taskId) : null;
	const diagnosisGate = evaluateDiagnosisWriteGate(diagnosis, {
		riskTier: taskRiskTier(ctx),
		isWrite: isWrite && !taskStateOnly,
		action: structuredHeliAction(toolInput),
		policy: readActionPolicy(ctx.workspaceRoot || cwd),
	});
	if (!diagnosisGate.allowed) {
		return {
			deny: true,
			reason: withCliHint(diagnosisGate.reason || `Heli-Harness diagnosis gate: ${diagnosisGate.code}`),
			code: diagnosisGate.code,
			ctx,
		};
	}

	const scope = {
		workspaceRoot: ctx.workspaceRoot || cwd,
		cwd,
		taskId: ctx.taskId,
		sessionId: ctx.sessionId,
		env,
		legacyMode: ctx.legacyMode,
	};
	const yolo = resolveYolo(scope);
	if (yolo.active) {
		return { deny: false, yolo: true, yoloSource: yolo.source, ctx };
	}

	// A Heli workspace whose rules file is missing or unreadable cannot evaluate
	// T5 approvals: deny shell commands instead of silently skipping them.
	if (
		commandPolicy &&
		ctx.workspaceRoot &&
		isShellTool(name) &&
		(commandPolicy.status === "missing" || commandPolicy.status === "malformed")
	) {
		return {
			deny: true,
			code: "COMMAND_RULES_UNAVAILABLE",
			reason: `Heli-Harness cannot evaluate shell commands: the safety rules file ${commandPolicy.rulesPath} is ${commandPolicy.status}. Built-in hard-deny rules still apply, but approval rules cannot be checked, so shell commands are denied until the file is restored (restore it from version control, or run \`heli update\` in an embedded workspace; \`heli doctor\` helps diagnose). File edits are not affected.`,
			ctx,
		};
	}

	// Approval stage: collect EVERY required approval and look grants up
	// read-only. Grants are consumed only after the final decision is allow.
	const requirements = [];
	if (commandPolicy?.gitPush && !allowGitPushScoped(scope)) {
		requirements.push({
			action: "git.push",
			code: "REMOTE_PUSH_DENIED",
			reason:
				"Heli-Harness blocks git push without scoped authority. Ask the user to run `heli grant issue --action git.push --scope once` in their own terminal. Emergency/debug overrides remain HELI_ALLOW_GIT_PUSH or YOLO.",
		});
	}
	const envFile = /(^|\/)\.env(\.|$)/;
	const namesEnvFile = (entry) => entry.normalized && envFile.test(entry.normalized.toLowerCase());
	let envWrite;
	if (mcp) {
		// A read of a `.env` file is not a write, and an MCP tool's input is server-defined: only a call that looks like a write
		// (a tool that writes, moves, copies or deletes, text to put in the file, or a path Heli already reads as a write) counts
		// for every path it names, and otherwise only the paths under a destination-like key (`destination`, `output`, `to` ...).
		const writes = isWrite || mcpToolWrites(name) || mcp.hasContentKey;
		const written = new Set(writes ? structuredPaths : mcp.paths.filter((path) => path.destination).map((path) => path.text));
		envWrite = [...written].some((path) => envFile.test(path.replaceAll("\\", "/").toLowerCase())) ||
			structuredEntries.some((entry) => written.has(entry.raw) && namesEnvFile(entry)) ||
			shellEntries.some(namesEnvFile);
	} else {
		envWrite = paths.some((path) => envFile.test(path)) || [...structuredEntries, ...shellEntries].some(namesEnvFile);
	}
	if (envWrite && !allowEnvWriteScoped(scope)) {
		requirements.push({
			action: "env.write",
			code: "ENV_WRITE_DENIED",
			reason:
				"Heli-Harness blocks .env-style writes without scoped authority. Ask the user to run `heli grant issue --action env.write --scope once` in their own terminal.",
		});
	}
	for (const match of commandPolicy?.approvals || []) {
		requirements.push({
			action: `command.approval.${match.id}`,
			code: "TIER_APPROVAL_REQUIRED",
			ruleId: match.id,
			reason: approvalReason(match),
		});
	}
	// Planned as one set, so a grant that can pay for one approval is not counted for two.
	const planned = findScopedGrants(ctx, requirements.map((requirement) => requirement.action), env);
	const missing = requirements.filter((_, index) => !planned[index]);
	if (missing.length) {
		return {
			deny: true,
			code: missing[0].code,
			...(missing[0].ruleId ? { ruleId: missing[0].ruleId, actionId: missing[0].action } : {}),
			missingApprovals: missing.map((requirement) => requirement.action),
			reason: missing.map((requirement) => requirement.reason).join("\n"),
			ctx,
		};
	}

	if (isWrite && !taskStateOnly) {
		const gateReason = readTaskGateForContext(ctx) || readPlanGateForContext(ctx);
		if (gateReason) return { deny: true, reason: gateReason, ctx };
	}

	// Final decision is allow: consume one use of each approval now.
	const appliedGrants = [];
	for (const requirement of requirements) {
		const grant = consumeScopedGrant(ctx, requirement.action, env);
		if (!grant) {
			return {
				deny: true,
				code: "GRANT_NO_LONGER_AVAILABLE",
				reason: `Heli-Harness could not use the approval for ${requirement.action}: it was used up, revoked or expired while this call was evaluated. Ask the user to issue a new grant.`,
				ctx,
			};
		}
		appliedGrants.push(grant);
	}

	return {
		deny: false,
		ctx,
		...(appliedGrants.length
			? {
					grants: appliedGrants.map((grant) => ({
						grantId: grant.grantId,
						action: grant.action,
						scope: grant.scope,
						resource: grant.resource,
					})),
				}
			: {}),
	};
}

export { resolveExecutionContext };
