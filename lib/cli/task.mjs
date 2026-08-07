import {
	createTask,
	listTasks,
	listActiveTasks,
	readTask,
	readTaskMarkdown,
	writeTaskMarkdown,
	updateTask,
	migrateLegacyTask,
	writeConcurrentProjection,
	findDuplicateTasks,
	setTaskTarget,
	setTaskYolo,
} from "../concurrency/task.mjs";
import {
	acquireWriteLease,
	releaseWriteLease,
	takeoverWriteLease,
	readLease,
	isLeaseExpired,
} from "../concurrency/lease.mjs";
import {
	createSession,
	attachSession,
	readSession,
	closeSession,
} from "../concurrency/session.mjs";
import { writeBinding } from "../concurrency/binding.mjs";
import { resolveWorktreeRoot, findWorkspaceRoot, canonicalizePath } from "../concurrency/paths.mjs";
import { isConcurrentMode } from "../concurrency/schema.mjs";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function requireWorkspace(cwd) {
	const root = findWorkspaceRoot(cwd);
	if (!root) throw new Error(`No Heli workspace found from ${cwd}`);
	return root;
}

function parseArgs(args) {
	const flags = {};
	const positional = [];
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === "--mode" && args[i + 1]) flags.mode = args[++i];
		else if (a === "--title" && args[i + 1]) flags.title = args[++i];
		else if (a === "--work-item" && args[i + 1]) flags.workItemKey = args[++i];
		else if (a === "--repo" && args[i + 1]) flags.repositoryId = args[++i];
		else if (a === "--worktree" && args[i + 1]) flags.worktreePath = args[++i];
		else if (a === "--id" && args[i + 1]) flags.id = args[++i];
		else if (a === "--allow-duplicate") flags.allowDuplicate = true;
		else if (a === "--confirm") flags.confirm = true;
		else if (a === "--session" && args[i + 1]) flags.sessionId = args[++i];
		else if (a === "--host" && args[i + 1]) flags.host = args[++i];
		else if (a === "--yolo") flags.yolo = true;
		else if (a.startsWith("--")) flags[a.slice(2)] = true;
		else positional.push(a);
	}
	return { flags, positional };
}

