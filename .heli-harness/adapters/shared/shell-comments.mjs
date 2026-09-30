/**
 * Comments in shell text, taken out before the text is read as commands.
 *
 * A command line is read for what it runs, and a comment is not run: `# never use rm -rf here`
 * or `npm test # then git push` are text the shell throws away. Reading them as commands made a
 * comment a hard deny that nothing could lift. Nothing is removed unless the shell that runs the
 * text is known (see `shell`), and only where THAT shell ignores it; anything that might be run
 * stays, because a comment mistaken for code is a false alarm and code mistaken for a comment
 * is a bypass.
 *
 * POSIX (bash, sh, zsh): a `#` that starts a word (at the start of the text or after a space, tab,
 * newline, `;`, `&`, `|`, or a `(` that itself starts a word) is a comment to the end of the line.
 * It is not one inside quotes, `$'...'`, `${...}`, `$(...)`, `$((...))`, backticks, `<(...)`,
 * `[[ ... ]]`, `(( ... ))`, a here-document's body, after a backslash, or in the middle of a word
 * (`a#b`, `$#`, `${#x}`). Those regions are read only to know where they end, and are kept as
 * they are.
 *
 * PowerShell: a `#` that starts a token (start of the text, or after whitespace, `;`, `(`, `{`, `|`
 * or `&`) is a comment to the end of the line, and `<# ... #>` at the start of a token is a block
 * comment. Not inside a string (either quote, the smart quotes PowerShell also takes for quotes),
 * a here-string, `${name}`, after a backtick, after `--%`, or in the middle of a word.
 *
 * Any other shell (cmd, an unknown MCP server, a host's own shell tool) has its text kept whole.
 */

const BLANK = /[ \t\n]/;

/** How deep quotes, substitutions and braces may nest in the text before it is refused (real commands stay under ten). */
export const MAX_SYNTAX_DEPTH = 64;

let level = 0;
let ceiling = MAX_SYNTAX_DEPTH;
const TOO_DEEP = new Error("shell text nested too deeply");

/** A scanner that calls others that call it (`$(` in a `"` in a `$(`) counts its depth: JavaScript runs out of stack near 10,000 levels. */
function bounded(scanner) {
	return (text, start) => {
		if (level >= ceiling) throw TOO_DEEP;
		level += 1;
		try {
			return scanner(text, start);
		} finally {
			level -= 1;
		}
	};
}

/**
 * The text without the comments its shell would throw away, or null when quotes and substitutions nest deeper than
 * `maxDepth` (it cannot be read safely, and a caller must refuse it rather than read it whole).
 * @param {string} text @param {"posix"|"powershell"|null|undefined} shell @param {number} [maxDepth]
 */
export function stripComments(text, shell, maxDepth = MAX_SYNTAX_DEPTH) {
	if (shell !== "posix" && shell !== "powershell") return text;
	// The common case costs one search: no `#` (or `<#`, which has one) means no comment.
	if (!text.includes("#")) return text;
	level = 0;
	ceiling = maxDepth;
	let removed;
	try {
		removed = shell === "posix" ? posixComments(text) : powershellComments(text);
	} catch (error) {
		if (error === TOO_DEEP) return null;
		throw error;
	}
	if (!removed.length) return text;
	let out = "";
	let last = 0;
	for (const [start, end, replacement] of removed) {
		out += text.slice(last, start) + replacement;
		last = end;
	}
	return out + text.slice(last);
}

// ---------------------------------------------------------------------------------------------------------- POSIX

function skipSingle(text, start) {
	const end = text.indexOf("'", start + 1);
	return end === -1 ? text.length : end + 1;
}

/** `$'...'`: backslash escapes work, so `\'` does not end it. */
function skipAnsiC(text, start) {
	let i = start + 1;
	while (i < text.length) {
		if (text[i] === "\\") i += 2;
		else if (text[i] === "'") return i + 1;
		else i += 1;
	}
	return text.length;
}

function skipBacktick(text, start) {
	let i = start + 1;
	while (i < text.length) {
		if (text[i] === "\\") i += 2;
		else if (text[i] === "`") return i + 1;
		else i += 1;
	}
	return text.length;
}

