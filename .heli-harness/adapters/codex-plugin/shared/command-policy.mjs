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
 * - A quoted word that starts with a program some rule targets, or with a shell or
 *   wrapper unwrapped here, is analyzed as a command line too (`ssh host 'rm -rf /'`,
 *   `su -c '...'`, `watch 'bash -c "..."'`), unless
 *   it is text or data: after echo/grep/..., after -m/--title/..., after `key:` or
 *   `x =`, or in a line of prose. Interpreters (`python -c`) are not read.
 * - Program names are compared without their directory and a trailing
 *   .exe/.cmd/.bat/.com/.ps1, in any case (`git.exe`, `npm.cmd`), by the built-in
 *   rules and by the rules file alike.
 * - Analysis runs inside a deterministic budget (COMMAND_ANALYSIS_LIMITS). A
 *   command over it is refused fail-closed, never analyzed in part and allowed.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathsFor } from "./concurrency/paths.mjs";

const MAX_UNWRAP_DEPTH = 4;
const POSIX_SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish"]);
// git's global options that take the next word as their value (`git help git` and git.c).
// Each of them except -c and --shallow-file also comes as `--option=value`, which is one
// word and needs no skipping. -c covers -C too, since tokens are lowercased. --exec-path
// and --list-cmds only take a value in their `=` form, so they are not listed.
const GIT_OPTIONS_WITH_VALUE = new Set([
	"-c",
	"--config-env",
	"--git-dir",
	"--work-tree",
	"--namespace",
	"--super-prefix",
	"--attr-source",
	"--shallow-file",
]);
// A POSIX shell's long options that take the next word as their value. Every other long
// option is a bare flag (--login, --norc, --noprofile, --posix, --restricted, ...).
const SHELL_LONG_OPTIONS_WITH_VALUE = new Set(["--rcfile", "--init-file"]);
// Words made only of these characters need no quoting in a shell (the set Python's shlex.quote uses).
const UNQUOTED_ARGV_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/;
// Programs whose words are text, patterns or file names and never a command line to run, so a quoted
// word after one of them is data (`echo 'git push is blocked'`, `grep 'rm -rf' scripts`).
const TEXT_PROGRAMS = new Set([
	"echo", "printf", "cat", "grep", "egrep", "fgrep", "rg", "ag", "ack", "sed", "awk", "gawk",
	"findstr", "select-string", "sls", "write-host", "write-output", "set-content", "add-content",
]);
// Options whose next word is a message, a pattern or text to write: the short `-m`, `-am` (not `-e`, which
// is `wsl -e` and `xterm -e`: grep and sed are text programs already), and by name, with one or two dashes
// and in any case, `--message`, `--title`, `--body`, `--grep`, `-Subject`, `-Value`.
const TEXT_OPTION_NAMES = new Set([
	"message", "msg", "title", "body", "notes", "description", "subject", "comment", "reason", "summary", "text",
	"value", "grep", "regexp", "pattern",
]);
const TEXT_SHORT_OPTION = /^-[A-Za-z]{0,2}m$/;
function isTextOption(word) {
	return word.length <= 32 && (TEXT_SHORT_OPTION.test(word) || TEXT_OPTION_NAMES.has(word.replace(/^--?/, "").toLowerCase()));
}
// Programs that run the command after them: skipped, with their options and numeric values, when the
// first command word of a quoted word is looked for (`ssh host 'sudo rm -rf /'`).
const TRANSPARENT_PREFIXES = new Set(["sudo", "doas", "env", "nohup", "time", "nice", "timeout", "exec", "command", "builtin", "busybox"]);
const ASSIGNMENT_WORD = /^[A-Za-z_][A-Za-z0-9_]*=/;
// The words after `for x in` are values to loop over, not programs.
const DATA_HEADS = new Set(["for", "select", "case"]);
// A quoted word right after `key:`, `x =` or `item,`, or an opening bracket, is a value in data or code
// (JSON, YAML, a JS object or array, an assignment), not a command line handed to a program.
function precedesData(word) {
	return ":=,".includes(word.at(-1)) || (word.length <= 4 && /^[[{]+$/.test(word));
}

/**
 * Deterministic analysis budget: counts of work, never wall-clock. Hosts treat a
 * hook that times out as an allow, so a command the analysis cannot finish quickly
 * must be refused (fail-closed) instead. Analysis either finishes within every
 * limit or reports `limitExceeded`; it never skips text silently.
 *
 * - maxCommandChars: longest command text analyzed. Also bounds the regex
 *   heuristics that scan the raw text before analysis.
 * - maxScanChars: characters scanned in total (one scan per dialect per visited
 *   text, counting every unwrapped payload). A backstop against payload fan-out.
 * - maxTokens: words split out in total, across both dialect readings and every
 *   unwrapped payload.
 * - maxSegmentTokens: words in one command. Rule tests scan a command's words
 *   once per program word, so their worst case grows with its square.
 * - maxNesting: sh -c / cmd /c / powershell -Command / eval layers.
 *
 * Sizing (scripts/smoke-command-rules.mjs pins it): the slowest adversarial input
 * that fits these limits takes about 0.5 s through the whole hook (the host's hook
 * timeout is 30 s), while a 200-line prose heredoc uses about a third of the word
 * and character limits.
 */
export const COMMAND_ANALYSIS_LIMITS = Object.freeze({
	maxCommandChars: 49152,
	maxScanChars: 524288,
	maxTokens: 16384,
	maxSegmentTokens: 256,
	maxNesting: MAX_UNWRAP_DEPTH,
});

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

/**
 * The command string a POSIX shell runs with -c, or "" when it runs a script or stdin.
 * Follows the shell's own option parsing from `start` (the word after the shell): short
 * options may be clustered (-lc, -euxc), -o/-O (also +o/+O) take the next word as their
 * value wherever they sit in a cluster, --rcfile/--init-file take one, options may still
 * follow -c, and the command string is the first word that is not an option.
 */
function shellCommandString(tokens, start) {
	let wantsCommand = false;
	for (let j = start; j < tokens.length; j += 1) {
		const token = tokens[j];
		// `--` (or a lone `-`) ends the options; -c then takes the very next word.
		if (token === "--" || token === "-") return wantsCommand ? tokens[j + 1] ?? "" : "";
		if (token.startsWith("--")) {
			if (SHELL_LONG_OPTIONS_WITH_VALUE.has(token)) j += 1;
			continue;
		}
		// A short-option cluster (-c, -lc, -euo). Tested as two linear checks instead of
		// /^-[a-z]*c[a-z]*$/, which backtracks quadratically on a long `-ccc...c!` word.
		// `-C` counts as `-c` too, as it always has: it is fish's init command, and in bash it
		// only makes the next word get analyzed as a command string.
		if (/^[-+][a-z]+$/i.test(token)) {
			for (const letter of token.slice(1)) {
				if ((letter === "c" || letter === "C") && token[0] === "-") wantsCommand = true;
				if (letter === "o" || letter === "O") j += 1;
			}
			continue;
		}
		if (token.length > 1 && (token[0] === "-" || token[0] === "+")) continue;
		return wantsCommand ? token : "";
	}
	return "";
}

/** Inner command strings run by sh/bash -c, cmd /c, pwsh/powershell -Command|-EncodedCommand, eval. */
function unwrapPayloads(tokens) {
	const payloads = [];
	for (let i = 0; i < tokens.length; i += 1) {
		const program = programName(tokens[i]);
		if (POSIX_SHELLS.has(program)) {
			payloads.push(shellCommandString(tokens, i + 1));
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

/** Spelled like a command, not like a capitalized word of prose: `rm`, `RD`, `Remove-Item`, not `Find`. */
function spelledAsCommand(word) {
	return word === word.toLowerCase() || word === word.toUpperCase() || /^[A-Z][a-z]+(?:-[A-Z][a-z]+)+$/.test(word);
}

/** First command word of a quoted word, past `VAR=value` words and transparent prefixes such as `sudo -E`. */
function leadingCommandWord(word) {
	const words = word.slice(0, 512).trim().split(/\s+/);
	let i = 0;
	while (i < words.length) {
		const candidate = words[i];
		if (ASSIGNMENT_WORD.test(candidate)) {
			i += 1;
		} else if (TRANSPARENT_PREFIXES.has(programName(candidate)) && spelledAsCommand(candidate)) {
			i += 1;
			while (i < words.length && (words[i].startsWith("-") || /^\d+$/.test(words[i]))) i += 1;
		} else {
			return candidate;
		}
	}
	return "";
}

/**
 * Quoted words (a word with whitespace inside) that read as a command line handed to some program,
 * such as `ssh host 'rm -rf /'`, `su -c '...'`, `watch '...'`: the word's first command word is a
 * program some rule targets (`programs`). Text and data stay text: nothing counts in a segment that
 * reads as prose (its first word is a capitalized word, a bullet or a quoted word) or as a `for` list,
 * after echo, printf, grep and the like, right after a message, pattern or text option (`-m`,
 * `--title`, `--grep`), or right after `key:`, `x =`, `item,` or an opening bracket (JSON, JS, YAML).
 */
function quotedCommandWords(tokens, programs) {
	const head = tokens[0];
	if (!/^[A-Za-z_.\/~\\$][^\s]*$/.test(head) || /^[A-Z][a-z]+$/.test(head) || DATA_HEADS.has(head)) return [];
	const words = [];
	let printsText = false;
	for (let i = 0; i < tokens.length; i += 1) {
		const token = tokens[i];
		if (TEXT_PROGRAMS.has(programName(token))) printsText = true;
		if (printsText || i === 0 || !/\s/.test(token)) continue;
		if (isTextOption(tokens[i - 1]) || precedesData(tokens[i - 1])) continue;
		const first = leadingCommandWord(token);
		if (first && spelledAsCommand(first) && programs.has(programName(first))) words.push(token);
	}
	return words;
}

/**
 * Parse command text into de-duplicated segments, within COMMAND_ANALYSIS_LIMITS.
 * @param {string} command
 * @param {{ limits?: typeof COMMAND_ANALYSIS_LIMITS, commandPrograms?: Set<string> }} [options] `limits` lets tests hit
 *   each limit with small input. `commandPrograms` are the programs rules target (see commandProgramNames): a quoted
 *   word that starts with one is analyzed as a command line. Default: the built-in rules' programs.
 * @returns {{
 *   segments: Array<{ tokens: string[], rawTokens: string[], text: string, dialect: "posix"|"windows" }>,
 *   limitExceeded: null | { limit: string, max: number, message: string },
 *   work: { commandChars: number, scannedChars: number, tokens: number, segmentTokens: number, nesting: number },
 * }}
 *   `tokens` are lowercased with git global options removed; `rawTokens` keep case.
 *   When `limitExceeded` is set the analysis stopped early and `segments` is
 *   incomplete: callers must refuse the command instead of matching rules on it.
 */
export function analyzeCommand(command, { limits = COMMAND_ANALYSIS_LIMITS, commandPrograms = BUILTIN_COMMAND_PROGRAMS } = {}) {
	const commandText = String(command ?? "");
	const segments = [];
	const seen = new Set();
	const visited = new Set();
	const work = { commandChars: commandText.length, scannedChars: 0, tokens: 0, segmentTokens: 0, nesting: 0 };
	let limitExceeded = null;
	const exceed = (limit, max, message) => {
		limitExceeded ??= { limit, max, message };
	};
	const visit = (source, depth) => {
		if (limitExceeded) return;
		if (depth === 0 && source.length > limits.maxCommandChars) {
			exceed("command-chars", limits.maxCommandChars, `the command is ${source.length} characters long and the limit is ${limits.maxCommandChars}`);
			return;
		}
		if (!source.trim()) return;
		if (depth > limits.maxNesting) {
			exceed("nesting", limits.maxNesting, `its shell commands are nested more than ${limits.maxNesting} levels deep`);
			return;
		}
		// Re-visiting the same text at the same depth adds nothing, and without this
		// a run of `eval` tokens (each unwraps to its own suffix) grows exponentially.
		const visitKey = `${depth}\u0000${source}`;
		if (visited.has(visitKey)) return;
		visited.add(visitKey);
		work.nesting = Math.max(work.nesting, depth);
		work.scannedChars += source.length * 2; // one scan per dialect
		if (work.scannedChars > limits.maxScanChars) {
			exceed("scan-chars", limits.maxScanChars, `checking it would scan more than ${limits.maxScanChars} characters of shell text once nested commands are unwrapped`);
			return;
		}
		for (const dialect of ["posix", "windows"]) {
			for (const text of splitSegments(source, dialect)) {
				const rawTokens = tokenize(text, dialect);
				if (!rawTokens.length) continue;
				work.segmentTokens = Math.max(work.segmentTokens, rawTokens.length);
				work.tokens += rawTokens.length;
				if (rawTokens.length > limits.maxSegmentTokens) {
					exceed("segment-tokens", limits.maxSegmentTokens, `one command in it has more than ${limits.maxSegmentTokens} words`);
					return;
				}
				if (work.tokens > limits.maxTokens) {
					exceed("tokens", limits.maxTokens, `it has more than ${limits.maxTokens} words`);
					return;
				}
				const tokens = normalizeGitTokens(rawTokens.map((token) => token.toLowerCase()));
				const key = `${dialect}\u0000${tokens.join("\u0000")}`;
				if (!seen.has(key)) {
					seen.add(key);
					segments.push({ tokens, rawTokens, text, dialect });
				}
				// Wrapper payloads and quoted command lines are visited like the command itself, so they
				// count against the same word, character and nesting limits.
				for (const payload of new Set([...unwrapPayloads(rawTokens), ...quotedCommandWords(rawTokens, commandPrograms)])) {
					visit(payload, depth + 1);
					if (limitExceeded) return;
				}
			}
		}
	};
	visit(commandText, 0);
	return { segments, limitExceeded, work };
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
 * program (`node .heli-harness/heli.mjs push` trips `heli.mjs push`), and a bare
 * program name matches its Windows spellings the way the built-in rules do: the
 * directory and a trailing .exe/.cmd/.bat/.com/.ps1 are ignored, in any case
 * (`npm.cmd publish`, `"C:\Program Files\Git\cmd\git.exe" push`). Applied to the
 * FIRST rule token only.
 */
function commandTokenMatches(commandToken, ruleToken, isProgramPosition) {
	if (commandToken === ruleToken) return true;
	if (!isProgramPosition) return false;
	if (commandToken.endsWith(`/${ruleToken}`) || commandToken.endsWith(`\\${ruleToken}`)) return true;
	return !/[\\/]/.test(ruleToken) && programName(commandToken) === programName(ruleToken);
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

/**
 * A standalone Windows switch token: `/s`, or several written together (`/s/q`, `/S/Q`).
 * Each switch is one letter or `?` (`/a:h` may carry attributes), so a path such as
 * `/tmp/s` is never a switch.
 */
function hasWindowsSwitch(args, name) {
	return args.some((arg) => {
		if (!arg.startsWith("/")) return false;
		const switches = arg.slice(1).split("/");
		return switches.every((item) => /^[a-z?](?::.*)?$/i.test(item)) && switches.some((item) => item.split(":")[0].toLowerCase() === name);
	});
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
 * `programs` are the program names the rule looks at: a quoted word that starts
 * with one of them is analyzed as a command line (`ssh host 'rm -rf /'`). A rule
 * that lists none is not consulted for that, so every rule must list its own.
 */
export const BUILTIN_COMMAND_RULES = Object.freeze([
	Object.freeze({ id: "destructive-delete", tier: "T6", programs: ["rm"], summary: "rm -rf", reason: "Recursive forced delete is destructive", test: rmRecursiveForce }),
	Object.freeze({ id: "git-clean-force", tier: "T6", programs: ["git"], summary: "git clean -f with -d/-x", reason: "git clean with force and -d/-x deletes untracked work", test: gitCleanForce }),
	Object.freeze({ id: "git-reset-hard", tier: "T6", programs: ["git"], summary: "git reset --hard", reason: "git reset --hard discards local work", test: gitResetHard }),
	Object.freeze({ id: "windows-rmdir", tier: "T6", programs: ["rd", "rmdir"], summary: "rd/rmdir /s", reason: "Recursive delete is destructive", test: cmdRecursiveRmdir }),
	Object.freeze({ id: "windows-del", tier: "T6", programs: ["del", "erase"], summary: "del/erase /s", reason: "Recursive delete is destructive", test: cmdRecursiveDel }),
	Object.freeze({ id: "powershell-remove-item-recurse-force", tier: "T6", programs: ["remove-item", "ri", "rm", "rmdir", "rd", "del", "erase"], summary: "Remove-Item -Recurse -Force", reason: "Recursive forced delete is destructive", test: removeItemRecurseForce }),
	Object.freeze({ id: "find-delete", tier: "T6", programs: ["find"], summary: "find ... -delete", reason: "find -delete is destructive", test: findDelete }),
	Object.freeze({ id: "git-push-force", tier: "T5", programs: ["git"], summary: "git push --force", reason: "Force-pushing rewrites remote history", test: gitPushForce }),
]);

const BUILTIN_IDS = new Set(BUILTIN_COMMAND_RULES.map((rule) => rule.id));
// The shells and wrappers unwrapPayloads reads (sh -c, cmd /c, powershell -Command, eval) count as targets too:
// a quoted word that starts with one of them (`bash -c "rm -rf x"`) hands its payload to the rules.
const UNWRAPPED_PROGRAMS = [...POSIX_SHELLS, "cmd", "powershell", "pwsh", "eval"];
const BUILTIN_COMMAND_PROGRAMS = new Set([...UNWRAPPED_PROGRAMS, ...BUILTIN_COMMAND_RULES.flatMap((rule) => rule.programs ?? [])]);

/**
 * The program names a quoted word may start with to be analyzed as a command line: the built-in rules'
 * `programs`, the shells and wrappers the analysis unwraps, and the program each rules-file rule starts with.
 */
export function commandProgramNames(projectRules = []) {
	const names = new Set(BUILTIN_COMMAND_PROGRAMS);
	for (const rule of projectRules) {
		if (rule.ruleTokens?.length) names.add(programName(rule.ruleTokens[0]));
	}
	return names;
}

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
 * Command text for a `command` that is an argv list (Codex's shell tool sends
 * `["bash", "-lc", "git push --force"]`): the elements joined with the quoting a shell
 * needs, so that reads as `bash -lc 'git push --force'` and every element stays one word.
 * A list holding anything but strings cannot be read. Building stops once the text is
 * over the command limit (the analysis refuses it), so a huge list costs no more than
 * the limit allows.
 * @returns {{ text: string } | { error: string, reason: string }}
 */
export function argvCommandText(argv) {
	const unreadable = () => {
		const error = "the command is a list with an element that is not a string";
		return {
			error,
			reason: `Heli-Harness could not evaluate this action (COMMAND_UNPARSEABLE: ${error}); denying (fail-closed). Send the command as one string, or as a list of strings.`,
		};
	};
	if (!Array.isArray(argv)) return unreadable();
	const words = [];
	let length = 0;
	for (let i = 0; i < argv.length && length <= COMMAND_ANALYSIS_LIMITS.maxCommandChars; i += 1) {
		const word = argv[i];
		if (typeof word !== "string") return unreadable();
		const quoted = word.length > COMMAND_ANALYSIS_LIMITS.maxCommandChars || (word !== "" && UNQUOTED_ARGV_WORD.test(word))
			? word
			: `'${word.replaceAll("'", "'\\''")}'`;
		words.push(quoted);
		length += quoted.length + 1;
	}
	return { text: words.join(" ") };
}

/** Fail-closed reason for a command the analysis refused (see COMMAND_ANALYSIS_LIMITS). */
function limitExceededReason(limitExceeded) {
	return `Heli-Harness could not evaluate this action (COMMAND_TOO_COMPLEX: ${limitExceeded.message}); denying (fail-closed). Commands this large or deeply nested cannot be checked against the safety rules in time. Use the Write or Edit tool for large file content, or split the command into smaller commands.`;
}

/**
 * Evaluate a command against built-in + workspace rules.
 * @returns {{ status: string, rulesPath: string|null, analysis: object, gitPush: boolean, hardDenies: object[], approvals: object[], limitExceeded: null|{ limit: string, max: number, message: string, reason: string } }}
 *   `approvals` excludes T5 ids approved via HELI_ALLOW_COMMAND; T6 is never approvable.
 *   `limitExceeded` is set when the command is over the analysis budget: no rule was
 *   evaluated, and the caller must deny it with `limitExceeded.reason`.
 */
export function evaluateCommandRules(workspaceRoot, command, env = process.env) {
	const loaded = loadCommandRules(workspaceRoot);
	const analysis = analyzeCommand(command, { commandPrograms: commandProgramNames(loaded.projectRules) });
	if (analysis.limitExceeded) {
		return {
			status: loaded.status,
			rulesPath: loaded.rulesPath,
			analysis,
			gitPush: false,
			hardDenies: [],
			approvals: [],
			limitExceeded: { ...analysis.limitExceeded, reason: limitExceededReason(analysis.limitExceeded) },
		};
	}
	const matches = matchCommandRules(analysis, loaded.projectRules);
	const approved = new Set(String(env.HELI_ALLOW_COMMAND || "").split(",").map((value) => value.trim()).filter(Boolean));
	return {
		status: loaded.status,
		rulesPath: loaded.rulesPath,
		analysis,
		gitPush: commandRunsGitPush(analysis),
		hardDenies: matches.filter((match) => match.tier === "T6"),
		approvals: matches.filter((match) => match.tier === "T5" && !approved.has(match.id)),
		limitExceeded: null,
	};
}
