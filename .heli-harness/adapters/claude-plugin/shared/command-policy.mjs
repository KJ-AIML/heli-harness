/**
 * Command policy: parse shell command text and evaluate command rules.
 *
 * - Every rule is evaluated (no first-match short circuit): any T6 match is a
 *   hard deny; every matched T5 rule needs its own approval.
 * - BUILTIN_COMMAND_RULES is a non-removable floor. Project/workspace rules from
 *   safety/command-rules.json may ADD rules; a project rule that reuses a
 *   built-in id is ignored, so a built-in can never be removed or weakened.
 * - Parsing is best-effort normalization, not a sandbox: quotes and escapes are
 *   removed, chains/pipes/subshells are split into segments, git global options
 *   are skipped, and sh/bash/cmd/pwsh/powershell/eval payloads are unwrapped.
 *   Each segment is read in a POSIX and a Windows dialect; a rule matches if
 *   ANY plausible reading matches.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathsFor } from "./concurrency/paths.mjs";

const MAX_UNWRAP_DEPTH = 4;
const POSIX_SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish"]);
const GIT_OPTIONS_WITH_VALUE = new Set(["-c", "--git-dir", "--work-tree", "--namespace"]);

/** Lowercased program name of a token: strips directories and .exe/.cmd/.bat/.com/.ps1. */
export function programName(token) {
	const base = String(token ?? "").toLowerCase().replaceAll("\\", "/").split("/").pop();
	return base.replace(/\.(exe|cmd|bat|com|ps1)$/, "");
}

function splitSegments(text, dialect) {
	// Line continuations join lines: `\`+newline (POSIX), backtick/caret+newline
	// (PowerShell/cmd). Remaining backticks/carets are Windows escape characters.
	const source = dialect === "windows"
		? text.replace(/[`^]\r?\n/g, " ").replace(/[`^]/g, "")
		: text.replace(/\\\r?\n/g, "");
	const segments = [];
	let current = "";
	let quote = null;
	for (let i = 0; i < source.length; i += 1) {
		const ch = source[i];
		if (quote) {
			current += ch;
			if (dialect === "posix" && quote === "\"" && ch === "\\" && i + 1 < source.length) {
				current += source[++i];
				continue;
			}
			if (ch === quote) quote = null;
			continue;
		}
		if (ch === "'" || ch === "\"") {
			quote = ch;
			current += ch;
			continue;
		}
		if (dialect === "posix" && ch === "\\" && i + 1 < source.length) {
			current += ch + source[++i];
			continue;
		}
		const prev = source[i - 1];
		const next = source[i + 1];
		const redirectAmpersand = ch === "&" && (prev === ">" || prev === "<" || next === ">");
		const separator =
			!redirectAmpersand &&
			(ch === ";" || ch === "\n" || ch === "\r" || ch === "|" || ch === "&" || ch === "(" || ch === ")" ||
				(dialect === "posix" && ch === "`"));
		if (separator) {
			if (current.trim()) segments.push(current.trim());
			current = "";
			continue;
		}
		current += ch;
	}
	if (current.trim()) segments.push(current.trim());
	return segments;
}

function tokenize(segment, dialect) {
	const tokens = [];
	let current = "";
	let inToken = false;
	let quote = null;
	for (let i = 0; i < segment.length; i += 1) {
		const ch = segment[i];
		if (quote) {
			if (ch === quote) {
				quote = null;
				continue;
			}
			if (dialect === "posix" && quote === "\"" && ch === "\\" && i + 1 < segment.length && "\"\\$`\n".includes(segment[i + 1])) {
				current += segment[++i];
				continue;
			}
			current += ch;
			continue;
		}
		if (ch === "'" || ch === "\"") {
			quote = ch;
			inToken = true;
			continue;
		}
		if (dialect === "posix" && ch === "\\" && i + 1 < segment.length) {
			current += segment[++i];
			inToken = true;
			continue;
		}
		if (/\s/.test(ch)) {
			if (inToken && current) tokens.push(current);
			current = "";
			inToken = false;
			continue;
		}
		current += ch;
		inToken = true;
	}
	if (inToken && current) tokens.push(current);
	return tokens;
}

