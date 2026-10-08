import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
	canonicalizePath,
	readProjectBinding,
	readWorkspaceLock,
	readWorkspaceRegistry,
	registerWorkspace,
	workspaceManifestPath,
	workspaceLockPath,
} from "../concurrency/index.mjs";
import { updateLinked } from "./update.mjs";
import { wantsJson, stripOutputFlags, printProtocolResult } from "./output.mjs";
import { protocolOk } from "../protocol/result.mjs";

const DISCOVERY_SKIP = new Set([
	".git",
	".heli",
	".heli-harness",
	"node_modules",
	"dist",
	"build",
	"target",
	".next",
	".cache",
]);

function error(code, message) {
	const value = new Error(message);
	value.code = code;
	return value;
}

function readJson(path, fallback = null) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return fallback;
	}
}

function packageVersion(packageRoot) {
	return readJson(resolve(packageRoot, "package.json"), {})?.version || "unknown";
}

function isWithin(candidate, root) {
	const path = canonicalizePath(candidate);
	const base = canonicalizePath(root);
	return path === base || path.startsWith(base + "/");
}

function discoverLinkedWorkspaces(root, maxDepth) {
	const found = [];
	const seen = new Set();
	const visit = (dir, depth) => {
		const canonical = canonicalizePath(dir);
		if (seen.has(canonical)) return;
		seen.add(canonical);
		if (existsSync(workspaceManifestPath(canonical))) found.push(canonical);
		if (depth >= maxDepth) return;
		let entries;
		try {
			entries = readdirSync(canonical, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
			if (DISCOVERY_SKIP.has(entry.name)) continue;
			visit(resolve(canonical, entry.name), depth + 1);
		}
	};
	visit(resolve(root), 0);
	return found;
}

function parse(args = []) {
	const values = stripOutputFlags(args);
	const positional = [];
	let root = null;
	let discover = false;
	let dryRun = false;
	let depth = 4;
	for (let i = 0; i < values.length; i += 1) {
		const value = values[i];
		if (value === "--root") {
			if (!values[i + 1]) throw error("ROOT_REQUIRED", "--root requires a directory path");
			root = resolve(values[++i]);
		} else if (value === "--discover") {
			discover = true;
		} else if (value === "--dry-run") {
			dryRun = true;
		} else if (value === "--depth") {
			const parsed = Number.parseInt(values[++i] || "", 10);
			if (!Number.isInteger(parsed) || parsed < 0 || parsed > 12) {
				throw error("INVALID_DEPTH", "--depth must be an integer from 0 to 12");
			}
			depth = parsed;
		} else if (value.startsWith("--")) {
			throw error("UNKNOWN_MIGRATE_OPTION", `unknown migrate option: ${value}`);
		} else {
			positional.push(value);
		}
	}
	if (positional.length > 1) throw error("TOO_MANY_PATHS", "heli migrate accepts at most one explicit workspace path");
	if (discover && !root && !positional[0]) {
		throw error("DISCOVERY_ROOT_REQUIRED", "--discover requires --root <dir> or an explicit workspace path");
	}
	return {
		explicitPath: positional[0] ? resolve(positional[0]) : null,
		root,
		discover,
		dryRun,
		depth,
	};
}

function candidateMap(options, env = process.env) {
	const candidates = new Map();
	const add = (path, source) => {
		const canonical = canonicalizePath(path);
		const existing = candidates.get(canonical);
		if (existing) {
			existing.sources.add(source);
			return;
		}
		candidates.set(canonical, { path: canonical, sources: new Set([source]) });
	};

	if (options.explicitPath) {
		add(options.explicitPath, "explicit");
	} else {
		for (const item of readWorkspaceRegistry(env).workspaces || []) {
			if (item?.path) add(item.path, "registry");
		}
	}

	const discoveryRoot = options.root || options.explicitPath;
	if (options.discover && discoveryRoot && existsSync(discoveryRoot)) {
		for (const path of discoverLinkedWorkspaces(discoveryRoot, options.depth)) add(path, "discover");
	}

	let list = [...candidates.values()];
	if (options.root) list = list.filter((item) => isWithin(item.path, options.root));
	return list
		.map((item) => ({ ...item, sources: [...item.sources].sort() }))
		.sort((a, b) => a.path.localeCompare(b.path));
}

function rawLockVersion(workspaceRoot) {
	return readJson(workspaceLockPath(workspaceRoot), {})?.runtime?.version || null;
}

export function migrateLinkedWorkspaces(packageRoot, args = [], { env = process.env } = {}) {
	const options = parse(args);
	const targetVersion = packageVersion(packageRoot);
	const candidates = candidateMap(options, env);
	const results = [];

	for (const candidate of candidates) {
		const base = {
			path: candidate.path,
			sources: candidate.sources,
			fromVersion: null,
			toVersion: targetVersion,
			workspaceId: null,
		};
		if (!existsSync(candidate.path)) {
			results.push({ ...base, status: "missing", changed: false, error: "workspace path no longer exists" });
			continue;
		}

		let binding;
		try {
			binding = readProjectBinding(candidate.path);
		} catch (cause) {
			results.push({
				...base,
				status: "invalid-binding",
				changed: false,
				error: cause?.message || String(cause),
			});
			continue;
		}
		if (!binding) {
			results.push({ ...base, status: "not-linked", changed: false, error: ".heli/workspace.json not found" });
			continue;
		}

		base.workspaceId = binding.workspaceId;
		base.fromVersion = rawLockVersion(candidate.path);
		if (options.dryRun) {
			results.push({
				...base,
				status: base.fromVersion === targetVersion ? "would-verify" : "would-migrate",
				changed: base.fromVersion !== targetVersion,
			});
			continue;
		}

		try {
			const updated = updateLinked(packageRoot, candidate.path);
			const registry = registerWorkspace(candidate.path, { env });
			const lock = readWorkspaceLock(candidate.path);
			results.push({
				...base,
				status: base.fromVersion === targetVersion ? "current" : "migrated",
				changed: base.fromVersion !== targetVersion || updated.safetyMigration?.some((item) => item.changed) === true,
				fromVersion: base.fromVersion,
				toVersion: lock?.runtime?.version || targetVersion,
				registryRefreshed: Boolean(registry),
				safetyMigration: updated.safetyMigration || [],
			});
		} catch (cause) {
			results.push({
				...base,
				status: "failed",
				changed: false,
				error: cause?.message || String(cause),
			});
		}
	}

	const failed = results.filter((item) => ["failed", "invalid-binding"].includes(item.status)).length;
	const migrated = results.filter((item) => item.status === "migrated").length;
	const current = results.filter((item) => item.status === "current").length;
	const missing = results.filter((item) => item.status === "missing").length;
	const skipped = results.filter((item) => item.status === "not-linked").length;

	return {
		targetVersion,
		dryRun: options.dryRun,
		root: options.root ? canonicalizePath(options.root) : null,
		discover: options.discover,
		depth: options.depth,
		results,
		summary: { total: results.length, migrated, current, missing, skipped, failed },
	};
}

function render(result) {
	console.log(`Heli workspace migration — global runtime ${result.targetVersion}`);
	if (result.root) console.log(`Root filter: ${result.root}`);
	if (result.discover) console.log(`Discovery: enabled (depth ${result.depth})`);
	if (result.dryRun) console.log("Mode: dry-run (no workspace or registry changes)");
	console.log("");

	if (!result.results.length) {
		console.log("No linked workspaces found.");
	} else {
		for (const item of result.results) {
			const mark =
				item.status === "migrated" ? "✓" :
				item.status === "current" ? "=" :
				item.status.startsWith("would-") ? "○" :
				item.status === "missing" || item.status === "not-linked" ? "!" : "✗";
			const versions = item.fromVersion || item.toVersion
				? ` ${item.fromVersion || "unknown"} -> ${item.toVersion || "unknown"}`
				: "";
			console.log(`${mark} ${item.path} [${item.status}]${versions}`);
			if (item.error) console.log(`    ${item.error}`);
		}
	}

	console.log("");
	const s = result.summary;
	console.log(`Summary: total=${s.total} migrated=${s.migrated} current=${s.current} missing=${s.missing} skipped=${s.skipped} failed=${s.failed}`);
	console.log("Registry is locator-only; migration never treats registry rows as writer/session authority.");
	console.log("Sessions, leases, grants, and runtime capability observations are not copied or reset.");
}

export function runMigrate(packageRoot, args = []) {
	const json = wantsJson(args);
	const result = migrateLinkedWorkspaces(packageRoot, args);
	if (json) printProtocolResult(protocolOk("migrate", result));
	else render(result);
	if (result.summary.failed > 0) process.exitCode = 1;
	return result;
}
