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
 * This is a guardrail, not a sandbox: wildcards, shell variables set inside the
 * command, and interpreters (`python -c`) can still name a path this module
 * never sees spelled out.
 */
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
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
	for (;;) {
		const hit = cache.get(current);
		if (hit !== undefined) {
			base = hit;
			break;
		}
		if (existsSync(current)) {
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

function newScope({ cwd, env }) {
	return { cwd, env, lookup: envLookup(env), cache: new Map() };
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
export function classifyToolPaths(rawPaths, { workspaceRoot = null, cwd = process.cwd(), env = process.env } = {}) {
	const scope = newScope({ cwd, env });
	const locations = protectedLocations(workspaceRoot, { env, cwd, cache: scope.cache });
	return (rawPaths || []).flatMap((raw) => classifyRaw(raw, cwd, locations, scope));
}

/**
 * The directories a `cd` chain leads to from `cwd`: as written, and as Git Bash reads `/c/...` on
 * Windows. Every step is normalized like any other path, so `cd .heli-harness.` or a junction
 * lands where the shell lands.
 */
function chainBases(cwd, cdPath, scope) {
	const walk = (gitBash) => {
		let dir = cwd;
		for (const step of cdPath) {
			const [written, alternate] = spellings(String(step).trim(), { cwd: dir, lookup: scope.lookup });
			dir = normalizeSpelling(gitBash ? (alternate ?? written) : written, { cwd: dir, cache: scope.cache }).path;
		}
		return dir;
	};
	return [...new Set([cwd, walk(false), ...(isWindows() ? [walk(true)] : [])])];
}

/**
 * Classify shell write targets (see command-policy shellWriteTargets). Each
 * target is resolved against the hook cwd AND, when the command changed
 * directory first, against that directory — a protected reading wins.
 */
export function classifyShellWriteTargets(targets, { workspaceRoot = null, cwd = process.cwd(), env = process.env } = {}) {
	const scope = newScope({ cwd, env });
	const locations = protectedLocations(workspaceRoot, { env, cwd, cache: scope.cache });
	const basesByChain = new Map();
	const entries = [];
	for (const target of targets || []) {
		const chain = target.cdPath || [];
		let bases = basesByChain.get(chain);
		if (!bases) {
			bases = chainBases(cwd, chain, scope);
			basesByChain.set(chain, bases);
		}
		for (const base of bases) entries.push(...classifyRaw(target.path, base, locations, scope));
	}
	return entries;
}

/** True when a settings payload turns Heli off (all hooks, or the Heli plugin). */
export function disablesClaudeHooks(text) {
	// JSON allows `\u0041` for `A` inside a key, so the payload is read as the file would be.
	const value = String(text ?? "").replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
	return /"disableAllHooks"\s*:\s*true/i.test(value) || /"heli-harness@[^"]*"\s*:\s*false/i.test(value);
}

export function protectedWriteReason(entry) {
	return `Heli-Harness protects its own authority state: ${entry.raw} is ${entry.label}. Agents may not write it. Use the Heli CLI for normal state changes (heli task/session/target commands), or ask the user to run approval/YOLO commands in their own terminal.`;
}
