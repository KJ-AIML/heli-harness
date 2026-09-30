/**
 * Protected Heli state: which paths an agent may never write.
 *
 * Every path is normalized before it is classified: `~`, `$HOME`, `%USERPROFILE%`
 * and other leading environment variables are expanded, the path is resolved
 * against the caller's cwd, `..` is collapsed, the nearest existing ancestor is
 * realpath'd (so a symlink or junction cannot smuggle a write into Heli state),
 * and the result is lowercased on Windows. Windows-only spellings of the same
 * file are folded together too: NTFS alternate-data-stream suffixes
 * (`name:stream`, `name::$DATA`), trailing dots and spaces (which cmd and
 * PowerShell drop), device and NT prefixes (`\\?\`, `\\.\`, `\??\`), and Git Bash's
 * `/c/...` drive paths. A UNC or device path that cannot be mapped to a drive is
 * opaque: it counts as protected when it merely mentions a Heli location (we do
 * not try to prove where it points).
 *
 * Kinds:
 *   authority  — task.json/yolo.json/events.jsonl/diagnosis.json, sessions/,
 *                locks/, bindings/, state/yolo.json, state/diagnosis*, workspace/*.json,
 *                the operational root itself, the Heli config/data dirs, and
 *                Heli-installed host hook files. Never agent-writable.
 *   narrative  — current-task.md, plan.md, decisions.md, reports/**, runs/**
 *                (global state/ or a task dir). Writable by the task owner.
 *   claude-settings — .claude/settings*.json (content-checked by the caller).
 *   other      — everything else (normal ownership rules apply).
 *
 * This is a guardrail, not a sandbox: wildcards, `$(...)`, ANSI-C escapes (`$'\x79'`), shell
 * variables set inside the command, and interpreters (`python -c`) can still name a path this
 * module never sees spelled out (words are read after quote removal, never expanded). So can a
 * writer that takes its file name from elsewhere
 * (`curl -O` and `wget` from the URL, `patch` and `git apply` from diff headers,
 * `git checkout`), and a `cd` that does not do what the command says: every `cd` is
 * read as if it succeeded, in order, next to the directory the command started in,
 * so a `cd` that fails, `cd a || cd b`, `cd -` and a `cd` inside a subshell are not followed.
 * Settings are read for what a write puts in them, not for what a copy or a move brings.
 */
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, parse, resolve } from "node:path";
import { globalConfigDir, globalDataDir } from "./project-binding.mjs";
import { isWindows, pathsFor } from "./paths.mjs";

const TASK_AUTHORITY_FILES = new Set(["task.json", "yolo.json", "events.jsonl", "diagnosis.json"]);
const TASK_NARRATIVE_FILES = new Set(["current-task.md", "plan.md", "decisions.md"]);
const STATE_AUTHORITY_FILES = new Set(["state/yolo.json", "state/diagnosis.json", "state/diagnosis-events.jsonl"]);
const STATE_NARRATIVE_FILES = new Set(["state/current-task.md", "state/plan.md", "state/decisions.md"]);
const AUTHORITY_DIRS = new Set(["sessions", "locks", "bindings"]);
const HELI_LOCATION_MARKERS = [".heli-harness", "/.heli/", "/.heli-data/", "heli-harness.json", "heli-harness-bundle", "/plugins/local/heli-harness", ".claude/settings"];
// A path this long cannot exist on POSIX and is not worth a filesystem walk on Windows.
const MAX_REALPATH_CHARS = 4096;
// How much longer than the hook's own cwd a `cd` chain may make the working directory (see createChainResolver).
const MAX_CHAIN_GROWTH = 1024;

/** Where Heli installs host hooks (same rule as lib/cli/host.mjs userHome). */
function hostHome(env) {
	return env.HELI_HOST_HOME || homedir();
}

/** Case-insensitive on Windows, where environment variable names are. */
function envLookup(env) {
	if (!isWindows()) return (name) => env[name];
	const lowered = new Map(Object.entries(env).map(([key, value]) => [key.toLowerCase(), value]));
	return (name) => lowered.get(name.toLowerCase());
}

const LEADING_VARIABLE = /^(?:~|\$\{([A-Za-z_]\w*)\}|\$env:([A-Za-z_]\w*)|\$([A-Za-z_]\w*)|%([A-Za-z_]\w*)%)(?=$|[\\/])/i;

