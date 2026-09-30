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
 * - Comments are not commands: when the shell that runs the text is known (the tool's name says
 *   bash or PowerShell, or a `bash -c` / `pwsh -Command` / `eval` payload), the comments that
 *   shell ignores are left out first (shell-comments.mjs), so `# never rm -rf here` or
 *   `npm test # then git push` is not a hard deny. Text of an unknown shell is read whole.
 * - Program names are compared without their directory and a trailing
 *   .exe/.cmd/.bat/.com/.ps1, in any case (`git.exe`, `npm.cmd`), by the built-in
 *   rules and by the rules file alike.
 * - Analysis runs inside a deterministic budget (COMMAND_ANALYSIS_LIMITS). A
 *   command over it is refused fail-closed, never analyzed in part and allowed.
 * - Heli's own privilege commands (`heli grant issue`, `heli yolo on`, takeovers, write
 *   transfers, removing Heli or its host plugins, and any Heli invocation that carries
 *   `--accept-policy-changes`) are built-in T6 rules: the hook refuses every spelled-out form
 *   of them this module recognizes (`heli`, `heli-harness`, `node .../heli.mjs`, the package
 *   runners, quoted command lines, argv lists), whatever YOLO or a grant says. Like all of this
 *   parsing it reads command text, so it is a guardrail, not a guarantee: a command that never
 *   spells one out (built at run time, or run by code the agent writes) is out of its reach.
 *   shellWriteTargets lists the paths a command writes, for the protected-state check in hook-core.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathsFor } from "./concurrency/paths.mjs";
import { MAX_SYNTAX_DEPTH, stripComments } from "./shell-comments.mjs";

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
 * - maxSyntaxNesting: quotes, substitutions and braces inside one another (`"$(echo "$(...)")"`), where
 *   the comment scan of a known shell recurses; real commands stay under ten levels.
 *
 * Sizing (scripts/smoke-command-rules.mjs pins it): the slowest adversarial input
 * that fits these limits takes about 0.5 s through the whole hook (the host's hook
 * timeout is 30 s), while a 200-line prose heredoc uses about a third of the word
 * and character limits. The protected-state check that follows (shellWriteTargets and
 * classifyShellWriteTargets; scripts/smoke-self-protection.mjs pins it) adds about 0.6 s
 * for the worst fit, a thousand paths each in its own chain of missing directories, and
 * under a second for a `cd` chain of the length the limits allow (some 4,000 `cd`s, or 1,300
 * of them each followed by a write): a chain costs a target no more than a short one does.
 */
export const COMMAND_ANALYSIS_LIMITS = Object.freeze({
	maxCommandChars: 49152,
	maxScanChars: 524288,
	maxTokens: 16384,
	maxSegmentTokens: 256,
	maxNesting: MAX_UNWRAP_DEPTH,
	maxSyntaxNesting: MAX_SYNTAX_DEPTH,
});

/** Lowercased program name of a token: strips directories and .exe/.cmd/.bat/.com/.ps1. */
export function programName(token) {
	const base = String(token ?? "").toLowerCase().replaceAll("\\", "/").split("/").pop();
	return base.replace(/\.(exe|cmd|bat|com|ps1)$/, "");
}

const ANSI_C_ESCAPES = { a: "\x07", b: "\b", e: "\x1b", E: "\x1b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", "\\": "\\", "'": "'", "\"": "\"", "?": "?" };

