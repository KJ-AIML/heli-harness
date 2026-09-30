/**
 * Reading the input of an MCP tool.
 *
 * The input is defined by the server, so Heli cannot know which fields name files. Every string
 * that looks like a path is a candidate for the protected-state check: a value under a path-like
 * key (a list inherits its key), and a whitespace-free value that holds a separator or starts
 * with `~`. A URL (`https://...`, `s3://...`) never names a local file and is skipped; a `file:`
 * URI is decoded. A candidate has no length limit: `x/../x/../...` padded past any limit names
 * the same file.
 *
 * A directory-like key (`cwd`, `root`, `dir`, ...) says where relative paths land, so each of
 * its values is combined with every relative path of the same input (`root` + `relative`), and
 * hook-core reads a command's relative targets against it too.
 *
 * What one input may cost is bounded (MCP_INPUT_LIMITS). Hosts treat a hook that times out as
 * an allow, so an input beyond a limit is refused, never read in part. The limits sit far above
 * any real call: a model writes a tool call token by token, and 128k output tokens are about
 * 0.5 MB, a few tens of thousands of values; the measurements behind them are in
 * scripts/smoke-mcp-input.mjs.
 */
import { fileURLToPath } from "node:url";

export const MCP_INPUT_LIMITS = Object.freeze({
	// Nesting of objects and lists.
	maxDepth: 128,
	// Values and containers visited (a scan costs about 0.3 us each).
	maxNodes: 250000,
	// Characters of all strings together (a scan of a string that is not path-like costs about 10 ms per MB).
	maxStringChars: 33554432,
	// Path-like values (classifying one costs 0.1 to 0.4 ms on Windows: 50,000 are seconds).
	maxPathValues: 50000,
	// Characters of path-like values (a path-like string is scanned and normalized: about 0.16 s per MB).
	maxPathChars: 8388608,
	// Directory-like values a command may be read against (each one is one more classification of its targets).
	maxDirectories: 16,
	// Directory-like values times relative paths (each pair is one more path).
	maxCombinations: 20000,
	// File-system lookups naming all the paths may take (see protected-paths.mjs `spend`): about 0.03-0.09 ms an existence
	// check and 0.3-0.4 ms a realpath on Windows, so a call cannot spend more than a few seconds.
	maxLookups: 100000,
});

// `path`, `dir` ... inside any key (`filePath`, `workingDirectory`).
const PATH_KEY_RE = /path|file|dir|dest|target|source|uri|location|cwd|root|folder/i;
// Short words that only count as a whole word (`to` is not `token`).
const PATH_KEY_WORDS = new Set(["output", "out", "to", "into", "from", "src", "dst"]);
const DIRECTORY_KEY_RE = /dir|cwd|root|folder/i;
// Where a call puts something: `destination`, `output_path`, `newName`, `to`.
const DESTINATION_WORDS = new Set(["destination", "dest", "dst", "target", "output", "out", "to", "into", "saveas"]);
const NEW_NAME_WORDS = new Set(["path", "name", "file", "dir", "directory", "folder"]);
// The text a call writes into the file (the keys of Edit, Write, NotebookEdit and their MCP cousins).
const CONTENT_KEYS = new Set(["content", "contents", "file_content", "file_contents", "new_string", "new_str", "new_text", "new_source", "new_content", "new_contents"]);
// Verbs of a tool name (the part after `mcp__server__`) that write, move, copy or delete.
const WRITE_VERBS = new Set([
	"write", "edit", "replace", "create", "update", "delete", "remove", "move", "rename", "copy", "append", "save", "put",
	"upload", "download", "insert", "patch", "apply", "touch", "mkdir", "truncate", "overwrite", "set", "push",
]);
// At least two letters, so `C://Users/x` is a drive path and not the scheme `C`.
const URL_SCHEME = /^[a-z][a-z0-9+.-]+:\/\//i;