/**
 * What a shell expands a leading `~`, `$NAME`, `${NAME}`, `$env:NAME` or `%NAME%` to for this
 * process. Only a variable the process environment defines is expanded (home falls back to the
 * OS home directory, `$PWD` to the hook's cwd); anything else stays as written.
 */
function expandVariables(value, { cwd, lookup }) {
	const match = LEADING_VARIABLE.exec(value);
	if (!match) return value;
	const name = match[1] ?? match[2] ?? match[3] ?? match[4] ?? "HOME";
	const upper = name.toUpperCase();
	let expansion = upper === "PWD" ? cwd : lookup(name);
	if (!expansion && (upper === "HOME" || upper === "USERPROFILE")) expansion = lookup("HOME") || lookup("USERPROFILE") || homedir();
	return expansion ? `${expansion}${value.slice(match[0].length)}` : value;
}

const MSYS_DRIVE = /^[\\/](?:cygdrive[\\/])?([a-z])(?=[\\/]|$)/i;

/**
 * The spellings of one path to classify: the path as written (variables expanded) and, on
 * Windows, the reading Git Bash gives a `/c/Users/...` path (`C:/Users/...`). Node reads the
 * first one, a shell running under Git Bash the second, so a protected result for either wins.
 */
function spellings(value, scope) {
	const expanded = expandVariables(value, scope);
	const drive = isWindows() ? MSYS_DRIVE.exec(expanded) : null;
	return drive ? [expanded, `${drive[1]}:${expanded.slice(drive[0].length) || "/"}`] : [expanded];
}

// What a classification may spend on file-system lookups when its caller sets `cache.maxLookups` (an MCP call: its input has
// no size limit). An existence check costs 1 and a realpath 5, about what they cost in time (0.03-0.09 ms and 0.3-0.4 ms on
// Windows). Past the limit the classification throws, and the hook refuses the call: hosts treat a hook that times out as an allow.
function spend(cache, units) {
	if (cache.maxLookups === undefined) return;
	cache.lookups = (cache.lookups ?? 0) + units;
	if (cache.lookups > cache.maxLookups) {
		throw Object.assign(new Error(`naming its paths takes more than ${cache.maxLookups.toLocaleString("en-US")} file-system lookups`), { code: "PATH_LOOKUP_BUDGET" });
	}
}

function nativeRealpath(path) {
	try {
		return realpathSync.native(path);
	} catch {
		try {
			return realpathSync(path);
		} catch {
			return path;
		}
	}
}

// A path is walked up one level at a time (a lookup each) only this far. Nothing exists below a directory that does not,
// so past it the nearest ancestor that exists is found by bisection over the text of the path: hundreds of missing levels
// cost about as many lookups as a few, and no work per level (a path of 500 levels took 45 ms of lookups on Windows, and a
// call can carry hundreds of them).
const LINEAR_WALK_LEVELS = 8;

/**
 * The deepest ancestor of `start` (itself included) that exists, by bisection; the root when none does.
 * The ancestors of a resolved path are its prefixes that end before a separator.
 */
function nearestExistingAncestor(start, cache) {
	const rootLength = parse(start).root.length;
	const cuts = [rootLength];
	for (let i = rootLength; i < start.length; i += 1) {
		if (start[i] === "/" || (start[i] === "\\" && isWindows())) cuts.push(i);
	}
	cuts.push(start.length);
	let low = 0;
	let high = cuts.length - 1;
	while (low < high) {
		const middle = (low + high + 1) >> 1;
		spend(cache, 1);
		if (existsSync(start.slice(0, cuts[middle]))) low = middle;
		else high = middle - 1;
	}
	return start.slice(0, cuts[low]);
}

/**
 * Real path of `path`: the nearest existing ancestor is realpath'd (symlinks, junctions, 8.3
 * names, on-disk case) and the missing tail re-appended. `cache` (path -> result) is shared by
 * every path classified in one call, so siblings cost one filesystem lookup, not one walk each.
 */