const skipDouble = bounded((text, start) => {
	let i = start + 1;
	while (i < text.length) {
		const ch = text[i];
		if (ch === "\\") i += 2;
		else if (ch === "\"") return i + 1;
		else if (ch === "$" && text[i + 1] === "(") i = skipParen(text, i + 1);
		else if (ch === "$" && text[i + 1] === "{") i = skipBrace(text, i + 1);
		else if (ch === "`") i = skipBacktick(text, i);
		else i += 1;
	}
	return text.length;
});

/** From a `(` to just past its `)`, quotes and nested parentheses included (`$(...)`, `$((...))`, `<(...)`, `((...))`). */
const skipParen = bounded((text, start) => {
	let depth = 0;
	let i = start;
	while (i < text.length) {
		const ch = text[i];
		if (ch === "(") {
			depth += 1;
			i += 1;
		} else if (ch === ")") {
			depth -= 1;
			i += 1;
			if (depth === 0) return i;
		} else if (ch === "'") i = skipSingle(text, i);
		else if (ch === "\"") i = skipDouble(text, i);
		else if (ch === "`") i = skipBacktick(text, i);
		else if (ch === "\\") i += 2;
		else if (ch === "$" && text[i + 1] === "{") i = skipBrace(text, i + 1);
		else i += 1;
	}
	return text.length;
});

/** From a `{` to just past its `}` (`${var#pattern}`, `${var:-default}`), nested and quoted braces included. */
const skipBrace = bounded((text, start) => {
	let depth = 0;
	let i = start;
	while (i < text.length) {
		const ch = text[i];
		if (ch === "{") {
			depth += 1;
			i += 1;
		} else if (ch === "}") {
			depth -= 1;
			i += 1;
			if (depth === 0) return i;
		} else if (ch === "'") i = skipSingle(text, i);
		else if (ch === "\"") i = skipDouble(text, i);
		else if (ch === "`") i = skipBacktick(text, i);
		else if (ch === "\\") i += 2;
		else if (ch === "$" && text[i + 1] === "(") i = skipParen(text, i + 1);
		else i += 1;
	}
	return text.length;
});

/** From `[[` to just past the `]]` that closes it (a word of its own), or to the end. */
const skipConditional = bounded((text, start) => {
	let i = start + 2;
	while (i < text.length) {
		const ch = text[i];
		if (ch === "]" && text[i + 1] === "]" && BLANK.test(text[i - 1]) && (i + 2 >= text.length || /[\s;&|)]/.test(text[i + 2]))) return i + 2;
		if (ch === "'") i = skipSingle(text, i);
		else if (ch === "\"") i = skipDouble(text, i);
		else if (ch === "`") i = skipBacktick(text, i);
		else if (ch === "\\") i += 2;
		else if (ch === "$" && text[i + 1] === "(") i = skipParen(text, i + 1);
		else if (ch === "$" && text[i + 1] === "{") i = skipBrace(text, i + 1);
		else i += 1;
	}
	return text.length;
});

