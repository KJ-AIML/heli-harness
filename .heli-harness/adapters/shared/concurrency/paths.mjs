/**
 * Workspace / worktree / path canonicalization for Heli concurrency.
 */
import { existsSync, statSync } from "node:fs";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { safeRealpath } from "./fs-atomic.mjs";
import { hashCanonicalPath } from "./ids.mjs";

export const DEFAULT_LEASE_TTL_SECONDS = 14400;

export function isWindows() {
	return process.platform === "win32";
}

/**
 * Canonicalize a filesystem path for binding identity.
 * - absolute
 * - realpath when possible
 * - forward slashes
 * - lowercase drive letter / path on Windows
 */
export function canonicalizePath(input) {
	if (!input) return "";
	let p = resolve(String(input));
	p = safeRealpath(p);
	p = normalize(p);
	// unify separators
	p = p.replace(/\\/g, "/");
	if (isWindows()) {
		// lowercase for case-insensitive FS identity
		p = p.toLowerCase();
		// strip trailing slash except drive root C:/
		if (p.length > 3 && p.endsWith("/")) p = p.slice(0, -1);
	} else {
		if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
	}
	return p;
}

export function bindingHashForPath(canonicalPath) {
	return hashCanonicalPath(canonicalPath);
}

export function gitShowToplevel(cwd) {
	try {
		const r = spawnSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
			encoding: "utf8",
			windowsHide: true,
		});
		if (r.status === 0 && r.stdout) {
			return canonicalizePath(r.stdout.trim());
		}
	} catch {
		/* ignore */
	}
	return null;
}

export function gitRevParse(cwd, rev = "HEAD") {
	try {
		const r = spawnSync("git", ["-C", cwd, "rev-parse", rev], {
			encoding: "utf8",
			windowsHide: true,
		});
		if (r.status === 0 && r.stdout) return r.stdout.trim();
	} catch {
		/* ignore */
	}
	return null;
}

export function gitBranch(cwd) {
	try {
		const r = spawnSync("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"], {
			encoding: "utf8",
			windowsHide: true,
		});
		if (r.status === 0 && r.stdout) return r.stdout.trim();
	} catch {
		/* ignore */
	}
	return null;
}

/**
 * Walk upward from cwd looking for .heli-harness/HARNESS.md.
 * Returns absolute workspace root or null.
 */
export function findWorkspaceRoot(startCwd) {
	let dir = resolve(startCwd || process.cwd());
	const seen = new Set();
	while (dir && !seen.has(dir)) {
		seen.add(dir);
		const harness = join(dir, ".heli-harness", "HARNESS.md");
		if (existsSync(harness)) return canonicalizePath(dir);
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

export function heliDir(workspaceRoot) {
	return join(workspaceRoot, ".heli-harness");
}

export function pathsFor(workspaceRoot) {
	const root = heliDir(workspaceRoot);
	return {
		heliDir: root,
		workspaceDir: join(root, "workspace"),
		schemaPath: join(root, "workspace", "schema.json"),
		indexPath: join(root, "workspace", "index.json"),
		targetPath: join(root, "workspace", "target.json"),
		stateDir: join(root, "state"),
		legacyTaskPath: join(root, "state", "current-task.md"),
		legacyPlanPath: join(root, "state", "plan.md"),
		legacyDecisionsPath: join(root, "state", "decisions.md"),
		legacyYoloPath: join(root, "state", "yolo.json"),
		tasksDir: join(root, "tasks"),
		sessionsDir: join(root, "sessions"),
		bindingsDir: join(root, "bindings", "worktrees"),
		locksDir: join(root, "locks", "tasks"),
	};
}

export function taskPaths(workspaceRoot, taskId) {
	const base = join(heliDir(workspaceRoot), "tasks", taskId);
	return {
		dir: base,
		taskJson: join(base, "task.json"),
		currentTaskMd: join(base, "current-task.md"),
		planMd: join(base, "plan.md"),
		decisionsMd: join(base, "decisions.md"),
		eventsJsonl: join(base, "events.jsonl"),
		reportsDir: join(base, "reports"),
		runsDir: join(base, "runs"),
		evidenceDir: join(base, "evidence"),
		yoloJson: join(base, "yolo.json"),
	};
}

export function sessionPath(workspaceRoot, sessionId) {
	return join(heliDir(workspaceRoot), "sessions", `${sessionId}.json`);
}

export function bindingPath(workspaceRoot, canonicalWorktree) {
	const hash = bindingHashForPath(canonicalWorktree);
	return join(heliDir(workspaceRoot), "bindings", "worktrees", `${hash}.json`);
}

export function writeLockDir(workspaceRoot, taskId) {
	return join(heliDir(workspaceRoot), "locks", "tasks", `${taskId}.write.lock`);
}

export function leasePath(workspaceRoot, taskId) {
	return join(writeLockDir(workspaceRoot, taskId), "lease.json");
}

/**
 * Resolve worktree root for a cwd: git toplevel if available, else cwd.
 */
export function resolveWorktreeRoot(cwd) {
	const top = gitShowToplevel(cwd);
	if (top) return top;
	return canonicalizePath(cwd);
}

export function isDirectory(path) {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

/** Simple glob-ish match: ** and * only, path uses /. */
export function matchGlob(pattern, filePath) {
	const p = String(pattern || "").replace(/\\/g, "/");
	const f = String(filePath || "").replace(/\\/g, "/");
	// escape regex specials except * 
	let re = "";
	for (let i = 0; i < p.length; i++) {
		const c = p[i];
		if (c === "*" && p[i + 1] === "*") {
			re += ".*";
			i++;
			if (p[i + 1] === "/") i++; // **/ 
		} else if (c === "*") {
			re += "[^/]*";
		} else if (/[.+^${}()|[\]\\]/.test(c)) {
			re += `\\${c}`;
		} else {
			re += c;
		}
	}
	return new RegExp(`^${re}$`, isWindows() ? "i" : "").test(f);
}