function realpathNearestAncestor(path, cache) {
	const known = cache.get(path);
	if (known !== undefined) return known;
	const missing = [];
	let current = path;
	let base;
	let jumped = false;
	for (;;) {
		const hit = cache.get(current);
		if (hit !== undefined) {
			base = hit;
			break;
		}
		spend(cache, 1);
		if (existsSync(current)) {
			spend(cache, 5);
			base = nativeRealpath(current);
			cache.set(current, base);
			break;
		}
		const parent = dirname(current);
		if (parent === current) {
			base = current;
			break;
		}
		missing.push(current);
		current = parent;
		if (missing.length === LINEAR_WALK_LEVELS) {
			current = nearestExistingAncestor(current, cache);
			jumped = true;
		}
	}
	if (jumped) {
		// Everything below `current` is missing, so each missing directory is the real base plus the rest of its text.
		for (const node of missing) cache.set(node, join(base, node.slice(current.length)));
		return cache.get(path);
	}
	for (let i = missing.length - 1; i >= 0; i -= 1) {
		base = join(base, basename(missing[i]));
		cache.set(missing[i], base);
	}
	return base;
}

function canonical(value) {
	let out = value.replaceAll("\\", "/");
	if (isWindows()) out = out.toLowerCase();
	if (out.length > 1 && out.endsWith("/") && !/^[a-z]:\/$/i.test(out)) out = out.slice(0, -1);
	return out;
}

const DEVICE_PREFIX = /^(?:[\\/]{2}[?.]|[\\/]\?\?)[\\/]/;
const DRIVE_PREFIX = /^[a-z]:/i;

/** A `\\?\`, `\\.\` or `\??\` prefix removed; `unc`/`opaque` say what is left is not a drive path. */
function stripDevicePrefix(value) {
	const device = DEVICE_PREFIX.exec(value);
	if (!device) return { value, device: false, opaque: false };
	let rest = value.slice(device[0].length);
	if (/^unc[\\/]/i.test(rest)) rest = `//${rest.slice(4)}`;
	return { value: rest, device: true, opaque: !DRIVE_PREFIX.test(rest) && !/^[\\/]{2}[^\\/]/.test(rest) };
}

function opaquePath(value) {
	return { path: value.replaceAll("\\", "/").toLowerCase(), suspicious: true, unc: true };
}

/** A plain loop: `/[. ]+$/` backtracks quadratically on a long run of dots and spaces. */
function trimTrailingDotsAndSpaces(part) {
	let end = part.length;
	while (end > 0 && (part[end - 1] === "." || part[end - 1] === " ")) end -= 1;
	return end === part.length ? part : part.slice(0, end);
}

/** One spelling of a path, normalized (see the module comment). */
function normalizeSpelling(value, { cwd, cache }) {
	let suspicious = false;
	const stripped = stripDevicePrefix(value);
	if (stripped.device) suspicious = true;
	value = stripped.value;
	if (stripped.opaque) return opaquePath(value);
	// `//server/share` is a UNC path only on Windows; POSIX reads `//tmp/x` as `/tmp/x`.
	if (isWindows() && /^[\\/]{2}[^\\/]/.test(value)) return opaquePath(value);
	// The drive prefix (`C:`) is not a stream separator; every other `:` starts an NTFS stream.
	const drive = DRIVE_PREFIX.exec(value)?.[0] ?? "";
	const parts = value.slice(drive.length).split(/[\\/]/);
	for (let index = 0; index < parts.length; index += 1) {
		let part = parts[index];
		if (part.includes(":")) {
			part = part.slice(0, part.indexOf(":"));
			suspicious = true;
		}
		// cmd and PowerShell drop trailing dots and spaces (`yolo.json.` is `yolo.json`); `...` is a real name.
		if (isWindows() && part !== "." && part !== "..") part = trimTrailingDotsAndSpaces(part) || (/^\.{3,}$/.test(part) ? part : "");
		parts[index] = part;
	}
	const base = stripDevicePrefix(cwd).value;
	const absolute = resolve(base, `${drive}${parts.join("/")}`);
	const real = absolute.length > MAX_REALPATH_CHARS ? absolute : realpathNearestAncestor(absolute, cache);
	// `lexical` is the same path before links are followed: `.claude` may be a symlink into a dotfiles repo.
	return { path: canonical(real), lexical: canonical(absolute), suspicious, unc: false };
}

