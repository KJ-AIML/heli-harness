import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveExecutionContext } from "../concurrency/resolve.mjs";
import { listActiveTasks, listTasks } from "../concurrency/task.mjs";
import { listActiveSessions, readSession } from "../concurrency/session.mjs";
import { readLease, isLeaseExpired } from "../concurrency/lease.mjs";
import { isConcurrentMode, readWorkspaceSchema } from "../concurrency/schema.mjs";
import { findWorkspaceRoot, canonicalizePath } from "../concurrency/paths.mjs";
import { listAllBindings } from "../concurrency/binding.mjs";

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

function formatLeaseExpiry(lease) {
	if (!lease?.expiresAt) return "n/a";
	const exp = Date.parse(lease.expiresAt);
	if (Number.isNaN(exp)) return lease.expiresAt;
	const ms = exp - Date.now();
	if (ms <= 0) return `expired (${lease.expiresAt})`;
	const h = Math.floor(ms / 3600_000);
	const m = Math.floor((ms % 3600_000) / 60_000);
	return `expires in ${h}h ${m}m (${lease.expiresAt})`;
}

/**
 * Resolve the live worktree for a task using authoritative sources:
 * active write lease → writer session → worktree binding → task metadata → unknown
 */
export function resolveTaskWorktreeProjection(workspaceRoot, task, sessions = null) {
	const warnings = [];
	const allSessions = sessions || listActiveSessions(workspaceRoot);
	const lease = readLease(workspaceRoot, task.taskId);
	const activeLease = lease && !lease.invalid && !isLeaseExpired(lease) ? lease : null;

	let worktree = "";
	let source = "unknown";
	let writer = "none";
	let leaseStatus = "none";

	if (activeLease) {
		writer = activeLease.sessionId || "unknown";
		leaseStatus = `active, ${formatLeaseExpiry(activeLease)}`;
		if (activeLease.worktreePath) {
			worktree = canonicalizePath(activeLease.worktreePath);
			source = "write-lease";
		}
		const writerSession = readSession(workspaceRoot, activeLease.sessionId);
		if (writerSession?.worktreePath) {
			const sessWt = canonicalizePath(writerSession.worktreePath);
			if (worktree && sessWt && worktree !== sessWt) {
				warnings.push(
					`writer session worktree (${sessWt}) differs from lease worktree (${worktree})`,
				);
			}
			if (!worktree && sessWt) {
				worktree = sessWt;
				source = "writer-session";
			}
		}
	} else if (lease?.invalid) {
		leaseStatus = `malformed (${lease.reason || "invalid"})`;
		warnings.push(`malformed lease for ${task.taskId}`);
	} else if (lease && isLeaseExpired(lease)) {
		leaseStatus = `stale, expired ${lease.expiresAt}`;
		writer = lease.sessionId || "none";
		if (lease.worktreePath) {
			worktree = canonicalizePath(lease.worktreePath);
			source = "stale-lease";
			warnings.push("lease is stale — worktree shown from expired lease");
		}
	}

	const reviewers = allSessions.filter(
		(s) =>
			s.taskId === task.taskId &&
			s.status === "active" &&
			(s.mode === "review" || s.mode === "observe"),
	);
	const writerSessions = allSessions.filter(
		(s) => s.taskId === task.taskId && s.status === "active" && s.mode === "write",
	);

	if (!worktree) {
		const writerSess = writerSessions[0] || allSessions.find((s) => s.sessionId === writer);
		if (writerSess?.worktreePath) {
			worktree = canonicalizePath(writerSess.worktreePath);
			source = source === "unknown" ? "active-session" : source;
		}
	}

	if (!worktree) {
		try {
			const bindings = listAllBindings(workspaceRoot);
			const hit = bindings.find((b) => b.taskId === task.taskId && b.canonicalWorktreePath);
			if (hit) {
				worktree = hit.canonicalWorktreePath;
				source = "binding";
			}
		} catch {
			/* ignore */
		}
	}

	const metaWt = task.target?.worktreePath ? canonicalizePath(task.target.worktreePath) : "";
	if (!worktree && metaWt) {
		worktree = metaWt;
		source = "task-metadata";
	} else if (worktree && metaWt && worktree !== metaWt && activeLease) {
		warnings.push(`task metadata worktree (${metaWt}) differs from live ${source} (${worktree})`);
	}

	const yolo =
		task.yolo?.enabled === true ||
		task.mode === "yolo" ||
		task.mode === "unguarded" ||
		task.mode === "dangerous"
			? "yolo"
			: "strict";

	return {
		taskId: task.taskId,
		status: task.status,
		mode: yolo === "yolo" ? task.mode || "yolo" : task.mode || "strict",
		yoloMode: yolo,
		writer,
		worktree: worktree || "unknown",
		worktreeSource: source,
		repo: task.target?.repositoryId || "",
		branch: task.target?.branch || "",
		leaseStatus,
		reviewerCount: reviewers.length,
		observerCount: allSessions.filter(
			(s) => s.taskId === task.taskId && s.status === "active" && s.mode === "observe",
		).length,
		warnings,
	};
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
		indexConfigured: !!index && Array.isArray(index.repos),
	};

	if (concurrent) {
		const tasks = listTasks(root);
		const active = listActiveTasks(root);
		const sessions = listActiveSessions(root);
		let writeLeases = 0;
		const taskSummaries = active.map((t) => {
			const proj = resolveTaskWorktreeProjection(root, t, sessions);
			const lease = readLease(root, t.taskId);
			if (lease && !lease.invalid && !isLeaseExpired(lease)) writeLeases++;
			return proj;
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
			console.log(`  worktree: ${t.worktree || "unknown"}`);
			console.log(`  worktree source: ${t.worktreeSource || "unknown"}`);
			console.log(`  lease: ${t.leaseStatus || "none"}`);
			console.log(`  target: ${t.repo || "n/a"}`);
			if (t.branch) console.log(`  branch: ${t.branch}`);
			console.log(`  mode: ${t.mode} (${t.yoloMode || "strict"})`);
			console.log(`  reviewers: ${t.reviewerCount ?? 0}  observers: ${t.observerCount ?? 0}`);
			for (const w of t.warnings || []) {
				console.log(`  warning: ${w}`);
			}
		}
		const ctx = resolveExecutionContext({ cwd, host: "cli", createIfMissing: false });
		if (ctx.sessionId) {
			console.log("");
			console.log(
				`This cwd session: ${ctx.sessionId} task=${ctx.taskId || "unbound"} mode=${ctx.mode || "n/a"} worktree=${ctx.worktreeRoot || "n/a"}`,
			);
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
