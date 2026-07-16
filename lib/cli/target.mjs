import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findWorkspaceRoot, resolveWorktreeRoot } from "../concurrency/paths.mjs";
import { isConcurrentMode } from "../concurrency/schema.mjs";
import { resolveExecutionContext } from "../concurrency/resolve.mjs";
import { setTaskTarget, readTask } from "../concurrency/task.mjs";
import { writeJsonAtomic } from "../concurrency/fs-atomic.mjs";

function readJson(path) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
}

function paths(cwd) {
	const root = findWorkspaceRoot(cwd) || cwd;
	return {
		workspaceRoot: root,
		indexPath: join(root, ".heli-harness", "workspace", "index.json"),
		targetPath: join(root, ".heli-harness", "workspace", "target.json"),
	};
}

export function listRepos(cwd) {
	const { indexPath } = paths(cwd);
	const index = existsSync(indexPath) ? readJson(indexPath) : null;
	if (!index || !Array.isArray(index.repos)) {
		return { configured: false };
	}
	return { configured: true, repos: index.repos };
}

export function showTarget(cwd) {
	const { indexPath, targetPath, workspaceRoot } = paths(cwd);
	const index = existsSync(indexPath) ? readJson(indexPath) : null;
	const concurrent = isConcurrentMode(workspaceRoot);
	if (concurrent) {
		const ctx = resolveExecutionContext({ cwd, host: "cli", createIfMissing: false });
		if (ctx.task?.target) {
			return {
				indexConfigured: !!index,
				concurrent: true,
				source: "task",
				taskId: ctx.taskId,
				targetRepo: ctx.task.target.repositoryId || "",
				targetGitRoot: ctx.task.target.repositoryPath || ctx.task.target.worktreePath || "",
				writesAllowedUnder: ctx.task.target.repositoryPath || ctx.task.target.worktreePath || "",
				activeProfile: "",
			};
		}
		return {
			indexConfigured: !!index,
			concurrent: true,
			source: "unbound",
			taskId: ctx.taskId,
			targetRepo: "",
			targetGitRoot: "",
			writesAllowedUnder: "",
			activeProfile: "",
		};
	}
	const target = existsSync(targetPath) ? readJson(targetPath) : null;
	return {
		indexConfigured: !!index,
		concurrent: false,
		source: "workspace",
		targetRepo: target?.targetRepo || "",
		targetGitRoot: target?.targetGitRoot || "",
		writesAllowedUnder: target?.writesAllowedUnder || "",
		activeProfile: target?.activeProfile || "",
	};
}

export function setTarget(cwd, selector, { confirm = false } = {}) {
	const { indexPath, targetPath, workspaceRoot } = paths(cwd);
	const index = existsSync(indexPath) ? readJson(indexPath) : null;
	if (!index || !Array.isArray(index.repos)) {
		throw new Error("Workspace index is not configured — create .heli-harness/workspace/index.json to track repos");
	}
	const selectorLower = selector.toLowerCase();
	const match = index.repos.find((repo) =>
		[repo.name, repo.path, repo.gitRoot].some((value) => String(value || "").toLowerCase() === selectorLower),
	);
	if (!match) {
		throw new Error(`No workspace repo matched "${selector}"`);
	}

	const gitRoot = match.gitRoot || match.path;

	if (isConcurrentMode(workspaceRoot)) {
		const ctx = resolveExecutionContext({ cwd, host: "cli", createIfMissing: false });
		if (!ctx.taskId) {
			throw new Error("concurrent mode: bind a session to a task before setting target (heli session attach <task>)");
		}
		const task = setTaskTarget(
			workspaceRoot,
			ctx.taskId,
			{
				repositoryId: match.name,
				repositoryPath: gitRoot,
				worktreePath: resolveWorktreeRoot(cwd),
			},
			{ sessionId: ctx.sessionId },
		);
		// non-authoritative compatibility summary only
		writeJsonAtomic(targetPath, {
			schemaVersion: 1,
			targetRepo: match.name,
			targetGitRoot: gitRoot,
			writesAllowedUnder: gitRoot,
			activeProfile: match.profile || "",
			selectedAt: new Date().toISOString(),
			selectedBy: "heli-cli-concurrent-projection",
			reason: `projection of task ${ctx.taskId}`,
			note: "Not authoritative in concurrent mode; task target is source of truth.",
		});
		return { needsConfirm: false, target: { targetRepo: match.name, targetGitRoot: gitRoot }, task, concurrent: true };
	}

	const existingTarget = existsSync(targetPath) ? readJson(targetPath) : null;
	const currentRepo = existingTarget?.targetRepo || "";
	if (currentRepo && currentRepo !== match.name && !confirm) {
		return { needsConfirm: true, currentRepo, newRepo: match.name };
	}

	const newTarget = {
		schemaVersion: 1,
		targetRepo: match.name,
		targetGitRoot: gitRoot,
		writesAllowedUnder: gitRoot,
		activeProfile: match.profile || "",
		selectedAt: new Date().toISOString(),
		selectedBy: "heli-cli",
		reason: selector,
	};
	writeFileSync(targetPath, JSON.stringify(newTarget, null, 2) + "\n");
	return { needsConfirm: false, target: newTarget };
}