function newScope({ cwd, env, cache = new Map() }) {
	return { cwd, env, lookup: envLookup(env), cache };
}

/**
 * Normalize a tool-supplied path for policy decisions.
 * @returns {{ path: string, lexical?: string, suspicious: boolean, unc: boolean } | null}
 *   `suspicious` = device/UNC form or an alternate data stream was involved.
 *   `lexical` = the same path before symlinks were followed.
 */
export function normalizePolicyPath(rawPath, { cwd = process.cwd(), env = process.env, cache } = {}) {
	const value = String(rawPath ?? "").trim();
	if (!value || value.includes("\0")) return null;
	const scope = newScope({ cwd, env });
	const [primary] = spellings(value, scope);
	return normalizeSpelling(primary, { cwd, cache: cache ?? scope.cache });
}

function within(path, root) {
	return Boolean(root) && (path === root || path.startsWith(`${root}/`));
}

/** Normalized locations that decide a path's kind for this workspace + environment. */
export function protectedLocations(workspaceRoot, { env = process.env, cwd = process.cwd(), cache } = {}) {
	const scope = newScope({ cwd, env });
	if (cache) scope.cache = cache;
	const norm = (path) => (path ? normalizePolicyPath(path, { cwd, env, cache: scope.cache })?.path || null : null);
	const home = hostHome(env);
	const operationalRoot = workspaceRoot ? pathsFor(workspaceRoot).operationalRoot : null;
	return {
		operationalRoot: operationalRoot ? norm(operationalRoot) : null,
		// The same root without following links: a directory inside it that is itself a link still names Heli state.
		lexicalOperationalRoot: operationalRoot ? canonical(resolve(cwd, operationalRoot)) : null,
		heliDirs: [...new Set([norm(globalConfigDir(env)), norm(globalDataDir(env))].filter(Boolean))],
		hostHookFiles: [
			norm(join(home, ".grok", "hooks", "heli-harness.json")),
			norm(join(home, ".config", "opencode", "plugins", "heli-harness.js")),
		],
		hostHookDirs: [
			norm(join(home, ".config", "opencode", "plugins", "heli-harness-bundle")),
			norm(join(home, ".cursor", "plugins", "local", "heli-harness")),
			// Antigravity installs into a directory the user names (lib/cli/host.mjs antigravityDir).
			env.HELI_ANTIGRAVITY_PLUGIN_DIR ? norm(join(env.HELI_ANTIGRAVITY_PLUGIN_DIR, "heli-harness")) : null,
		],
		claudeConfigDir: env.CLAUDE_CONFIG_DIR ? norm(env.CLAUDE_CONFIG_DIR) : null,
	};
}

function classifyOperational(rel) {
	if (rel === "") return { kind: "authority", label: "the Heli operational state root" };
	const parts = rel.split("/");
	if (parts[0] === "tasks") {
		if (parts.length <= 2) return { kind: "authority", label: `task state ${rel}` };
		const inner = parts.slice(2).join("/");
		if (TASK_AUTHORITY_FILES.has(inner)) return { kind: "authority", label: `task authority file ${rel}` };
		if (TASK_NARRATIVE_FILES.has(inner) || inner.startsWith("reports/") || inner.startsWith("runs/")) {
			return { kind: "narrative", taskId: parts[1] };
		}
		return { kind: "other" };
	}
	if (AUTHORITY_DIRS.has(parts[0])) return { kind: "authority", label: `${parts[0]}/ state` };
	if (rel === "state" || STATE_AUTHORITY_FILES.has(rel)) return { kind: "authority", label: rel === "state" ? "the Heli state directory" : `YOLO/diagnosis state ${rel}` };
	if (parts[0] === "workspace" && (parts.length === 1 || (parts.length === 2 && parts[1].endsWith(".json")))) {
		return { kind: "authority", label: `workspace state ${rel}` };
	}
	if (STATE_NARRATIVE_FILES.has(rel) || rel.startsWith("state/reports/") || rel.startsWith("state/runs/")) {
		return { kind: "narrative", taskId: null };
	}
	return { kind: "other" };
}

/**
 * Classify one normalized policy path (see normalizePolicyPath).
 * @returns {{ kind: "authority"|"narrative"|"claude-settings"|"other", taskId?: string|null, label?: string }}
 */