/** What follows a `$`: `$(`, `${`, `$'`, `$"`, a special parameter (`$#`, `$?`), or a name. */
function skipDollar(text, start) {
	const next = text[start + 1];
	if (next === "(") return skipParen(text, start + 1);
	if (next === "{") return skipBrace(text, start + 1);
	if (next === "'") return skipAnsiC(text, start + 1);
	if (next === "\"") return skipDouble(text, start + 1);
	return next !== undefined && /[#?$!@*0-9-]/.test(next) ? start + 2 : start + 1;
}

/** The delimiter of a here-document whose `<<` ends just before `start`, or null when there is none. */
function heredocStart(text, start) {
	let i = start;
	let stripTabs = false;
	if (text[i] === "-") {
		stripTabs = true;
		i += 1;
	}
	while (text[i] === " " || text[i] === "\t") i += 1;
	let delimiter = "";
	let any = false;
	while (i < text.length) {
		const ch = text[i];
		if (ch === "'") {
			const end = text.indexOf("'", i + 1);
			if (end === -1) return null;
			delimiter += text.slice(i + 1, end);
			i = end + 1;
		} else if (ch === "\"") {
			let end = i + 1;
			let body = "";
			while (end < text.length && text[end] !== "\"") {
				if (text[end] === "\\" && end + 1 < text.length) end += 1;
				body += text[end];
				end += 1;
			}
			if (end >= text.length) return null;
			delimiter += body;
			i = end + 1;
		} else if (ch === "\\") {
			if (i + 1 >= text.length) return null;
			delimiter += text[i + 1];
			i += 2;
		} else if (/[\s;&|()<>]/.test(ch)) {
			break;
		} else {
			delimiter += ch;
			i += 1;
		}
		any = true;
	}
	return any && delimiter !== "" ? { delimiter, stripTabs, end: i } : null;
}

/** Past the bodies of the here-documents opened on the line that just ended (each ends at a line that is its delimiter). */
function skipHeredocBodies(text, start, heredocs) {
	let i = start;
	for (const { delimiter, stripTabs } of heredocs) {
		while (i < text.length) {
			const newline = text.indexOf("\n", i);
			const lineEnd = newline === -1 ? text.length : newline;
			let line = text.slice(i, lineEnd);
			if (stripTabs) line = line.replace(/^\t+/, "");
			i = newline === -1 ? text.length : newline + 1;
			if (line === delimiter || line === `${delimiter}\r`) break;
		}
	}
	heredocs.length = 0;
	return i;
}

function posixComments(text) {
	const removed = [];
	const heredocs = [];
	const length = text.length;
	let i = 0;
	let wordStart = true;
	while (i < length) {
		const ch = text[i];
		if (ch === "\n") {
			i += 1;
			if (heredocs.length) i = skipHeredocBodies(text, i, heredocs);
			wordStart = true;
		} else if (ch === "\\") {
			// A backslash before a newline joins the lines (the next character is judged by the one before the backslash).
			if (text[i + 1] === "\n") i += 2;
			else if (text[i + 1] === "\r" && text[i + 2] === "\n") i += 3;
			else {
				i += 2;
				wordStart = false;
			}
		} else if (ch === "'") {
			i = skipSingle(text, i);
			wordStart = false;
		} else if (ch === "\"") {
			i = skipDouble(text, i);
			wordStart = false;
		} else if (ch === "`") {
			i = skipBacktick(text, i);
			wordStart = false;
		} else if (ch === "$") {
			i = skipDollar(text, i);
			wordStart = false;
		} else if (ch === " " || ch === "\t" || ch === ";" || ch === "&" || ch === "|") {
			i += 1;
			wordStart = true;
		} else if (ch === "(") {
			// `((` (arithmetic, or two subshells) is read whole; a lone `(` at the start of a word opens a subshell, and what
			// follows it may be a comment. Anywhere else (`f()`, `a=(`, `@(`) it belongs to a word.
			if (wordStart && text[i + 1] === "(") {
				i = skipParen(text, i);
				wordStart = false;
			} else {
				i += 1;
			}
		} else if (ch === ")") {
			i += 1;
			wordStart = false;
		} else if (ch === "<" || ch === ">") {
			if (text[i + 1] === "(") {
				i = skipParen(text, i + 1);
			} else if (ch === "<" && text[i + 1] === "<" && text[i + 2] !== "<") {
				const heredoc = heredocStart(text, i + 2);
				if (heredoc) {
					heredocs.push(heredoc);
					i = heredoc.end;
				} else {
					i += 2;
				}
			} else if (ch === "<" && text[i + 1] === "<") {
				i += 3;
			} else {
				i += 1;
			}
			wordStart = false;
		} else if (ch === "#" && wordStart) {
			const newline = text.indexOf("\n", i);
			const end = newline === -1 ? length : newline;
			removed.push([i, end, ""]);
			i = end;
		} else if (ch === "[" && wordStart && text[i + 1] === "[" && BLANK.test(text[i + 2] ?? "")) {
			i = skipConditional(text, i);
			wordStart = false;
		} else {
			i += 1;
			wordStart = false;
		}
	}
	return removed;
}

// ---------------------------------------------------------------------------------------------------- PowerShell

const SINGLE_QUOTES = "'‘’‚‛";
const DOUBLE_QUOTES = "\"“”„";

function isSingleQuote(ch) {
	return ch !== undefined && SINGLE_QUOTES.includes(ch);
}

function isDoubleQuote(ch) {
	return ch !== undefined && DOUBLE_QUOTES.includes(ch);
}

/** A single-quoted string: a doubled quote is a quote inside it. */
function skipPsSingle(text, start) {
	let i = start + 1;
	while (i < text.length) {
		if (isSingleQuote(text[i])) {
			if (isSingleQuote(text[i + 1])) i += 2;
			else return i + 1;
		} else {
			i += 1;
		}
	}
	return text.length;
}

/** A double-quoted string: a backtick escapes, a doubled quote is a quote, `$(...)` runs code that may hold strings of its own. */
const skipPsDouble = bounded((text, start) => {
	let i = start + 1;
	while (i < text.length) {
		const ch = text[i];
		if (ch === "`") i += 2;
		else if (isDoubleQuote(ch)) {
			if (isDoubleQuote(text[i + 1])) i += 2;
			else return i + 1;
		} else if (ch === "$" && text[i + 1] === "(") i = skipPsParen(text, i + 1);
		else i += 1;
	}
	return text.length;
});

const skipPsParen = bounded((text, start) => {
	let depth = 0;
	let i = start;
	while (i < text.length) {
		const ch = text[i];
		if (ch === "(") {
			depth += 1;
			i += 1;
		} else if (ch === ")") {
			depth -= 1;
			i += 1;
			if (depth === 0) return i;
		} else if (ch === "`") i += 2;
		else if (isSingleQuote(ch)) i = skipPsSingle(text, i);
		else if (isDoubleQuote(ch)) i = skipPsDouble(text, i);
		else i += 1;
	}
	return text.length;
});

/** `@'` or `@"` at the end of a line, up to the line that starts with the same quote and `@`; null when it is not a here-string. */
function skipHereString(text, start) {
	const quote = text[start + 1];
	let i = start + 2;
	while (text[i] === " " || text[i] === "\t") i += 1;
	if (text[i] === "\r") i += 1;
	if (text[i] !== "\n") return null;
	const closer = isSingleQuote(quote) ? new RegExp(`\\n[${SINGLE_QUOTES}]@`, "g") : new RegExp(`\\n[${DOUBLE_QUOTES}]@`, "g");
	closer.lastIndex = i;
	const found = closer.exec(text);
	return found ? found.index + found[0].length : text.length;
}

function powershellComments(text) {
	const removed = [];
	const length = text.length;
	let i = 0;
	let tokenStart = true;
	let noBlockEnd = false;
	while (i < length) {
		const ch = text[i];
		if (ch === "`") {
			i += 2;
			tokenStart = false;
		} else if (isSingleQuote(ch)) {
			i = skipPsSingle(text, i);
			tokenStart = false;
		} else if (isDoubleQuote(ch)) {
			i = skipPsDouble(text, i);
			tokenStart = false;
		} else if (ch === "@" && (isSingleQuote(text[i + 1]) || isDoubleQuote(text[i + 1])) && skipHereString(text, i) !== null) {
			i = skipHereString(text, i);
			tokenStart = false;
		} else if (ch === "$" && text[i + 1] === "{") {
			// `${name}` is a variable whose name may hold a `#`.
			const end = text.indexOf("}", i + 2);
			i = end === -1 ? length : end + 1;
			tokenStart = false;
		} else if (ch === "<" && text[i + 1] === "#" && tokenStart) {
			// Once one search finds no `#>` there is none for the `<#` after it either: search once, not once per `<#`.
			const end = noBlockEnd ? -1 : text.indexOf("#>", i + 2);
			if (end === -1) {
				// Unterminated: PowerShell refuses the script, and nothing is dropped.
				noBlockEnd = true;
				i += 2;
				tokenStart = false;
			} else {
				removed.push([i, end + 2, " "]);
				i = end + 2;
				tokenStart = true;
			}
		} else if (ch === "#" && tokenStart) {
			const newline = text.indexOf("\n", i);
			const end = newline === -1 ? length : newline;
			removed.push([i, end, ""]);
			i = end;
		} else if (ch === "-" && tokenStart && text.startsWith("--%", i) && (i + 3 >= length || /\s/.test(text[i + 3]))) {
			// After --% the rest of the line goes to the program as it is.
			const newline = text.indexOf("\n", i);
			i = newline === -1 ? length : newline;
			tokenStart = false;
		} else {
			tokenStart = /\s/.test(ch) || ch === ";" || ch === "(" || ch === "{" || ch === "|" || ch === "&";
			i += 1;
		}
	}
	return removed;
}