export function clearTarget(cwd) {
	const { targetPath, workspaceRoot } = paths(cwd);
	if (isConcurrentMode(workspaceRoot)) {
		const ctx = resolveExecutionContext({ cwd, host: "cli", createIfMissing: false });
		if (ctx.taskId) {
			setTaskTarget(
				workspaceRoot,
				ctx.taskId,
				{ repositoryId: "", repositoryPath: "", worktreePath: ctx.worktreeRoot || "" },
				{ sessionId: ctx.sessionId },
			);
		}
	}
	const cleared = {
		schemaVersion: 1,
		targetRepo: "",
		targetGitRoot: "",
		writesAllowedUnder: "",
		activeProfile: "",
		selectedAt: new Date().toISOString(),
		selectedBy: "heli-cli",
		reason: "cleared",
	};
	writeFileSync(targetPath, JSON.stringify(cleared, null, 2) + "\n");
	return cleared;
}

export function runTarget(args) {
	const [subcommand, ...rest] = args;
	const confirm = rest.includes("--confirm");
	const positional = rest.filter((arg) => arg !== "--confirm");

	switch (subcommand || "show") {
		case "list": {
			const cwd = positional[0] || process.cwd();
			const result = listRepos(cwd);
			if (!result.configured) {
				console.log("Workspace index is not configured");
				console.log("Create .heli-harness/workspace/index.json to track repos");
				return;
			}
			console.log(`Known repos: ${result.repos.length}`);
			for (const repo of result.repos) {
				const suffix = repo.defaultTarget ? "; default" : "";
				console.log(
					`${repo.name || "(unnamed)"} -> path=${repo.path || "missing"}; gitRoot=${repo.gitRoot || "missing"}; profile=${repo.profile || "missing"}${suffix}`,
				);
			}
			return;
		}
		case "show": {
			const cwd = positional[0] || process.cwd();
			const result = showTarget(cwd);
			console.log(result.indexConfigured ? "Workspace index: detected" : "Workspace index: not configured");
			if (result.concurrent) {
				console.log(`Mode: concurrent (task-authoritative)`);
				console.log(`Bound task: ${result.taskId || "unbound"}`);
				console.log(`Target source: ${result.source}`);
			}
			console.log(`Target repo: ${result.targetRepo || "not selected"}`);
			console.log(`Target git root: ${result.targetGitRoot || "not selected"}`);
			console.log(`Writes allowed under: ${result.writesAllowedUnder || "not selected"}`);
			console.log(`Active profile: ${result.activeProfile || "not selected"}`);
			console.log(
				"Usage: heli target list [path] | heli target show [path] | heli target set <repo> [--confirm] [path] | heli target clear [path]",
			);
			return;
		}
		case "set": {
			const [selector, path] = positional;
			if (!selector) {
				console.log("Usage: heli target set <repo-name-or-path> [--confirm] [path]");
				return;
			}
			const cwd = path || process.cwd();
			const result = setTarget(cwd, selector, { confirm });
			if (result.needsConfirm) {
				console.log(
					`Target mismatch: the active target is "${result.currentRepo}", you're about to switch to "${result.newRepo}".`,
				);
				console.log(
					`Re-run with --confirm to proceed: heli target set ${selector} --confirm${path ? ` ${path}` : ""}`,
				);
				return;
			}
			if (result.concurrent) console.log(`(concurrent) updated task ${result.task.taskId} target`);
			console.log(`Target repo set: ${result.target.targetRepo}`);
			console.log(`Target git root: ${result.target.targetGitRoot}`);
			return;
		}
		case "clear": {
			const cwd = positional[0] || process.cwd();
			clearTarget(cwd);
			console.log("Target repo cleared");
			return;
		}
		default:
			console.log("Usage: heli target list [path] | show [path] | set <repo> [--confirm] [path] | clear [path]");
	}
}