/** What `$'...'` makes of the text between its quotes: the backslash escapes bash knows, decoded (others stay as written). */
function decodeAnsiC(body) {
	return body.replace(/\\(?:([0-7]{1,3})|x([0-9a-fA-F]{1,2})|u([0-9a-fA-F]{1,4})|U([0-9a-fA-F]{1,8})|([\s\S]))/g, (whole, octal, hex, short, long, plain) => {
		if (octal) return String.fromCharCode(Number.parseInt(octal, 8) & 255);
		if (hex) return String.fromCharCode(Number.parseInt(hex, 16));
		if (short || long) {
			const code = Number.parseInt(short || long, 16);
			return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
		}
		return ANSI_C_ESCAPES[plain] ?? whole;
	});
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
	// Inside `$'...'` (ANSI-C quoting) a backslash escapes the next character: `\'` does not end the word.
	let ansiC = false;
	for (let i = 0; i < source.length; i += 1) {
		const ch = source[i];
		if (quote) {
			current += ch;
			if (dialect === "posix" && (quote === "\"" || ansiC) && ch === "\\" && i + 1 < source.length) {
				current += source[++i];
				continue;
			}
			if (ch === quote) {
				quote = null;
				ansiC = false;
			}
			continue;
		}
		if (dialect === "posix" && ch === "$" && source[i + 1] === "'") {
			quote = "'";
			ansiC = true;
			current += "$'";
			i += 1;
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
		// `>|` overrides noclobber: the `|` belongs to the redirect (what follows is the file), it is not a pipe.
		const redirectPipe = ch === "|" && prev === ">";
		const separator =
			!redirectAmpersand &&
			!redirectPipe &&
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
	// The raw text of a `$'...'` word so far: it is decoded whole when the closing quote arrives.
	let ansiC = null;
	for (let i = 0; i < segment.length; i += 1) {
		const ch = segment[i];
		if (ansiC !== null) {
			if (ch === "'") {
				current += decodeAnsiC(ansiC);
				ansiC = null;
			} else if (ch === "\\" && i + 1 < segment.length) {
				ansiC += ch + segment[++i];
			} else {
				ansiC += ch;
			}
			continue;
		}
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
		if (dialect === "posix" && ch === "$" && (segment[i + 1] === "'" || segment[i + 1] === "\"")) {
			// `$'...'` (ANSI-C) and `$"..."` (locale) are quotes: the `$` is not part of the word.
			inToken = true;
			if (segment[++i] === "'") ansiC = "";
			else quote = "\"";
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
	if (ansiC !== null) current += decodeAnsiC(ansiC); // an unterminated `$'` is still read
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

/**
 * Inner command strings run by sh/bash -c, cmd /c, pwsh/powershell -Command|-EncodedCommand, eval, each with the shell that
 * runs it (`posix`, `powershell`, or null for cmd), which decides what a comment is in it (see shell-comments.mjs).
 */
function unwrapPayloads(tokens) {
	const payloads = [];
	for (let i = 0; i < tokens.length; i += 1) {
		const program = programName(tokens[i]);
		if (POSIX_SHELLS.has(program)) {
			payloads.push({ text: shellCommandString(tokens, i + 1), shell: "posix" });
		} else if (program === "cmd") {
			const flag = tokens.findIndex((token, index) => index > i && /^\/[ck]$/i.test(token));
			if (flag > i) payloads.push({ text: tokens.slice(flag + 1).join(" "), shell: null });
		} else if (program === "powershell" || program === "pwsh") {
			for (let j = i + 1; j < tokens.length; j += 1) {
				const option = tokens[j].toLowerCase();
				if (option.length >= 2 && "-command".startsWith(option)) {
					payloads.push({ text: tokens.slice(j + 1).join(" "), shell: "powershell" });
					break;
				}
				if ((option === "-e" || option === "-ec" || (option.length >= 3 && "-encodedcommand".startsWith(option))) && j + 1 < tokens.length) {
					payloads.push({ text: decodePowerShellBase64(tokens[j + 1]), shell: "powershell" });
					break;
				}
			}
		} else if (program === "eval") {
			payloads.push({ text: tokens.slice(i + 1).join(" "), shell: "posix" });
		}
	}
	return payloads.filter((payload) => payload.text && payload.text.trim());
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
 * @param {{ limits?: typeof COMMAND_ANALYSIS_LIMITS, commandPrograms?: Set<string>, comments?: "posix"|"powershell"|null }} [options]
 *   `limits` lets tests hit each limit with small input. `commandPrograms` are the programs rules target (see
 *   commandProgramNames): a quoted word that starts with one is analyzed as a command line. Default: the built-in rules'
 *   programs. `comments` is the shell that runs the command, when it is known, and its comments are left out of the
 *   analysis (see shell-comments.mjs); null reads everything. The commands of a known shell inside it (`bash -c '...'`,
 *   `pwsh -Command ...`, `eval`) are read that way whatever `comments` is.
 * @returns {{
 *   segments: Array<{ tokens: string[], rawTokens: string[], text: string, dialect: "posix"|"windows" }>,
 *   sequence: Array<{ tokens: string[], rawTokens: string[], text: string, dialect: "posix"|"windows" }>,
 *   limitExceeded: null | { limit: string, max: number, message: string },
 *   work: { commandChars: number, scannedChars: number, tokens: number, segmentTokens: number, nesting: number },
 * }}
 *   `sequence` holds the same segment objects once per occurrence, in reading order (a segment that appears
 *   twice is in `segments` once and in `sequence` twice), for readers that depend on position.
 *   `tokens` are lowercased with git global options removed; `rawTokens` keep case.
 *   When `limitExceeded` is set the analysis stopped early and `segments` is
 *   incomplete: callers must refuse the command instead of matching rules on it.
 */
export function analyzeCommand(command, { limits = COMMAND_ANALYSIS_LIMITS, commandPrograms = BUILTIN_COMMAND_PROGRAMS, comments = null } = {}) {
	const commandText = String(command ?? "");
	const segments = [];
	const sequence = [];
	const seen = new Map();
	const visited = new Set();
	const work = { commandChars: commandText.length, scannedChars: 0, tokens: 0, segmentTokens: 0, nesting: 0 };
	let limitExceeded = null;
	const exceed = (limit, max, message) => {
		limitExceeded ??= { limit, max, message };
	};
	// Counts a scan of `chars` characters against the budget; false (and the limit set) when it is spent.
	const scan = (chars) => {
		work.scannedChars += chars;
		if (work.scannedChars <= limits.maxScanChars) return true;
		exceed("scan-chars", limits.maxScanChars, `checking it would scan more than ${limits.maxScanChars} characters of shell text once nested commands are unwrapped`);
		return false;
	};
	// `shell` is the shell that runs `source` when it is known: its comments are not commands.
	const visit = (source, depth, shell) => {
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
		const visitKey = `${depth}\u0000${shell ?? ""}\u0000${source}`;
		if (visited.has(visitKey)) return;
		visited.add(visitKey);
		work.nesting = Math.max(work.nesting, depth);
		if (shell) {
			if (!scan(source.length)) return; // one scan to read the comments
			const maxSyntaxNesting = limits.maxSyntaxNesting ?? MAX_SYNTAX_DEPTH;
			const stripped = stripComments(source, shell, maxSyntaxNesting);
			if (stripped === null) {
				exceed("syntax-nesting", maxSyntaxNesting, `its quotes and substitutions are nested more than ${maxSyntaxNesting} levels deep`);
				return;
			}
			source = stripped;
			if (!source.trim()) return;
		}
		if (!scan(source.length * 2)) return; // one scan per dialect
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
				// Keyed on the words as written: on a case-sensitive file system `rm .HELI-HARNESS/x` and
				// `rm .heli-harness/x` name different files, and the write-target check reads both.
				const key = `${dialect}\u0000${rawTokens.join("\u0000")}`;
				let segment = seen.get(key);
				if (!segment) {
					segment = { tokens, rawTokens, text, dialect };
					seen.set(key, segment);
					segments.push(segment);
				}
				// A rule reads a segment once, but what a segment does to a path depends on where it stands
				// (`cd a; rm x; cd b; rm x`), so every occurrence is kept, in order, for the write-target check.
				sequence.push(segment);
				// Wrapper payloads and quoted command lines are visited like the command itself, so they
				// count against the same word, character and nesting limits.
				// A quoted command line is handed to a program whose shell is not known: its text is read whole,
				// unless a shell that is known (`bash -c 'npm test # note'`) runs that very text and reads it its way.
				const payloads = new Map();
				for (const payload of [...unwrapPayloads(rawTokens), ...quotedCommandWords(rawTokens, commandPrograms).map((text) => ({ text, shell: null }))]) {
					payloads.set(`${payload.shell ?? ""}\u0000${payload.text}`, payload);
				}
				for (const payload of payloads.values()) {
					if (payload.shell === null && (payloads.has(`posix\u0000${payload.text}`) || payloads.has(`powershell\u0000${payload.text}`))) continue;
					visit(payload.text, depth + 1, payload.shell);
					if (limitExceeded) return;
				}
			}
		}
	};
	visit(commandText, 0, comments);
	return { segments, sequence, limitExceeded, work };
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

const YOLO_TASK_MODES = new Set(["yolo", "unguarded", "dangerous"]);

/** Argument lists that follow each Heli CLI entry point in a segment. */
function heliCliInvocations(tokens) {
	const invocations = [];
	tokens.forEach((token, index) => {
		const program = programName(token);
		const isEntry = program === "heli" || program === "heli.mjs" || program === "heli-harness" ||
			token.startsWith("heli-harness@") || /(^|[/:])heli-harness(@|#|$)/.test(token);
		if (!isEntry) return;
		const args = tokens.slice(index + 1).filter((arg) => arg !== "--json" && arg !== "--output-json");
		if (args[0] === "--") args.shift();
		invocations.push(args);
	});
	return invocations;
}

/** `--mode yolo` or `--mode=yolo`, anywhere in the arguments (the last `--mode` wins in the CLI, so every one counts). */
function yoloTaskMode(args) {
	return args.some((arg, index) =>
		(arg === "--mode" && YOLO_TASK_MODES.has(args[index + 1])) ||
		(arg.startsWith("--mode=") && YOLO_TASK_MODES.has(arg.slice("--mode=".length))),
	);
}

/**
 * The flag that lets `heli pull|sync|init` apply changes to Heli's own governance files that a sync
 * server sent (lib/cli/cloud.mjs). Accepting them is a human decision, like a grant, so ANY Heli
 * invocation carrying it is a privilege command, whatever its subcommand (the `=value` spelling too:
 * a hard deny must not depend on how far the CLI's parser goes).
 */
const ACCEPT_POLICY_FLAG = "--accept-policy-changes";

function carriesAcceptPolicyFlag(args) {
	return args.some((arg) => arg === ACCEPT_POLICY_FLAG || arg.startsWith(`${ACCEPT_POLICY_FLAG}=`));
}

/** Heli subcommands that grant authority, bypass guards or remove Heli. */
function privilegedHeliCommand(args) {
	const [command, sub] = args;
	const rest = args.slice(2);
	if (command === "grant" && sub === "issue") return "heli grant issue";
	if (command === "yolo" && (sub === "on" || sub === "enable")) return "heli yolo on";
	if (command === "task" && sub === "takeover") return "heli task takeover";
	if (command === "task" && sub === "release" && (rest.includes("--force") || rest.includes("--confirm"))) return "heli task release --force";
	if (command === "task" && sub === "create" && (rest.includes("--yolo") || yoloTaskMode(rest))) return "heli task create --yolo";
	if (command === "session" && (sub === "start" || sub === "attach") && rest.includes("--yolo")) return `heli session ${sub} --yolo`;
	if (command === "session" && sub === "transfer-write") return "heli session transfer-write";
	if (command === "host" && (sub === "remove" || sub === "uninstall")) return `heli host ${sub}`;
	if (command === "uninstall") return "heli uninstall";
	if (carriesAcceptPolicyFlag(args)) return `heli ${command.startsWith("-") ? "" : `${command} `}${ACCEPT_POLICY_FLAG}`;
	return null;
}

function heliPrivilegeCommand(tokens) {
	for (const args of heliCliInvocations(tokens)) {
		const found = privilegedHeliCommand(args);
		if (found) return found;
	}
	return false;
}

/** `<host> plugin uninstall|remove|disable heli-harness...`, `pi|axga remove heli-harness`. */
function hostIntegrationRemoval(tokens) {
	for (const index of indexesOfProgram(tokens, ["claude", "codex", "grok", "cursor", "opencode", "kimi"])) {
		const args = tokens.slice(index + 1);
		if (args.includes("plugin") && args.some((arg) => ["uninstall", "remove", "rm", "disable"].includes(arg)) &&
			args.some((arg) => arg.startsWith("heli-harness"))) {
			return `${programName(tokens[index])} plugin removal of heli-harness`;
		}
	}
	for (const index of indexesOfProgram(tokens, ["pi", "axga"])) {
		const args = tokens.slice(index + 1);
		if ((args[0] === "remove" || args[0] === "uninstall") && args.some((arg) => arg.includes("heli-harness"))) {
			return `${programName(tokens[index])} ${args[0]} heli-harness`;
		}
	}
	return false;
}

const HUMAN_ONLY_REASON =
	"approvals, YOLO, takeovers, write transfers and removing Heli must be done by a human in their own terminal, never by the agent Heli governs; ask the user to run it themselves";

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
	// `programs` lists every way to start the Heli CLI (`heli`, `heli-harness`, `node .../heli.mjs`, the package runners)
	// and the host CLIs, so `ssh host 'heli grant issue'` and `su -c 'claude plugin uninstall ...'` are read too.
	Object.freeze({ id: "heli-privileged-command", tier: "T6", programs: ["heli", "heli.mjs", "heli-harness", "node", "npx", "npm", "pnpm", "pnpx", "yarn", "bun", "bunx", "deno"], kind: "agent-run Heli privilege command", summary: "heli grant issue", reason: HUMAN_ONLY_REASON, test: heliPrivilegeCommand }),
	Object.freeze({ id: "heli-host-integration-removal", tier: "T6", programs: ["claude", "codex", "grok", "cursor", "opencode", "kimi", "pi", "axga"], kind: "removal of the Heli host integration", summary: "host plugin removal", reason: HUMAN_ONLY_REASON, test: hostIntegrationRemoval }),
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

const WRITE_PROGRAMS = new Set([
	"tee", "touch", "rm", "mv", "cp", "truncate", "mkdir", "rmdir", "ln", "install", "unlink", "shred", "chmod", "chown",
	"set-content", "sc", "add-content", "ac", "out-file", "new-item", "ni", "remove-item", "ri", "del", "erase", "rd",
	"move-item", "mi", "move", "copy-item", "cpi", "copy", "rename-item", "rni", "ren", "clear-content", "clc",
	// Links (a hard link is a second name for the same file), tree copies, PowerShell's tee and the rename spellings.
	"mklink", "md", "xcopy", "robocopy", "tee-object", "rename",
]);
// These name the new file relative to the old one's directory (`ren a\b\plan.md yolo.json` makes a\b\yolo.json).
const RENAME_PROGRAMS = new Set(["rename-item", "rni", "ren", "rename"]);
const EDITOR_PROGRAMS = new Set(["sed", "perl"]);
const IN_PLACE_FLAG = /^(?:-[a-z]*i|--in-place)/i;
const CD_PROGRAMS = new Set(["cd", "pushd", "chdir", "set-location", "sl", "push-location"]);
// Words that can stand before a `cd` without changing what it does: shell keywords and the wrappers of a builtin.
const CD_PREFIXES = new Set(["builtin", "command", "time", "!", "{", "then", "do", "else", "elif", "if", "while", "until"]);
// Groups: (1) the `&` of `>&word`, (2) the target. The operator is `>`, `>>`, `>|` (overrides noclobber) or `<>`
// (opens for reading and writing and creates the file: `exec 3<>file`, then `>&3`). The lead may be `=`: `x=>file`
// is an empty assignment followed by a redirect. The file-descriptor prefix has at most three digits: `\d+`
// would be super-linear on a long run of digits. The target is one shell word: quoted parts and plain characters
// in any mix (`yol''o.json`, `"a b"c`); nothing follows the group, so it never backtracks.
const REDIRECT_RE = /(?:^|[^<>&])(?:\d{1,3}|&|\*)?(?:>>|>\||<>|>)(&?)\s*((?:"[^"]*"|'[^']*'|[^\s;&|<>])+)/g;
const NULL_SINKS = /^(\/dev\/(null|stdout|stderr)|nul|\$null)$/i;
// Programs that write the file an option names, not a redirect: the one-letter options that take a path (a character class,
// searched natively so a long cluster of letters costs nothing) and the long option names. curl also writes a header dump
// (-D), a cookie jar (-c) and, with `--output-dir`, the folder `-O` saves into; wget also saves into a folder (-P) and
// writes a log (-o, -a).
const OUTPUT_OPTIONS = new Map([
	["sort", { short: /[o]/, long: ["output"] }],
	["curl", { short: /[oDc]/, long: ["output", "output-dir", "dump-header", "cookie-jar"] }],
	["wget", { short: /[OPoa]/, long: ["output-document", "directory-prefix", "output-file", "append-output"] }],
]);
// PowerShell parameters that name a file or folder to write: the full name and how many letters tell it from its neighbors.
const POWERSHELL_OUTPUTS = new Map([
	["invoke-webrequest", { name: "outfile", least: 4 }],
	["iwr", { name: "outfile", least: 4 }],
	["invoke-restmethod", { name: "outfile", least: 4 }],
	["irm", { name: "outfile", least: 4 }],
	["expand-archive", { name: "destinationpath", least: 4 }],
]);
// rsync options that take the next word as their value, so it is not mistaken for the destination.
const RSYNC_VALUE_OPTIONS = new Set([
	"-e", "-T", "-B", "-M", "-f", "--rsh", "--exclude", "--include", "--exclude-from", "--include-from", "--filter", "--files-from",
	"--rsync-path", "--bwlimit", "--port", "--partial-dir", "--backup-dir", "--suffix", "--log-file", "--link-dest", "--compare-dest",
	"--copy-dest", "--temp-dir", "--max-size", "--min-size", "--timeout", "--contimeout", "--modify-window", "--chmod", "--usermap",
	"--groupmap", "--chown", "--out-format", "--block-size", "--compress-level", "--skip-compress", "--address", "--sockopts",
	"--password-file", "--iconv", "--protocol", "--checksum-choice", "--max-delete", "--stop-after", "--stop-at",
]);

/**
 * The file a redirect writes, or null for a null sink or a file-descriptor copy (`2>&1`, `>&2`, `>&-`). The word is read
 * as the shell reads it: quotes and backslashes removed, `$'...'` and `$"..."` decoded as bash does (the Windows reading
 * takes the `$` off, as it does a variable's name). Nothing is expanded.
 */
function redirectTarget(copy, word, dialect) {
	const target = tokenize(dialect === "posix" ? word : word.replace(/\$(?=['"])/g, ""), dialect)[0] ?? "";
	if (copy && /^(?:\d+|-)$/.test(target)) return null;
	return target && !NULL_SINKS.test(target) ? target : null;
}

function isOptionWord(word) {
	return word.startsWith("-") || /^\/[a-z?]+$/i.test(word);
}

/** Where the command word of a segment is: past keywords (`then`, `{`, `!`), `builtin`, `command` and `time` with their options, and `VAR=value` words. */
function commandWordAt(tokens) {
	let index = 0;
	let options = false;
	while (index < tokens.length) {
		const token = tokens[index];
		if (CD_PREFIXES.has(token.toLowerCase())) options = true;
		else if (!ASSIGNMENT_WORD.test(token) && !(options && token.startsWith("-"))) break;
		index += 1;
	}
	return index;
}

// A PowerShell assignment whose value is a command: `$x=md d`, `$x+=ni a` (what follows the `=` in the same word is the command).
const POWERSHELL_ASSIGNMENT = /^\$[\w:.]+(?:[+\-*/%]|\?\?)?=([\s\S]*)$/;
const POWERSHELL_ASSIGNMENT_OPERATORS = new Set(["=", "+=", "-=", "*=", "/=", "%=", "??="]);

/**
 * The words of a segment that stand where a command goes: the first one, past keywords and assignments (`then`, `!`, `VAR=x`,
 * `$x =`, `$x=`), and the one after each `{` (a script block or a function body: `ForEach-Object { del $_ }`, `{del a}`).
 * A name that is only an argument (`Get-Help Remove-Item`) is not one. The other places a command can start (after `;`, `|`,
 * `&`, `&&`, `||`, `(`, a newline) are where the analysis already cuts a command into segments.
 */
function commandWords(tokens) {
	const words = [];
	let expecting = true;
	let options = false;
	for (let index = 0; index < tokens.length; index += 1) {
		let word = tokens[index];
		if (word[0] === "{" && !/\s/.test(word)) {
			expecting = true;
			options = false;
			word = word.replace(/^\{+/, "");
			if (!word) continue;
		}
		if (!expecting) continue;
		if (CD_PREFIXES.has(word.toLowerCase())) {
			options = true;
			continue;
		}
		if (ASSIGNMENT_WORD.test(word) || (options && word.startsWith("-"))) continue;
		const assigned = POWERSHELL_ASSIGNMENT.exec(word);
		if (assigned) {
			word = assigned[1];
			if (!word) continue;
		} else if (/^\$[\w:.]+$/.test(word) && POWERSHELL_ASSIGNMENT_OPERATORS.has(tokens[index + 1])) {
			index += 1;
			continue;
		}
		words.push(word);
		expecting = false;
	}
	return words;
}

/** The directory a `cd`-like command at `at` changes to: its first argument that is not an option, or else the value an option carries (`Set-Location -Path:d`); bare POSIX `cd` goes home. */
function cdArgument(tokens, dialect, at) {
	let index = at + 1;
	let attached = null;
	for (; index < tokens.length; index += 1) {
		if (tokens[index] === "--") {
			index += 1;
			break;
		}
		if (!tokens[index].startsWith("-") && !(dialect === "windows" && /^\/[a-z]$/i.test(tokens[index]))) break;
		attached ??= attachedParameterValue(tokens[index]);
	}
	return tokens[index] || attached || (dialect === "posix" ? "~" : null);
}

/** `name` next to `existing` (in the same directory), or null when `name` is itself a path or `existing` has none. */
function siblingPath(existing, name) {
	const cut = Math.max(existing.lastIndexOf("/"), existing.lastIndexOf("\\"));
	return cut >= 0 && !/[\\/]/.test(name) ? `${existing.slice(0, cut + 1)}${name}` : null;
}

/**
 * The folder a GNU cp, mv, install or ln is told to fill, when the option carries it in the same word:
 * `--target-directory=d`, `-td`, `-atd`. (`-t d` and `--target-directory d` leave the folder as the next word, which is read as a target.)
 */
function attachedFolder(token, dialect) {
	if (token.startsWith("--")) return token.startsWith("--target-directory=") ? token.slice("--target-directory=".length) : null;
	return dialect === "posix" ? (/^-[a-z]*?t(.+)$/.exec(token)?.[1] ?? null) : null;
}

/**
 * The value a PowerShell parameter carries in its own word: `-Path:a`, `-Destination:"a b"` (the quotes are gone by now), or
 * any unambiguous prefix of the name. null for `-Path:` alone and for a switch's value (`-Force:$false`), which is not a name.
 */
function attachedParameterValue(token) {
	const colon = token.indexOf(":");
	if (colon < 2 || colon === token.length - 1 || !/^-[A-Za-z]+$/.test(token.slice(0, colon))) return null;
	const value = token.slice(colon + 1);
	return /^\$(?:true|false|null)$/i.test(value) ? null : value;
}

/** The values of the options that take a path, in the spellings getopt reads: `-o v`, `-ov`, `-sSo v` (a cluster that ends in it), `--long v`, `--long=v`. */
function optionValues(tokens, from, { short, long }) {
	const values = [];
	for (let index = from; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token === "--") break;
		if (token.startsWith("--")) {
			const equals = token.indexOf("=");
			if (!long.includes(token.slice(2, equals < 0 ? token.length : equals))) continue;
			if (equals >= 0) values.push(token.slice(equals + 1));
			else if (index + 1 < tokens.length) values.push(tokens[++index]);
		} else if (token.length > 1 && token[0] === "-") {
			// The first letter of the cluster that takes a value takes the rest of the word, or else the next word.
			const found = token.slice(1).search(short);
			if (found < 0) continue;
			const attached = token.slice(found + 2);
			if (attached) values.push(attached);
			else if (index + 1 < tokens.length) values.push(tokens[++index]);
		}
	}
	return values;
}

/** The values of one PowerShell parameter: `-OutFile v`, `-outfile:v`, or any unambiguous prefix of the name. */
function powershellValues(tokens, from, { name, least }) {
	const values = [];
	for (let index = from; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token.length < 2 || token[0] !== "-") continue;
		const colon = token.indexOf(":");
		const parameter = token.slice(1, colon < 0 ? token.length : colon).toLowerCase();
		if (parameter.length < least || !name.startsWith(parameter)) continue;
		if (colon >= 0) values.push(token.slice(colon + 1));
		else if (index + 1 < tokens.length) values.push(tokens[++index]);
	}
	return values;
}

/** What `tar` writes: the folder it extracts into (the current one unless `-C` says otherwise), or the archive it creates. */
function tarTargets(tokens, from) {
	let extracts = false;
	let creates = false;
	const archives = [];
	const directories = [];
	for (let index = from; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token === "--") break;
		if (token.startsWith("--")) {
			const equals = token.indexOf("=");
			const name = token.slice(2, equals < 0 ? token.length : equals);
			if (name === "extract" || name === "get") extracts = true;
			else if (name === "create" || name === "append" || name === "update") creates = true;
			else if (name === "file" || name === "directory") {
				const value = equals >= 0 ? token.slice(equals + 1) : tokens[index + 1];
				if (equals < 0) index += 1;
				if (value !== undefined) (name === "file" ? archives : directories).push(value);
			}
		} else if ((token.length > 1 && token[0] === "-") || (index === from && /^[A-Za-z]+$/.test(token))) {
			// A cluster of letters, with or without its dash (`-xzf`, `czf`): `f` and `C` take the rest of the word or the next word.
			const letters = token[0] === "-" ? token.slice(1) : token;
			for (let at = 0; at < letters.length; at += 1) {
				const letter = letters[at];
				if (letter === "x") extracts = true;
				else if (letter === "c" || letter === "r" || letter === "u") creates = true;
				else if (letter === "f" || letter === "C") {
					const attached = letters.slice(at + 1);
					const value = attached || tokens[index + 1];
					if (!attached) index += 1;
					if (value !== undefined) (letter === "f" ? archives : directories).push(value);
					break;
				}
			}
		}
	}
	return [...(extracts ? (directories.length ? directories : ["."]) : []), ...(creates ? archives : [])];
}

/** What `unzip` writes: the folder after `-d`, or the current one. Listing, testing and printing (`-l -t -v -p -z -Z`) write nothing. */
function unzipTargets(tokens, from) {
	const directories = [];
	let readsOnly = false;
	for (let index = from; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token === "--") break;
		if (token === "-d" || (token.length > 2 && /^-[A-Za-z]*d$/.test(token))) {
			if (index + 1 < tokens.length) directories.push(tokens[++index]);
		} else if (/^-d./.test(token)) {
			directories.push(token.slice(2));
		} else if (/^-[A-Za-z]+$/.test(token) && /[ltvpzZ]/.test(token)) {
			readsOnly = true;
		}
	}
	return directories.length ? directories : readsOnly ? [] : ["."];
}

/** The last word of an rsync command that is not an option (or an option's value): the destination, when there is a source before it. */
function rsyncDestination(tokens, from) {
	const words = [];
	for (let index = from; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token === "--") {
			words.push(...tokens.slice(index + 1));
			break;
		}
		if (token.startsWith("-")) {
			if (RSYNC_VALUE_OPTIONS.has(token) || /^-[A-Za-z]+e$/.test(token)) index += 1;
			continue;
		}
		words.push(token);
	}
	return words.length >= 2 ? words[words.length - 1] : null;
}

/**
 * The files and folders named by writers whose output path is an option or an argument in a fixed place: `sort -o`,
 * `curl -o`, `wget -O`, PowerShell `-OutFile`, `tar` (extract folder, created archive), `unzip`, `rsync`. Every appearance of
 * a program's name is read as a command (a wrapper's option can take the name as its value: `env -u tar tar xzf a`), each
 * to the end of its segment, which is at most `maxSegmentTokens` words. `curl -O` and `wget` without `-O` take the file
 * name from the URL, and `patch` from diff headers; those, and any interpreter, are out of reach.
 */
function explicitOutputs(tokens) {
	const outputs = new Set();
	for (let index = 0; index < tokens.length; index += 1) {
		const program = programName(tokens[index]);
		const from = index + 1;
		let found;
		if (OUTPUT_OPTIONS.has(program)) found = optionValues(tokens, from, OUTPUT_OPTIONS.get(program));
		else if (POWERSHELL_OUTPUTS.has(program)) found = powershellValues(tokens, from, POWERSHELL_OUTPUTS.get(program));
		else if (program === "tar") found = tarTargets(tokens, from);
		else if (program === "unzip") found = unzipTargets(tokens, from);
		else if (program === "rsync") found = [rsyncDestination(tokens, from)];
		else continue;
		for (const output of found) if (output && output !== "-" && !NULL_SINKS.test(output)) outputs.add(output);
	}
	return [...outputs];
}

const NO_DIRECTORIES = Object.freeze([]);

/** The `cd`s before a write, as a linked list: each `cd` adds one node and every later target shares the rest. */
function cdNode(parent, dir, id) {
	return { id, dir, parent, depth: parent ? parent.depth + 1 : 1, dirs: null };
}

/** A chain as the array `cdPath` promises, built once per node and only when somebody reads it. */
function cdDirs(node) {
	if (!node) return NO_DIRECTORIES;
	if (!node.dirs) {
		const dirs = new Array(node.depth);
		for (let cursor = node, index = node.depth - 1; cursor; cursor = cursor.parent, index -= 1) dirs[index] = cursor.dir;
		node.dirs = Object.freeze(dirs);
	}
	return node.dirs;
}

/**
 * One write target. `cdPath` is the array the interface promises (built on first read, since a copy per `cd`
 * would cost O(chain) each); `cdChain` is the same chain as a linked list, so a reader resolves it one `cd` at
 * a time and a long chain costs a target no more than a short one. It is not enumerable.
 */
function writeTarget(path, chain) {
	const target = { path };
	Object.defineProperty(target, "cdPath", { enumerable: true, get: () => cdDirs(chain) });
	Object.defineProperty(target, "cdChain", { value: chain });
	return target;
}

/**
 * Best-effort list of paths a shell command writes, moves or deletes:
 * redirection targets, arguments of file-mutating programs (POSIX and
 * PowerShell/cmd), `dd of=`, and `sed -i`/`perl -i` files. Each target carries
 * the `cd` arguments seen earlier in the same dialect (`cdPath`) so callers can resolve it
 * both against the original cwd and against the changed directory. Every occurrence of a
 * segment is read in order (`analysis.sequence`), because what a relative path names depends
 * on the `cd`s before it. Targets are de-duplicated per `cd` chain.
 * Every `cd` is read as if it succeeded, in order (also behind `then`, `{`, `!`, `builtin`, `time`
 * and `VAR=x`); the directory the command started in is always checked too. A `cd` that fails,
 * `cd a || cd b`, `cd -` and a `cd` inside a subshell are beyond that reading. Words are read after
 * quote removal (`yol''o.json`, `yolo\.json`, `$'x'`) but never expanded: wildcards, `$(...)`,
 * variables set in the command and ANSI-C escapes (`$'\x79olo.json'`) are out of reach.
 * @returns {Array<{ path: string, cdPath: string[] }>} plus a non-enumerable `cdChain` (see writeTarget)
 */
export function shellWriteTargets(analysis) {
	const targets = [];
	const seen = new Set();
	const chains = { posix: null, windows: null };
	let nextChainId = 1;
	const add = (path, dialect) => {
		const chain = chains[dialect];
		const key = `${dialect}\u0000${chain ? chain.id : 0}\u0000${path}`;
		if (seen.has(key)) return;
		seen.add(key);
		targets.push(writeTarget(path, chain));
	};
	for (const segment of analysis.sequence ?? analysis.segments) {
		const { dialect } = segment;
		for (const match of segment.text.matchAll(REDIRECT_RE)) {
			const target = redirectTarget(match[1], match[2], dialect);
			if (target) add(target, dialect);
		}
		const tokens = segment.rawTokens;
		const commandAt = commandWordAt(tokens);
		if (CD_PROGRAMS.has(programName(tokens[commandAt]))) {
			const dir = cdArgument(tokens, dialect, commandAt);
			if (dir) {
				chains[dialect] = cdNode(chains[dialect], dir, nextChainId);
				nextChainId += 1;
			}
			continue;
		}
		for (const output of explicitOutputs(tokens)) add(output, dialect);
		// One pass: a token is a target when a file-mutating program came before it in the same command.
		const editorAt = tokens.findIndex((token) => EDITOR_PROGRAMS.has(programName(token)));
		const editsInPlace = editorAt >= 0 && tokens.some((token, index) => index > editorAt && IN_PLACE_FLAG.test(token));
		const renames = [];
		let writing = false;
		let afterDd = false;
		for (let index = 0; index < tokens.length; index += 1) {
			const token = tokens[index];
			const program = programName(token);
			if (writing) {
				// An option is no target, but the folder or file it carries in its own word is (`--target-directory=d`, `-Path:f`).
				for (const target of isOptionWord(token) ? [attachedFolder(token, dialect), attachedParameterValue(token)] : [token]) {
					if (target) add(target, dialect);
				}
			}
			if (afterDd && token.toLowerCase().startsWith("of=")) add(token.slice(3), dialect);
			if (editsInPlace && index > editorAt && !token.startsWith("-")) add(token, dialect);
			if (WRITE_PROGRAMS.has(program)) writing = true;
			if (program === "dd") afterDd = true;
			if (RENAME_PROGRAMS.has(program)) renames.push(index);
		}
		// Every appearance of a rename program counts: the first can be an option's value (`env -u ren ren a b`).
		for (const renameAt of renames) {
			const names = [];
			for (let index = renameAt + 1; index < tokens.length && names.length < 2; index += 1) {
				const name = isOptionWord(tokens[index]) ? attachedParameterValue(tokens[index]) : tokens[index];
				if (name) names.push(name);
			}
			if (names.length === 2) {
				for (const sibling of [siblingPath(names[0], names[1]), siblingPath(names[1], names[0])]) {
					if (sibling) add(sibling, dialect);
				}
			}
		}
	}
	return targets;
}

/**
 * Whether a command writes a file by the words it is made of, for the gates that need a yes or no and not the paths: a redirect
 * to a file (a null sink or a file-descriptor copy is not one), one of `programs` where a command goes (`Get-Help Remove-Item`
 * names a cmdlet, it does not run it; `{ del a }` and `$x = md d` do), or a writer's output option (`Invoke-WebRequest -OutFile`,
 * `Expand-Archive`, `curl -o`: the ones shellWriteTargets reads too). `programs` are lowercase program names, as programName gives them.
 * @param {ReturnType<typeof analyzeCommand>} analysis
 * @param {Set<string>} programs
 */
export function commandWritesFiles(analysis, programs) {
	for (const segment of analysis.segments) {
		for (const match of segment.text.matchAll(REDIRECT_RE)) {
			if (redirectTarget(match[1], match[2], segment.dialect)) return true;
		}
		if (explicitOutputs(segment.rawTokens).length) return true;
		if (commandWords(segment.rawTokens).some((word) => programs.has(programName(word)))) return true;
	}
	return false;
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
 * @param {{ comments?: "posix"|"powershell"|null }} [options] `comments`: the shell that runs the command, when it is known;
 *   its comments are not commands (see analyzeCommand).
 * @returns {{ status: string, rulesPath: string|null, analysis: object, gitPush: boolean, hardDenies: object[], approvals: object[], limitExceeded: null|{ limit: string, max: number, message: string, reason: string } }}
 *   `approvals` excludes T5 ids approved via HELI_ALLOW_COMMAND; T6 is never approvable.
 *   `limitExceeded` is set when the command is over the analysis budget: no rule was
 *   evaluated, and the caller must deny it with `limitExceeded.reason`.
 */
export function evaluateCommandRules(workspaceRoot, command, env = process.env, { comments = null } = {}) {
	const loaded = loadCommandRules(workspaceRoot);
	const analysis = analyzeCommand(command, { commandPrograms: commandProgramNames(loaded.projectRules), comments });
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
