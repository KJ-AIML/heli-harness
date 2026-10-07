/**
 * Workspace / worktree / path canonicalization for Heli concurrency.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, resolve, sep, win32 } from "node:path";
import { spawnSync } from "node:child_process";
import { safeRealpath } from "./fs-atomic.mjs";
import { hashCanonicalPath } from "./ids.mjs";
import {
	hasProjectBindingFile,
	readProjectBinding,
	resolveWorkspaceLayout,
	workspaceManifestPath,
	workspaceLockPath,
	projectPolicyDir,
	projectSafetyDir,
	projectProfilesDir,
	projectSkillsDir,
	linkedWorkspaceTasksDir,
	linkedWorkspaceContinuationsDir,
} from "./project-binding.mjs";

export const DEFAULT_LEASE_TTL_SECONDS = 14400;

export function isWindows() {
	return process.platform === "win32";
}

/**
 * Canonicalize a filesystem path for binding identity.
 * - absolute
 * - native realpath when possible, then realpath
 * - forward slashes
 * - lowercase drive letter / path on Windows
 *
 * `platform` and `realpath` exist so tests can prove Windows 8.3 and long-path
 * aliases collapse to one identity without a Windows runner.
 */
export function normalizePathIdentity(input, {
	realpath = null,
	platform = process.platform,
} = {}) {
	if (!input) return "";
	const resolveRealpath = realpath || safeRealpath;
	let p;
	if (platform === "win32" && process.platform !== "win32") {
		p = String(input).replace(/\\/g, "/");
	} else {
		p = resolve(String(input));
	}
	p = resolveRealpath(p);
	p = platform === "win32" ? win32.normalize(String(p)) : normalize(String(p));
	p = p.replace(/\\/g, "/");
	if (platform === "win32") {
		p = p.toLowerCase();
		if (p.length > 3 && p.endsWith("/")) p = p.slice(0, -1);
	} else if (p.length > 1 && p.endsWith("/")) {
		p = p.slice(0, -1);
	}
	return p;
}

export function canonicalizePath(input) {
	return normalizePathIdentity(input);
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

function isHeliDistributionCheckout(dir) {
	const packageJson = join(dir, "package.json");
	const cli = join(dir, "bin", "heli.mjs");
	if (!existsSync(packageJson) || !existsSync(cli)) return false;
	try {
		return JSON.parse(readFileSync(packageJson, "utf8"))?.name === "heli-harness";
	} catch {
		return false;
	}
}

/**
 * Walk upward from cwd looking for a Heli workspace.
 *
 * A Heli source/distribution checkout contains .heli-harness/HARNESS.md as
 * packaged content. When that checkout lives inside a linked parent workspace,
 * the package content must not shadow the parent's explicit .heli binding.
 * An explicit local .heli/workspace.json still wins, and ordinary embedded
 * workspaces keep nearest-workspace precedence.
 */
export function findWorkspaceRoot(startCwd) {
	let dir = resolve(startCwd || process.cwd());
	const seen = new Set();
	let distributionFallback = null;
	while (dir && !seen.has(dir)) {
		seen.add(dir);
		const projectBinding = workspaceManifestPath(dir);
		const harness = join(dir, ".heli-harness", "HARNESS.md");
		if (existsSync(projectBinding)) return canonicalizePath(dir);
		if (existsSync(harness)) {
			if (!isHeliDistributionCheckout(dir)) return canonicalizePath(dir);
			distributionFallback ||= canonicalizePath(dir);
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return distributionFallback;
}

/**
 * Walk upward looking specifically for a linked .heli/workspace.json binding.
 * Used when deciding whether a nested Git repository belongs to an existing
 * parent Heli workspace. This does not change normal nearest-workspace
 * resolution for an explicitly independent nested workspace.
 */
export function findLinkedWorkspaceAncestor(startCwd, { includeSelf = true } = {}) {
	let dir = resolve(startCwd || process.cwd());
	if (!includeSelf) dir = dirname(dir);
	const seen = new Set();
	while (dir && !seen.has(dir)) {
		seen.add(dir);
		if (hasProjectBindingFile(dir)) return canonicalizePath(dir);
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

export function heliDir(workspaceRoot) {
	const layout = resolveWorkspaceLayout(workspaceRoot);
	return layout.operationalRoot;
}

/**
 * Linked task records are shared by every checkout of one workspace id.
 * Sessions, leases, grants, and observations stay on the execution root.
 * Embedded compatibility tasks stay inside `.heli-harness/tasks`.
 */
export function tasksDirFor(workspaceRoot, { env = process.env } = {}) {
	const layout = resolveWorkspaceLayout(workspaceRoot, { env });
	if (layout.mode === "linked" && layout.binding?.workspaceId) {
		return linkedWorkspaceTasksDir(layout.binding.workspaceId, env);
	}
	return join(layout.operationalRoot, "tasks");
}

export function pathsFor(workspaceRoot, { env = process.env } = {}) {
	const layout = resolveWorkspaceLayout(workspaceRoot, { env });
	const root = layout.operationalRoot;
	const linked = layout.mode === "linked";
	return {
		heliDir: root,
		operationalRoot: root,
		layoutMode: layout.mode,
		linked,
		projectDir: linked ? join(workspaceRoot, ".heli") : join(workspaceRoot, ".heli-harness"),
		workspaceManifestPath: linked ? workspaceManifestPath(workspaceRoot) : null,
		workspaceLockPath: linked ? workspaceLockPath(workspaceRoot) : null,
		policiesDir: linked ? projectPolicyDir(workspaceRoot) : join(root, "policies"),
		safetyDir: linked ? projectSafetyDir(workspaceRoot) : join(root, "safety"),
		profilesDir: linked ? projectProfilesDir(workspaceRoot) : join(root, "profiles"),
		skillsDir: linked ? projectSkillsDir(workspaceRoot) : join(root, "skills"),
		workspaceDir: join(root, "workspace"),
		schemaPath: join(root, "workspace", "schema.json"),
		indexPath: join(root, "workspace", "index.json"),
		targetPath: join(root, "workspace", "target.json"),
		stateDir: join(root, "state"),
		legacyTaskPath: join(root, "state", "current-task.md"),
		legacyPlanPath: join(root, "state", "plan.md"),
		legacyDecisionsPath: join(root, "state", "decisions.md"),
		legacyDiagnosisPath: join(root, "state", "diagnosis.json"),
		legacyDiagnosisEventsPath: join(root, "state", "diagnosis-events.jsonl"),
		legacyYoloPath: join(root, "state", "yolo.json"),
		tasksDir: tasksDirFor(workspaceRoot, { env }),
		continuationsDir:
			linked && layout.binding?.workspaceId
				? linkedWorkspaceContinuationsDir(layout.binding.workspaceId, env)
				: join(root, "continuations"),
		sessionsDir: join(root, "sessions"),
		bindingsDir: join(root, "bindings", "worktrees"),
		locksDir: join(root, "locks", "tasks"),
		resourceLocksDir: join(root, "locks", "resources"),
	};
}

export function taskPaths(workspaceRoot, taskId, { env = process.env } = {}) {
	const base = join(tasksDirFor(workspaceRoot, { env }), taskId);
	return {
		dir: base,
		taskJson: join(base, "task.json"),
		currentTaskMd: join(base, "current-task.md"),
		planMd: join(base, "plan.md"),
		decisionsMd: join(base, "decisions.md"),
		diagnosisJson: join(base, "diagnosis.json"),
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
			if (p[i + 1] === "/") i++; // skip slash after **
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