export function classifyPolicyPath(normalized, locations) {
	if (!normalized) return { kind: "other" };
	const path = normalized.path;
	if (normalized.unc) {
		return HELI_LOCATION_MARKERS.some((marker) => path.includes(marker))
			? { kind: "authority", label: "a UNC/device path into Heli state" }
			: { kind: "other" };
	}
	const op = locations.operationalRoot;
	const lexicalOp = locations.lexicalOperationalRoot;
	// A link inside Heli state that leads elsewhere (`tasks` moved to another disk) still names the file the
	// kernel reads, so the path as written can only add protection. It never makes anything narrative: a link
	// out of a notes folder is judged by where it leads.
	const lexical = lexicalOp && normalized.lexical && within(normalized.lexical, lexicalOp)
		? classifyOperational(normalized.lexical === lexicalOp ? "" : normalized.lexical.slice(lexicalOp.length + 1))
		: null;
	if (op && within(path, op)) {
		const result = classifyOperational(path === op ? "" : path.slice(op.length + 1));
		// Stream and device spellings only exist on Windows; a `:` in a POSIX file name is just a character.
		if (normalized.suspicious && isWindows() && result.kind !== "other") return { kind: "authority", label: "an alternate-data-stream/device path into Heli state" };
		return result.kind !== "authority" && lexical?.kind === "authority" ? lexical : result;
	}
	if (lexical?.kind === "authority") return lexical;
	for (const dir of locations.heliDirs) {
		if (within(path, dir)) return { kind: "authority", label: "the Heli config/data directory" };
	}
	if (locations.hostHookFiles.includes(path) || locations.hostHookDirs.some((dir) => within(path, dir))) {
		return { kind: "authority", label: "a Heli-installed host hook" };
	}
	const isClaudeSettings = (candidate) => {
		const name = basename(candidate);
		return (name === "settings.json" || name === "settings.local.json") && candidate.endsWith(`/.claude/${name}`);
	};
	const name = basename(path);
	if (isClaudeSettings(path) || (normalized.lexical && isClaudeSettings(normalized.lexical)) ||
		((name === "settings.json" || name === "settings.local.json") && locations.claudeConfigDir && dirname(path) === locations.claudeConfigDir)) {
		return { kind: "claude-settings" };
	}
	return { kind: "other" };
}

/** Every spelling of one raw path, classified. `base` is the directory relative paths resolve against. */
function classifyRaw(raw, base, locations, scope) {
	const value = String(raw ?? "").trim();
	if (!value || value.includes("\0")) return [{ raw, normalized: null, kind: "other" }];
	return spellings(value, { cwd: base, lookup: scope.lookup }).map((spelling) => {
		const normalized = normalizeSpelling(spelling, { cwd: base, cache: scope.cache });
		return { raw, normalized: normalized.path, ...classifyPolicyPath(normalized, locations) };
	});
}

/** Normalize + classify a batch of raw tool paths. A path with more than one reading has one entry per reading. */
export function classifyToolPaths(rawPaths, { workspaceRoot = null, cwd = process.cwd(), env = process.env, cache } = {}) {
	const scope = newScope({ cwd, env, cache });
	const locations = protectedLocations(workspaceRoot, { env, cwd, cache: scope.cache });
	return (rawPaths || []).flatMap((raw) => classifyRaw(raw, cwd, locations, scope));
}

/**
 * Resolves `cd` chains one hop at a time and remembers every hop: the directory a chain leads to is
 * its parent's directory plus one `cd`, so a target costs the same after ten `cd`s as after ten
 * thousand. (Walking the whole chain for every target made a 19 KB command take two minutes.)
 * Every `cd` is normalized like any other path, so `cd .heli-harness.` or a junction lands where
 * the shell lands, and each hop is read as written and, on Windows, as Git Bash reads `/c/...`.
 * A chain node is `{ dir, parent }`, as shellWriteTargets builds it; a target made by hand has only
 * its `cdPath` array, which is interned into the same kind of node.
 */