export function runTask(args) {
	const [sub, ...rest] = args;
	const { flags, positional } = parseArgs(rest);

	switch (sub) {
		case "create": {
			const taskId = positional[0] || flags.id;
			if (!taskId) {
				console.log("Usage: heli task create <task-id> [--title t] [--work-item k] [--repo r] [--worktree p] [--mode strict|yolo] [--allow-duplicate] [--reuse] [path]");
				return;
			}
			const cwd = positional[1] || process.cwd();
			const workspaceRoot = requireWorkspace(cwd);
			const worktreePath = flags.worktreePath || resolveWorktreeRoot(cwd);
			let task;
			try {
				task = createTask(workspaceRoot, {
					taskId,
					title: flags.title || taskId,
					workItemKey: flags.workItemKey || taskId,
					repositoryId: flags.repositoryId || "",
					worktreePath,
					mode: flags.yolo ? "yolo" : flags.mode || "strict",
					allowDuplicate: !!flags.allowDuplicate,
				});
			} catch (err) {
				if (err.code === "TASK_EXISTS" && flags.reuse && err.task) {
					console.log(`Task ${err.task.taskId} already exists — reusing (--reuse)`);
					console.log(`  title: ${err.task.title}`);
					console.log(`  status: ${err.task.status}`);
					console.log(`  fingerprint: ${err.task.source.fingerprint}`);
					return;
				}
				throw err;
			}
			writeConcurrentProjection(workspaceRoot);
			console.log(`Created task ${task.taskId}`);
			console.log(`  title: ${task.title}`);
			console.log(`  fingerprint: ${task.source.fingerprint}`);
			console.log(`  workspace mode: concurrent`);
			return;
		}
		case "list": {
			const cwd = positional[0] || process.cwd();
			const workspaceRoot = requireWorkspace(cwd);
			const tasks = listTasks(workspaceRoot);
			if (!tasks.length) {
				console.log(isConcurrentMode(workspaceRoot) ? "No tasks." : "No tasks (legacy mode).");
				return;
			}
			console.log(`Tasks: ${tasks.length}`);
			for (const t of tasks) {
				const lease = readLease(workspaceRoot, t.taskId);
				const writer =
					lease && !isLeaseExpired(lease) ? lease.sessionId : lease ? `stale:${lease.sessionId}` : "none";
				console.log(`- ${t.taskId}  status=${t.status}  mode=${t.mode}  writer=${writer}  repo=${t.target?.repositoryId || ""}`);
			}
			return;
		}
		case "show": {
			const taskId = positional[0];
			if (!taskId) {
				console.log("Usage: heli task show <task-id> [path]");
				return;
			}
			const cwd = positional[1] || process.cwd();
			const workspaceRoot = requireWorkspace(cwd);
			const task = readTask(workspaceRoot, taskId);
			if (!task) {
				console.log(`Task not found: ${taskId}`);
				return;
			}
			console.log(JSON.stringify(task, null, 2));
			const md = readTaskMarkdown(workspaceRoot, taskId);
			if (md.currentTaskMd) {
				console.log("\n--- current-task.md ---\n" + md.currentTaskMd);
			}
			const lease = readLease(workspaceRoot, taskId);
			if (lease) console.log("\nLease:", JSON.stringify(lease, null, 2));
			return;
		}
		case "migrate-legacy": {
			const taskId = flags.id || positional[0];
			if (!taskId) {
				console.log("Usage: heli task migrate-legacy --id <task-id> [path]");
				return;
			}
			const cwd = positional[0] && !flags.id ? positional[1] : positional[0] || process.cwd();
			const pathArg = positional.find((p) => p !== taskId) || process.cwd();
			const workspaceRoot = requireWorkspace(pathArg);
			const task = migrateLegacyTask(workspaceRoot, taskId, {
				title: flags.title,
				repositoryId: flags.repositoryId,
			});
			console.log(`Migrated legacy state into task ${task.taskId}`);
			console.log("Workspace mode: concurrent");
			return;
		}
		case "claim": {
			const taskId = positional[0];
			if (!taskId) {
				console.log("Usage: heli task claim <task-id> --mode write|review|observe [--session id] [--host h] [path]");
				return;
			}
			const mode = flags.mode || "write";
			const cwd = positional[1] || process.cwd();
			const workspaceRoot = requireWorkspace(cwd);
			const worktreePath = resolveWorktreeRoot(cwd);
			const task = readTask(workspaceRoot, taskId);
			if (!task) throw new Error(`task not found: ${taskId}`);

			let sessionId = flags.sessionId || process.env.HELI_SESSION_ID || null;
			let session = sessionId ? readSession(workspaceRoot, sessionId) : null;
			if (!session) {
				session = createSession(workspaceRoot, {
					sessionId: sessionId || undefined,
					host: flags.host || "cli",
					taskId,
					mode,
					worktreePath,
				});
				sessionId = session.sessionId;
			} else {
				session = attachSession(workspaceRoot, sessionId, taskId, { mode, worktreePath });
			}

			if (mode === "write") {
				// same-worktree second writer check via binding
				const lease = acquireWriteLease(workspaceRoot, {
					taskId,
					sessionId,
					worktreePath,
				});
				writeBinding(workspaceRoot, {
					worktreePath,
					taskId,
					sessionId,
					host: session.host,
					mode: "write",
				});
				console.log(`Claimed write lease on ${taskId}`);
				console.log(`  session: ${sessionId}`);
				console.log(`  lease: ${lease.leaseId}`);
				console.log(`  expires: ${lease.expiresAt}`);
			} else {
				writeBinding(workspaceRoot, {
					worktreePath,
					taskId,
					sessionId,
					host: session.host,
					mode,
				});
				console.log(`Attached session ${sessionId} to ${taskId} as ${mode}`);
			}
			if (!process.env.HELI_SESSION_ID) {
				console.log(`  export HELI_SESSION_ID=${sessionId}`);
			}
			writeConcurrentProjection(workspaceRoot);
			return;
		}
		case "release": {
			const taskId = positional[0];
			const cwd = positional[1] || process.cwd();
			const workspaceRoot = requireWorkspace(cwd);
			const sessionId = flags.sessionId || process.env.HELI_SESSION_ID || null;
			const force = !!flags.force || !!flags.confirm;
			if (!taskId) {
				// release from session binding
				if (!sessionId) throw new Error("provide task-id or HELI_SESSION_ID");
				const session = readSession(workspaceRoot, sessionId);
				if (!session?.taskId) throw new Error("session not bound to a task");
				releaseWriteLease(workspaceRoot, session.taskId, { sessionId, force: false });
				console.log(`Released write lease on ${session.taskId}`);
				return;
			}
			if (!sessionId && !force) {
				throw new Error(
					"release requires HELI_SESSION_ID / --session (owner) or --force for explicit admin cleanup",
				);
			}
			releaseWriteLease(workspaceRoot, taskId, { sessionId, force });
			console.log(`Released write lease on ${taskId}`);
			return;
		}
		case "provenance": {
			const taskId = positional[0];
			if (!taskId) {
				console.log("Usage: heli task provenance <task-id> [path]");
				return;
			}
			const cwd = positional[1] || process.cwd();
			const workspaceRoot = requireWorkspace(cwd);
			const task = readTask(workspaceRoot, taskId);
			if (!task) throw new Error(`task not found: ${taskId}`);
			console.log(`Task ${task.taskId}  status=${task.status}  revision=${task.revision}`);
			console.log(`  created: ${task.createdAt}  updated: ${task.updatedAt}`);
			if (task.target?.worktreePath) console.log(`  worktree: ${task.target.worktreePath}`);
			const lease = readLease(workspaceRoot, taskId);
			if (lease) {
				const state = lease.invalid ? "invalid" : isLeaseExpired(lease) ? "stale" : "active";
				console.log(`  lease: ${state}  owner=${lease.sessionId || "?"}  expires=${lease.expiresAt || "?"}`);
			} else {
				console.log("  lease: none");
			}
			const eventsPath = join(workspaceRoot, ".heli-harness", "tasks", taskId, "events.jsonl");
			if (!existsSync(eventsPath)) {
				console.log("  events: none recorded");
				return;
			}
			console.log("  events:");
			for (const line of readFileSync(eventsPath, "utf8").split("\n").filter(Boolean)) {
				let evt;
				try {
					evt = JSON.parse(line);
				} catch {
					console.log(`    (unparseable event line)`);
					continue;
				}
				const who = evt.sessionId || "";
				const extra = evt.expiresAt ? `  expires=${evt.expiresAt}` : "";
				console.log(`    ${evt.at || "?"}  ${evt.type || "?"}${who ? `  session=${who}` : ""}${extra}`);
			}
			return;
		}
		case "complete": {
			const taskId = positional[0];
			if (!taskId) {
				console.log("Usage: heli task complete <task-id> [--session id] [path]");
				return;
			}
			const cwd = positional[1] || process.cwd();
			const workspaceRoot = requireWorkspace(cwd);
			const sessionId = flags.sessionId || process.env.HELI_SESSION_ID || null;
			const lease = readLease(workspaceRoot, taskId);
			if (lease && !isLeaseExpired(lease) && sessionId && lease.sessionId !== sessionId) {
				throw new Error(
					`task ${taskId} has an active write lease owned by ${lease.sessionId} — complete from that session, or heli task takeover ${taskId} --confirm first`,
				);
			}
			const task = updateTask(workspaceRoot, taskId, (t) => ({ ...t, status: "complete" }), { sessionId });
			const md = readTaskMarkdown(workspaceRoot, taskId);
			if (md.currentTaskMd && /^Current status:.*$/m.test(md.currentTaskMd)) {
				writeTaskMarkdown(workspaceRoot, taskId, {
					currentTaskMd: md.currentTaskMd.replace(/^Current status:.*$/m, "Current status: complete"),
				});
			}
			if (lease && sessionId && lease.sessionId === sessionId) {
				releaseWriteLease(workspaceRoot, taskId, { sessionId, force: false });
				console.log(`Released write lease on ${taskId}`);
			}
			writeConcurrentProjection(workspaceRoot);
			console.log(`Task ${taskId} marked complete (revision ${task.revision})`);
			// sync.auto: best-effort push of the portable context; never fails the
			// completion itself (offline / secret findings just warn).
			const syncStatePathForAuto = join(workspaceRoot, ".heli-harness", "state", "sync.json");
			if (existsSync(syncStatePathForAuto)) {
				try {
					const syncState = JSON.parse(readFileSync(syncStatePathForAuto, "utf8"));
					if (syncState?.auto && syncState?.workspaceId) {
						return import("./cloud.mjs")
							.then(({ runCloud }) => runCloud("push", [workspaceRoot]))
							.catch((error) => console.warn(`sync.auto: push skipped (${error.message})`));
					}
				} catch {
					// unreadable sync.json — auto-push silently unavailable
				}
			}
			return;
		}
		case "takeover": {
			const taskId = positional[0];
			if (!taskId) {
				console.log("Usage: heli task takeover <task-id> --confirm [--session id] [path]");
				return;
			}
			if (!flags.confirm) {
				const cwd = positional[1] || process.cwd();
				const workspaceRoot = requireWorkspace(cwd);
				const lease = readLease(workspaceRoot, taskId);
				console.log("Takeover requires --confirm.");
				if (lease) console.log(JSON.stringify(lease, null, 2));
				return;
			}
			const cwd = positional[1] || process.cwd();
			const workspaceRoot = requireWorkspace(cwd);
			const worktreePath = resolveWorktreeRoot(cwd);
			let sessionId = flags.sessionId || process.env.HELI_SESSION_ID || null;
			if (!sessionId) {
				const session = createSession(workspaceRoot, {
					host: flags.host || "cli",
					taskId,
					mode: "write",
					worktreePath,
				});
				sessionId = session.sessionId;
			} else {
				attachSession(workspaceRoot, sessionId, taskId, { mode: "write", worktreePath });
			}
			const lease = takeoverWriteLease(workspaceRoot, {
				taskId,
				sessionId,
				worktreePath,
				confirm: true,
			});
			writeBinding(workspaceRoot, { worktreePath, taskId, sessionId, host: "cli", mode: "write" });
			console.log(`Took over write lease on ${taskId}`);
			console.log(`  session: ${sessionId}`);
			console.log(`  lease: ${lease.leaseId}`);
			console.log(`  export HELI_SESSION_ID=${sessionId}`);
			return;
		}
		default:
			console.log(`Usage:
  heli task create <task-id> [--reuse] [options] [path]
  heli task list [path]
  heli task show <task-id> [path]
  heli task migrate-legacy --id <task-id> [path]
  heli task claim <task-id> --mode write|review|observe [path]
  heli task release [<task-id>] [path]
  heli task complete <task-id> [path]
  heli task provenance <task-id> [path]
  heli task takeover <task-id> --confirm [path]`);
	}
}