function decodePowerShellBase64(value) {
	try {
		return Buffer.from(String(value), "base64").toString("utf16le");
	} catch {
		return "";
	}
}

/** Inner command strings run by sh/bash -c, cmd /c, pwsh/powershell -Command|-EncodedCommand, eval. */
function unwrapPayloads(tokens) {
	const payloads = [];
	for (let i = 0; i < tokens.length; i += 1) {
		const program = programName(tokens[i]);
		if (POSIX_SHELLS.has(program)) {
			for (let j = i + 1; j < tokens.length; j += 1) {
				if (/^-[a-z]*c[a-z]*$/i.test(tokens[j]) && j + 1 < tokens.length) {
					payloads.push(tokens[j + 1]);
					break;
				}
				if (!tokens[j].startsWith("-")) break;
			}
		} else if (program === "cmd") {
			const flag = tokens.findIndex((token, index) => index > i && /^\/[ck]$/i.test(token));
			if (flag > i) payloads.push(tokens.slice(flag + 1).join(" "));
		} else if (program === "powershell" || program === "pwsh") {
			for (let j = i + 1; j < tokens.length; j += 1) {
				const option = tokens[j].toLowerCase();
				if (option.length >= 2 && "-command".startsWith(option)) {
					payloads.push(tokens.slice(j + 1).join(" "));
					break;
				}
				if ((option === "-e" || option === "-ec" || (option.length >= 3 && "-encodedcommand".startsWith(option))) && j + 1 < tokens.length) {
					payloads.push(decodePowerShellBase64(tokens[j + 1]));
					break;
				}
			}
		} else if (program === "eval") {
			payloads.push(tokens.slice(i + 1).join(" "));
		}
	}
	return payloads.filter((payload) => payload && payload.trim());
}

/**
 * Parse command text into de-duplicated segments.
 * @returns {{ segments: Array<{ tokens: string[], rawTokens: string[], text: string, dialect: "posix"|"windows" }> }}
 *   `tokens` are lowercased with git global options removed; `rawTokens` keep case.
 */
export function analyzeCommand(command) {
	const segments = [];
	const seen = new Set();
	const visited = new Set();
	const visit = (source, depth) => {
		if (!String(source ?? "").trim() || depth > MAX_UNWRAP_DEPTH) return;
		// Re-visiting the same text at the same depth adds nothing, and without this
		// a run of `eval` tokens (each unwraps to its own suffix) grows exponentially.
		const visitKey = `${depth}\u0000${source}`;
		if (visited.has(visitKey)) return;
		visited.add(visitKey);
		for (const dialect of ["posix", "windows"]) {
			for (const text of splitSegments(String(source), dialect)) {
				const rawTokens = tokenize(text, dialect);
				if (!rawTokens.length) continue;
				const tokens = normalizeGitTokens(rawTokens.map((token) => token.toLowerCase()));
				const key = `${dialect}\u0000${tokens.join("\u0000")}`;
				if (!seen.has(key)) {
					seen.add(key);
					segments.push({ tokens, rawTokens, text, dialect });
				}
				for (const payload of unwrapPayloads(rawTokens)) visit(payload, depth + 1);
			}
		}
	};
	visit(command, 0);
	return { segments };
}

/** Drop git global options (`-C dir`, `-c k=v`, `--git-dir=x`, `--no-pager`, ...) so `git -C . push` reads as `git push`. */
export function normalizeGitTokens(tokens) {
	const out = [];
	for (let i = 0; i < tokens.length; i += 1) {
		out.push(tokens[i]);
		if (programName(tokens[i]) !== "git") continue;
		let j = i + 1;
		while (j < tokens.length && tokens[j].startsWith("-")) {
			const option = tokens[j];
			j += 1;
			if (!option.includes("=") && GIT_OPTIONS_WITH_VALUE.has(option)) j += 1;
		}
		i = j - 1;
	}
	return out;
}