function createChainResolver(cwd, scope) {
	const states = new Map();
	const interned = new Map();
	const firstSteps = new Map();
	const start = { native: cwd, gitBash: cwd, bases: [cwd] };
	const longest = cwd.length + MAX_CHAIN_GROWTH;

	const hop = (state, step) => {
		const [written, alternate] = spellings(String(step).trim(), { cwd: state.native, lookup: scope.lookup });
		let native = normalizeSpelling(written, { cwd: state.native, cache: scope.cache }).path;
		const readsAlike = !isWindows() || (alternate === undefined && state.gitBash === state.native);
		let gitBash = readsAlike ? native : normalizeSpelling(alternate ?? written, { cwd: state.gitBash, cache: scope.cache }).path;
		// A working directory cannot be longer than the OS allows, so a chain that grows past that has `cd`s that
		// fail (nobody checked) and following it further is meaningless: keep the last directory that could exist.
		// Without this, each hop costs O(length so far) and a 30 KB run of `cd`s takes seconds.
		if (native.length > longest) native = state.native;
		if (gitBash.length > longest) gitBash = state.gitBash;
		return native === state.native && gitBash === state.gitBash ? state : { native, gitBash, bases: [...new Set([cwd, native, gitBash])] };
	};
	const stateOf = (node) => {
		const pending = [];
		let cursor = node;
		while (cursor && !states.has(cursor)) {
			pending.push(cursor);
			cursor = cursor.parent;
		}
		let state = cursor ? states.get(cursor) : start;
		for (let index = pending.length - 1; index >= 0; index -= 1) {
			state = hop(state, pending[index].dir);
			states.set(pending[index], state);
		}
		return state;
	};
	const child = (parent, step) => {
		const steps = parent ? (parent.children ??= new Map()) : firstSteps;
		let next = steps.get(step);
		if (!next) {
			next = { dir: step, parent, children: null };
			steps.set(step, next);
		}
		return next;
	};
	const nodeOf = (target) => {
		if ("cdChain" in target) return target.cdChain;
		const chain = target.cdPath || [];
		let node = interned.get(chain);
		if (node === undefined) {
			node = null;
			for (const step of chain) node = child(node, step);
			interned.set(chain, node);
		}
		return node;
	};
	/** The directories to try a target's relative path against: where the command started, and where its `cd`s lead. */
	return { basesOf: (target) => stateOf(nodeOf(target)).bases };
}

/**
 * Classify shell write targets (see command-policy shellWriteTargets). Each
 * target is resolved against the hook cwd AND, when the command changed
 * directory first, against that directory — a protected reading wins.
 */
export function classifyShellWriteTargets(targets, { workspaceRoot = null, cwd = process.cwd(), env = process.env, cache } = {}) {
	const scope = newScope({ cwd, env, cache });
	const locations = protectedLocations(workspaceRoot, { env, cwd, cache: scope.cache });
	const chains = createChainResolver(cwd, scope);
	const entries = [];
	for (const target of targets || []) {
		for (const base of chains.basesOf(target)) entries.push(...classifyRaw(target.path, base, locations, scope));
	}
	return entries;
}

/** JSON allows \u0041 for A inside a key, so a settings payload is read as the file would be. */
function decodeJsonEscapes(text) {
	return String(text ?? "").replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
}

// Fields that hold the text an edit replaces, not the text it writes: old_string, oldString, old_str, oldText, old_source,
// original, search, find, and their spellings.
const REPLACED_TEXT_KEYS = /^(?:old|original|previous|before|search|find)(?:_?(?:string|str|text|source|content|pattern))?$/i;
// Text that is a patch: Codex's `*** Begin Patch` format or a unified diff.
const PATCH_TEXT = /^(?:\*\*\* (?:Begin Patch|Add File: |Update File: |Delete File: )|diff --git |@@ )/m;

function addedLines(patch) {
	const added = [];
	for (const line of patch.split(/\r?\n/)) if (line.startsWith("+") && !line.startsWith("+++")) added.push(line.slice(1));
	return added.join("\n");
}

/**
 * The text a file tool's input puts in a settings file: every string except the ones that hold the text being replaced
 * (`old_string`, `oldText`, `old_str`, ...), and only the added lines of a patch. What an edit removes is not read: the
 * check is for a write that turns Heli off, and re-enabling hooks is what the user wants.
 */
