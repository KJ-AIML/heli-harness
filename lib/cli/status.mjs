import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveExecutionContext } from "../concurrency/resolve.mjs";
import { listActiveTasks, listTasks } from "../concurrency/task.mjs";
import { listActiveSessions } from "../concurrency/session.mjs";
import { readLease, isLeaseExpired } from "../concurrency/lease.mjs";
import { isConcurrentMode, readWorkspaceSchema } from "../concurrency/schema.mjs";
import { findWorkspaceRoot } from "../concurrency/paths.mjs";

function readJson(path) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
}

function field(text, label) {
	const match = new RegExp(`^${label}:[ \\t]*(.*)$`, "m").exec(text);
	return match ? match[1].trim() : "";
}

export function status(cwd) {
	const heliDir = join(cwd, ".heli-harness");
	const workspaceRoot = findWorkspaceRoot(cwd) || (existsSync(heliDir) ? cwd : null);
	if (!workspaceRoot) {
		return { installed: false };
	}
	const root = workspaceRoot;
	const manifest = readJson(join(root, ".heli-harness", "manifest.json"));
	const target = readJson(join(root, ".heli-harness", "workspace", "target.json"));
	const index = readJson(join(root, ".heli-harness", "workspace", "index.json"));
	const schema = readWorkspaceSchema(root);
	const concurrent = schema.mode === "concurrent";

	const base = {
		installed: true,
		version: manifest?.version || "unknown",
		workspaceRoot: root,
		mode: concurrent ? "concurrent" : "legacy",
		targetRepo: target?.targetRepo || "",
		repoCount: Array.isArray(index?.repos) ? index.repos.length : 0,
		indexConfigured: !!index,
	};

	if (concurrent) {
		const tasks = listTasks(root);
		const active = listActiveTasks(root);
		const sessions = listActiveSessions(root);
		let writeLeases = 0;
		const taskSummaries = active.map((t) => {
			const lease = readLease(root, t.taskId);
			const activeLease = lease && !isLeaseExpired(lease);
			if (activeLease) writeLeases++;
			return {
				taskId: t.taskId,
				status: t.status,
				mode: t.mode,
				writer: activeLease ? lease.sessionId : "none",
				worktree: t.target?.worktreePath || "",
				repo: t.target?.repositoryId || "",
			};
		});
		return {
			...base,
			activeTasks: active.length,
			totalTasks: tasks.length,
			activeSessions: sessions.length,
			writeLeases,
			taskSummaries,
		};
	}

	const taskPath = join(root, ".heli-harness", "state", "current-task.md");
	const taskText = existsSync(taskPath) ? readFileSync(taskPath, "utf8") : "";
	return {
		...base,
		taskStatus: taskText ? field(taskText, "Current status") : "",
		failedAttempts: taskText ? field(taskText, "Failed attempts count") : "",
	};
}

export function runStatus(args) {
	const cwd = args[0] || process.cwd();
	const result = status(cwd);
	if (!result.installed) {
		console.log(`No Heli-Harness install found at ${cwd}`);
		return;
	}
	console.log(`Heli-Harness version: ${result.version}`);
	console.log(`Workspace mode: ${result.mode}`);
	console.log(`Workspace root: ${result.workspaceRoot}`);
	console.log(`Target repo: ${result.targetRepo || "not selected"}`);
	console.log(
		result.indexConfigured ? `Registered repos: ${result.repoCount}` : "Workspace index: not configured",
	);

	if (result.mode === "concurrent") {
		console.log(`Active tasks: ${result.activeTasks}`);
		console.log(`Active sessions: ${result.activeSessions}`);
		console.log(`Write leases: ${result.writeLeases}`);
		for (const t of result.taskSummaries || []) {
			console.log("");
			console.log(t.taskId);
			console.log(`  status: ${t.status}`);
			console.log(`  writer: ${t.writer}`);
			console.log(`  worktree: ${t.worktree || "n/a"}`);
			console.log(`  mode: ${t.mode}`);
			console.log(`  repo: ${t.repo || "n/a"}`);
		}
		const ctx = resolveExecutionContext({ cwd, host: "cli", createIfMissing: false });
		if (ctx.sessionId) {
			console.log("");
			console.log(`This cwd session: ${ctx.sessionId} task=${ctx.taskId || "unbound"} mode=${ctx.mode || "n/a"}`);
		}
		console.log("Current task: see active tasks above (concurrent mode)");
		return;
	}

	if (result.taskStatus) {
		console.log(`Current task status: ${result.taskStatus} (failed attempts: ${result.failedAttempts || "0"})`);
	} else {
		console.log("Current task: none recorded");
	}
}