/**
 * Split a rule's `match` into lowercase tokens.
 * Separators become boundaries and surrounding quotes are stripped.
 */
export function commandRuleTokens(value) {
	return String(value ?? "")
		.toLowerCase()
		.replace(/[;&|()\r\n]/g, " ")
		.split(/\s+/)
		.map((token) => token.replace(/^["'`]+/, "").replace(/["'`]+$/, ""))
		.filter(Boolean);
}

/**
 * Program-position tokens also match a path-qualified invocation of the same
 * program (`node .heli-harness/heli.mjs push` trips `heli.mjs push`). Applied to
 * the FIRST rule token only.
 */
function commandTokenMatches(commandToken, ruleToken, isProgramPosition) {
	if (commandToken === ruleToken) return true;
	if (!isProgramPosition) return false;
	return commandToken.endsWith(`/${ruleToken}`) || commandToken.endsWith(`\\${ruleToken}`);
}

/** True when the rule tokens appear as a consecutive run in the command tokens. */
export function commandMatchesRuleTokens(commandTokens, ruleTokens) {
	if (!ruleTokens.length || ruleTokens.length > commandTokens.length) return false;
	for (let start = 0; start + ruleTokens.length <= commandTokens.length; start += 1) {
		let hit = true;
		for (let offset = 0; offset < ruleTokens.length; offset += 1) {
			if (!commandTokenMatches(commandTokens[start + offset], ruleTokens[offset], offset === 0)) {
				hit = false;
				break;
			}
		}
		if (hit) return true;
	}
	return false;
}

function indexesOfProgram(tokens, names) {
	const found = [];
	tokens.forEach((token, index) => {
		if (names.includes(programName(token))) found.push(index);
	});
	return found;
}

function argsAfter(tokens, index) {
	const args = [];
	for (const token of tokens.slice(index + 1)) {
		if (token === "--") break;
		args.push(token);
	}
	return args;
}

function shortFlags(token) {
	return /^-[a-z]+$/.test(token) ? token.slice(1) : "";
}

function gitSubcommandArgs(tokens, subcommand) {
	for (const index of indexesOfProgram(tokens, ["git"])) {
		if (tokens[index + 1] === subcommand) return tokens.slice(index + 2);
	}
	return null;
}

function rmRecursiveForce(tokens) {
	return indexesOfProgram(tokens, ["rm"]).some((index) => {
		let recursive = false;
		let force = false;
		for (const arg of argsAfter(tokens, index)) {
			if (arg === "--recursive") recursive = true;
			else if (arg === "--force") force = true;
			else if (shortFlags(arg)) {
				if (/r/.test(shortFlags(arg))) recursive = true;
				if (/f/.test(shortFlags(arg))) force = true;
			}
		}
		return recursive && force;
	});
}

function gitCleanForce(tokens) {
	const args = gitSubcommandArgs(tokens, "clean");
	if (!args) return false;
	let force = false;
	let dirsOrIgnored = false;
	let dryRun = false;
	for (const arg of args) {
		if (arg === "--force") force = true;
		else if (arg === "--dry-run") dryRun = true;
		else if (shortFlags(arg)) {
			const flags = shortFlags(arg);
			if (flags.includes("f")) force = true;
			if (flags.includes("d") || flags.includes("x")) dirsOrIgnored = true;
			if (flags.includes("n")) dryRun = true;
		}
	}
	return force && dirsOrIgnored && !dryRun;
}

function gitResetHard(tokens) {
	const args = gitSubcommandArgs(tokens, "reset");
	return Boolean(args && args.includes("--hard"));
}

function gitPushForce(tokens) {
	const args = gitSubcommandArgs(tokens, "push");
	if (!args) return false;
	return args.some((arg) =>
		arg === "--force" ||
		arg.startsWith("--force-with-lease") ||
		arg === "--force-if-includes" ||
		(shortFlags(arg) && shortFlags(arg).includes("f")) ||
		(arg.startsWith("+") && arg.length > 1),
	);
}

function hasWindowsSwitch(args, name) {
	return args.some((arg) => arg.startsWith("/") && arg.split("/").includes(name));
}

function cmdRecursiveRmdir(tokens) {
	return indexesOfProgram(tokens, ["rd", "rmdir"]).some((index) => hasWindowsSwitch(argsAfter(tokens, index), "s"));
}

function cmdRecursiveDel(tokens) {
	return indexesOfProgram(tokens, ["del", "erase"]).some((index) => hasWindowsSwitch(argsAfter(tokens, index), "s"));
}

function powerShellParam(arg, fullName, minLength) {
	const name = arg.split(":")[0];
	return name.length >= minLength && fullName.startsWith(name);
}

function removeItemRecurseForce(tokens) {
	return indexesOfProgram(tokens, ["remove-item", "ri", "rm", "rmdir", "rd", "del", "erase"]).some((index) => {
		const args = argsAfter(tokens, index);
		const recurse = args.some((arg) => powerShellParam(arg, "-recurse", 2));
		const force = args.some((arg) => powerShellParam(arg, "-force", 3));
		return recurse && force;
	});
}

const FIND_NAME_FILTERS = new Set(["-name", "-iname", "-path", "-ipath", "-wholename", "-iwholename", "-regex", "-iregex"]);

/** `find ... -delete` without a name/path filter (e.g. `find . -delete`, `find src -type f -delete`). */
function findDelete(tokens) {
	return indexesOfProgram(tokens, ["find"]).some((index) => {
		const args = argsAfter(tokens, index);
		return args.includes("-delete") && !args.some((arg) => FIND_NAME_FILTERS.has(arg));
	});
}

/**
 * Non-removable built-in rules. Ids that also appear in the shipped
 * command-rules.json are intentional: the built-in wins over the file copy.
 * A rule's `test(tokens)` returns false, true, or a string that replaces
 * `summary` in the deny reason. `kind` (optional) replaces "destructive command".
 */
export const BUILTIN_COMMAND_RULES = Object.freeze([
	Object.freeze({ id: "destructive-delete", tier: "T6", summary: "rm -rf", reason: "Recursive forced delete is destructive", test: rmRecursiveForce }),
	Object.freeze({ id: "git-clean-force", tier: "T6", summary: "git clean -f with -d/-x", reason: "git clean with force and -d/-x deletes untracked work", test: gitCleanForce }),
	Object.freeze({ id: "git-reset-hard", tier: "T6", summary: "git reset --hard", reason: "git reset --hard discards local work", test: gitResetHard }),
	Object.freeze({ id: "windows-rmdir", tier: "T6", summary: "rd/rmdir /s", reason: "Recursive delete is destructive", test: cmdRecursiveRmdir }),
	Object.freeze({ id: "windows-del", tier: "T6", summary: "del/erase /s", reason: "Recursive delete is destructive", test: cmdRecursiveDel }),
	Object.freeze({ id: "powershell-remove-item-recurse-force", tier: "T6", summary: "Remove-Item -Recurse -Force", reason: "Recursive forced delete is destructive", test: removeItemRecurseForce }),
	Object.freeze({ id: "find-delete", tier: "T6", summary: "find ... -delete", reason: "find -delete is destructive", test: findDelete }),
	Object.freeze({ id: "git-push-force", tier: "T5", summary: "git push --force", reason: "Force-pushing rewrites remote history", test: gitPushForce }),
]);

const BUILTIN_IDS = new Set(BUILTIN_COMMAND_RULES.map((rule) => rule.id));

/**
 * Load the workspace's command-rules.json.
 * status: "no-workspace" (not a Heli workspace: built-ins only), "ok", "missing" or "malformed".
 */
export function loadCommandRules(workspaceRoot) {
	if (!workspaceRoot) return { status: "no-workspace", rulesPath: null, projectRules: [] };
	const rulesPath = join(pathsFor(workspaceRoot).safetyDir, "command-rules.json");
	if (!existsSync(rulesPath)) return { status: "missing", rulesPath, projectRules: [] };
	let parsed;
	try {
		parsed = JSON.parse(readFileSync(rulesPath, "utf8"));
	} catch {
		return { status: "malformed", rulesPath, projectRules: [] };
	}
	if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.rules)) {
		return { status: "malformed", rulesPath, projectRules: [] };
	}
	const projectRules = parsed.rules
		.filter((rule) => rule && typeof rule.id === "string" && typeof rule.match === "string")
		.filter((rule) => rule.tier === "T5" || rule.tier === "T6")
		// git-push has a dedicated scoped check; built-in ids cannot be redefined.
		.filter((rule) => rule.id !== "git-push" && !BUILTIN_IDS.has(rule.id))
		.map((rule) => ({
			id: rule.id,
			tier: rule.tier,
			summary: rule.match,
			reason: rule.reason || "see safety/command-rules.json",
			ruleTokens: commandRuleTokens(rule.match),
			source: "project",
		}))
		.filter((rule) => rule.ruleTokens.length > 0);
	return { status: "ok", rulesPath, projectRules };
}

/** Every built-in and project rule that matches any segment of the command. */
export function matchCommandRules(analysis, projectRules = []) {
	const matches = new Map();
	for (const segment of analysis.segments) {
		for (const rule of BUILTIN_COMMAND_RULES) {
			if (matches.has(rule.id)) continue;
			const hit = rule.test(segment.tokens);
			if (hit) {
				matches.set(rule.id, {
					id: rule.id,
					tier: rule.tier,
					kind: rule.kind || null,
					summary: typeof hit === "string" ? hit : rule.summary,
					reason: rule.reason,
					source: "builtin",
				});
			}
		}
		for (const rule of projectRules) {
			if (!matches.has(rule.id) && commandMatchesRuleTokens(segment.tokens, rule.ruleTokens)) {
				matches.set(rule.id, { id: rule.id, tier: rule.tier, summary: rule.summary, reason: rule.reason, source: rule.source });
			}
		}
	}
	return [...matches.values()];
}

/** True when any segment runs `git ... push` (after git global options are removed). */
export function commandRunsGitPush(analysis) {
	return analysis.segments.some((segment) => commandMatchesRuleTokens(segment.tokens, ["git", "push"]));
}

export function hardDenyReason(match) {
	return `Heli-Harness blocks ${match.kind || "destructive command"} "${match.summary}" (rule ${match.id}, tier T6): ${match.reason}. This is a hard deny; scoped grants, YOLO and HELI_ALLOW_COMMAND do not override it.`;
}

export function approvalReason(match) {
	return `Heli-Harness requires explicit approval for "${match.summary}" (rule ${match.id}, tier T5): ${match.reason}. Ask the user to run \`heli grant issue --action command.approval.${match.id} --scope once\` in their own terminal. Emergency/debug overrides remain HELI_ALLOW_COMMAND=${match.id} or YOLO.`;
}

/**
 * Evaluate a command against built-in + workspace rules.
 * @returns {{ status: string, rulesPath: string|null, analysis: object, gitPush: boolean, hardDenies: object[], approvals: object[] }}
 *   `approvals` excludes T5 ids approved via HELI_ALLOW_COMMAND; T6 is never approvable.
 */
export function evaluateCommandRules(workspaceRoot, command, env = process.env) {
	const loaded = loadCommandRules(workspaceRoot);
	const analysis = analyzeCommand(command);
	const matches = matchCommandRules(analysis, loaded.projectRules);
	const approved = new Set(String(env.HELI_ALLOW_COMMAND || "").split(",").map((value) => value.trim()).filter(Boolean));
	return {
		status: loaded.status,
		rulesPath: loaded.rulesPath,
		analysis,
		gitPush: commandRunsGitPush(analysis),
		hardDenies: matches.filter((match) => match.tier === "T6"),
		approvals: matches.filter((match) => match.tier === "T5" && !approved.has(match.id)),
	};
}