export function settingsContentOf(toolInput) {
	const parts = [];
	const stack = [[toolInput, undefined]];
	while (stack.length) {
		const [value, key] = stack.pop();
		if (typeof value === "string") {
			if (key !== undefined && REPLACED_TEXT_KEYS.test(key)) continue;
			parts.push(PATCH_TEXT.test(value) ? addedLines(value) : value);
		} else if (value && typeof value === "object") {
			const isList = Array.isArray(value);
			for (const [childKey, child] of Object.entries(value)) stack.push([child, isList ? undefined : childKey]);
		}
	}
	return parts.join("\n");
}

// The ways a settings payload turns Heli off (all hooks, or the Heli plugin). A file tool writes JSON, so a key is read the way
// JSON spells it. A shell command may edit the file with jq or PowerShell instead (`.disableAllHooks=true`, `$s.disableAllHooks =
// $true`, `Add-Member disableAllHooks $true`, `.enabledPlugins["heli-harness@x"]=false`), and those assignments count for a
// command. No pattern lets whitespace be split two ways, so a long run of it cannot make a match quadratic.
const HOOKS_OFF_JSON = [/"disableAllHooks"\s*:\s*true/i, /"heli-harness@[^"]*"\s*:\s*false/i];
const HOOKS_OFF_ASSIGNED = [
	/\bdisableAllHooks["']?(?:\s*(?:\|?=|:)\s*|\s+(?:-Value\s+)?)\$?true\b/i,
	/\bheli-harness@[\w.-]*["'\]]*(?:\s*(?:\|?=|:)\s*|\s+(?:-Value\s+)?)\$?false\b/i,
];

/** True when a settings payload turns Heli off (all hooks, or the Heli plugin). `loose` also reads a shell command's assignments. */
export function disablesClaudeHooks(text, { loose = false } = {}) {
	const value = decodeJsonEscapes(text);
	return HOOKS_OFF_JSON.some((pattern) => pattern.test(value)) || (loose && HOOKS_OFF_ASSIGNED.some((pattern) => pattern.test(value)));
}

/**
 * The HELI_ variables a settings payload sets in an `env` block (any key that starts with HELI_, in any case: Windows
 * variable names are). Claude Code can hand that block to Heli's hook processes, so HELI_YOLO, HELI_GUARDS,
 * HELI_ALLOW_* or a relocated HELI_DATA_DIR/HELI_CONFIG_DIR (the store that holds the grants) would be
 * self-approval. For a file tool only a JSON key counts: a value that only mentions one ("Bash(HELI_YOLO=1 npm test)")
 * is not a key. A shell command can set one with jq or PowerShell (`.env.HELI_YOLO="1"`), so `loose` reads any word that starts
 * with HELI_ (not `NOT_HELI_X`); a command that writes a settings file and only mentions one is refused too, which is the price
 * of not parsing every editor.
 */
export function heliEnvironmentKeys(text, { loose = false } = {}) {
	const pattern = loose ? /\b(HELI_[A-Z0-9_]+)/gi : /"(HELI_[^"\s]*)"\s*:/gi;
	return [...new Set([...decodeJsonEscapes(text).matchAll(pattern)].map((match) => match[1]))];
}

export function protectedWriteReason(entry, { mcp = false } = {}) {
	// An MCP call names its files in fields Heli cannot read the meaning of, so a call that reads Heli state is refused with the
	// calls that write it.
	const forbidden = mcp ? "Agents may not read or write it through MCP tools (an MCP call that reads it cannot be told from one that writes it)." : "Agents may not write it.";
	return `Heli-Harness protects its own authority state: ${entry.raw} is ${entry.label}. ${forbidden} Use the Heli CLI for normal state changes (heli task/session/target commands), or ask the user to run approval/YOLO commands in their own terminal.`;
}

/** Reason for a settings write that sets HELI_ environment variables (see heliEnvironmentKeys). */
export function protectedEnvironmentReason(entry, keys) {
	return `Heli-Harness protects its own authority state: ${entry.raw} would set ${keys.join(", ")} in an env block, and the host can pass that block to Heli's hook processes, so it could switch YOLO on or move the store that holds Heli's grants and state. Agents may not set HELI_ variables there; ask the user to change Claude settings themselves.`;
}