function words(text) {
	return text.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function keyKind(key, cache) {
	let kind = cache.get(key);
	if (!kind) {
		const parts = words(key);
		kind = {
			path: PATH_KEY_RE.test(key) || parts.some((part) => PATH_KEY_WORDS.has(part)),
			directory: DIRECTORY_KEY_RE.test(key),
			destination: parts.some((part) => DESTINATION_WORDS.has(part)) || (parts.includes("new") && parts.some((part) => NEW_NAME_WORDS.has(part))),
			content: CONTENT_KEYS.has(parts.join("_")),
		};
		cache.set(key, kind);
	}
	return kind;
}

/** The text of `value` if it is a candidate path, else null (see the module comment). */
function pathCandidate(value, keyIsPath) {
	let text = value.trim();
	if (text === "") return null;
	if (/^file:/i.test(text)) {
		try {
			text = fileURLToPath(text);
		} catch {
			/* keep the raw text */
		}
	} else if (URL_SCHEME.test(text)) {
		return null;
	}
	const underPathKey = keyIsPath && !text.includes("\n");
	const looksLikePath = !/\s/.test(text) && (/[\\/]/.test(text) || text.startsWith("~"));
	return underPathKey || looksLikePath ? text : null;
}

/** A path that is read against a directory: not absolute, not `~`, not a variable. */
function isRelative(text) {
	return !/^(?:[a-z]:[\\/]|[\\/]|~|\$|%)/i.test(text);
}

/**
 * True when the tool's own name says it writes, moves, copies or deletes (`write_file`, `create_or_update_file`, `moveFile`).
 * Only the tool part of `mcp__server__tool` is read: a server may be called anything.
 */
export function mcpToolWrites(toolName) {
	const tool = String(toolName ?? "").split("__").slice(2).join("__");
	return words(tool).some((word) => WRITE_VERBS.has(word));
}

/**
 * Read an MCP tool input once, within `limits`.
 * @returns {{
 *   tooLarge: null | { limit: string, max: number, message: string },
 *   paths: Array<{ text: string, key: string, destination: boolean, combined?: boolean }>,
 *   directories: string[],
 *   hasContentKey: boolean,
 * }}
 *   `paths` are the candidate paths (then the directory-and-relative-path combinations); `destination` marks the ones under a
 *   destination-like key. `tooLarge` is set when a limit was passed: nothing else in the result is complete then.
 */
export function readMcpInput(toolInput, limits = MCP_INPUT_LIMITS) {
	const result = { tooLarge: null, paths: [], directories: [], hasContentKey: false };
	const refuse = (limit, what) => {
		result.tooLarge = { limit, max: limits[limit], message: `${what} is over the limit of ${limits[limit].toLocaleString("en-US")}` };
		return result;
	};
	const kinds = new Map();
	const directories = new Set();
	let nodes = 0;
	let stringChars = 0;
	let pathChars = 0;
	const stack = [[toolInput, "", 0]];
	while (stack.length) {
		const [value, key, depth] = stack.pop();
		nodes += 1;
		if (nodes > limits.maxNodes) return refuse("maxNodes", "the number of values in its input");
		if (typeof value === "string") {
			stringChars += value.length;
			if (stringChars > limits.maxStringChars) return refuse("maxStringChars", "the text in its input");
			const kind = keyKind(key, kinds);
			const text = pathCandidate(value, kind.path);
			if (text === null) continue;
			pathChars += text.length;
			if (pathChars > limits.maxPathChars) return refuse("maxPathChars", "the text of the path-like values in its input");
			result.paths.push({ text, key, destination: kind.destination });
			if (result.paths.length > limits.maxPathValues) return refuse("maxPathValues", "the number of path-like values in its input");
			if (kind.directory) directories.add(text);
		} else if (value && typeof value === "object") {
			if (depth >= limits.maxDepth) return refuse("maxDepth", "the nesting of its input");
			const isList = Array.isArray(value);
			const entries = Object.entries(value);
			for (let index = entries.length - 1; index >= 0; index -= 1) {
				const [childKey, child] = entries[index];
				if (!isList && keyKind(childKey, kinds).content) result.hasContentKey = true;
				stack.push([child, isList ? key : childKey, depth + 1]);
			}
		}
	}
	result.directories = [...directories];
	const relative = result.paths.filter((path) => isRelative(path.text));
	if (result.directories.length * relative.length > limits.maxCombinations) {
		return refuse("maxCombinations", "the number of directory and path pairs in its input");
	}
	for (const directory of result.directories) {
		for (const path of relative) {
			if (directory !== path.text) {
				result.paths.push({ text: `${directory.replace(/[\\/]+$/, "")}/${path.text}`, key: path.key, destination: path.destination, combined: true });
			}
		}
	}
	return result;
}
