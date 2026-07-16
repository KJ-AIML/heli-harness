import {
	createSession,
	attachSession,
	readSession,
	listSessions,
	listActiveSessions,
	closeSession,
	setSessionYolo,
} from "../concurrency/session.mjs";
import {
	acquireWriteLease,
	releaseWriteLease,
	readLease,
	isLeaseExpired,
	sessionHoldsWriteLease,
} from "../concurrency/lease.mjs";
import { writeBinding, readBinding, clearBindingSession } from "../concurrency/binding.mjs";
import { readTask, writeConcurrentProjection } from "../concurrency/task.mjs";
import { findWorkspaceRoot, resolveWorktreeRoot } from "../concurrency/paths.mjs";
import { resolveExecutionContext } from "../concurrency/resolve.mjs";
import { isConcurrentMode } from "../concurrency/schema.mjs";

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
		if (a === "--task" && args[i + 1]) flags.task = args[++i];
		else if (a === "--mode" && args[i + 1]) flags.mode = args[++i];
		else if (a === "--host" && args[i + 1]) flags.host = args[++i];
		else if (a === "--session" && args[i + 1]) flags.sessionId = args[++i];
		else if (a === "--yolo") flags.yolo = true;
		else if (a.startsWith("--")) flags[a.slice(2)] = true;
		else positional.push(a);
	}
	return { flags, positional };
}

export function runSession(args) {
	const [sub, ...rest] = args;
	const { flags, positional } = parseArgs(rest);

	switch (sub || "status") {
		case "start": {
			const cwd = positional[0] || process.cwd();
			const workspaceRoot = requireWorkspace(cwd);
			const worktreePath = resolveWorktreeRoot(cwd);
			const mode = flags.mode || (flags.task ? "write" : "observe");
			const session = createSession(workspaceRoot, {
				sessionId: flags.sessionId || process.env.HELI_SESSION_ID || undefined,
				host: flags.host || "cli",
				taskId: flags.task || null,
				mode,
				worktreePath,
			});
			if (flags.yolo) setSessionYolo(workspaceRoot, session.sessionId, true);
			if (flags.task) {
				attachSession(workspaceRoot, session.sessionId, flags.task, { mode, worktreePath });
				if (mode === "write") {
					acquireWriteLease(workspaceRoot, {
						taskId: flags.task,
						sessionId: session.sessionId,
						worktreePath,
					});
				}
				writeBinding(workspaceRoot, {
					worktreePath,
					taskId: flags.task,
					sessionId: session.sessionId,
					host: session.host,
					mode,
				});
			} else {
				writeBinding(workspaceRoot, {
					worktreePath,
					sessionId: session.sessionId,
					host: session.host,
					mode,
				});
			}
			console.log(`Session started: ${session.sessionId}`);
			console.log(`  host: ${session.host}`);
			console.log(`  task: ${flags.task || "unbound"}`);
			console.log(`  mode: ${mode}`);
			console.log(`  worktree: ${worktreePath}`);
			console.log(`  export HELI_SESSION_ID=${session.sessionId}`);
			return;
		}
		case "attach": {
			const taskId = positional[0] || flags.task;
			if (!taskId) {
				console.log("Usage: heli session attach <task-id> [--mode write|review|observe] [path]");
				return;
			}
			const cwd = positional[1] || process.cwd();
			const workspaceRoot = requireWorkspace(cwd);
			const worktreePath = resolveWorktreeRoot(cwd);
			const mode = flags.mode || "write";
			let sessionId = flags.sessionId || process.env.HELI_SESSION_ID || null;
			let session = sessionId ? readSession(workspaceRoot, sessionId) : null;
			if (!session) {
				session = createSession(workspaceRoot, {
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
				acquireWriteLease(workspaceRoot, { taskId, sessionId, worktreePath });
			}
			writeBinding(workspaceRoot, {
				worktreePath,
				taskId,
				sessionId,
				host: session.host,
				mode,
			});
			if (flags.yolo) setSessionYolo(workspaceRoot, sessionId, true);
			writeConcurrentProjection(workspaceRoot);
			console.log(`Session ${sessionId} attached to ${taskId} as ${mode}`);
			console.log(`  export HELI_SESSION_ID=${sessionId}`);
			return;
		}
		case "status": {
			const cwd = positional[0] || process.cwd();
			const ctx = resolveExecutionContext({
				cwd,
				host: "cli",
				createIfMissing: false,
			});
			if (!ctx.workspaceRoot) {
				console.log(`No Heli workspace from ${cwd}`);
				return;
			}
			console.log(`Workspace mode: ${ctx.concurrentMode ? "concurrent" : "legacy"}`);
			console.log(`Workspace root: ${ctx.workspaceRoot}`);
			console.log(`Worktree: ${ctx.worktreeRoot}`);
			console.log(`Session: ${ctx.sessionId || "none"} (${ctx.identitySource || "n/a"})`);
			console.log(`Task: ${ctx.taskId || "unbound"}`);
			console.log(`Mode: ${ctx.mode || "n/a"}`);
			console.log(`Target: ${ctx.target?.targetRepo || "n/a"} (${ctx.target?.source || ""})`);
			console.log(`Lease: ${ctx.lease ? (ctx.lease.stale ? "stale" : "active") : "none"}`);
			if (ctx.lease) console.log(`  owner: ${ctx.lease.sessionId} expires: ${ctx.lease.expiresAt}`);
			console.log(`YOLO: ${ctx.yolo?.active ? ctx.yolo.source : "strict"}`);
			return;
		}
		case "list": {
			const cwd = positional[0] || process.cwd();
			const workspaceRoot = requireWorkspace(cwd);
			const sessions = listSessions(workspaceRoot);
			if (!sessions.length) {
				console.log("No sessions.");
				return;
			}
			for (const s of sessions) {
				console.log(
					`- ${s.sessionId}  status=${s.status}  task=${s.taskId || "-"}  mode=${s.mode}  host=${s.host}  wt=${s.worktreePath || ""}`,
				);
			}
			return;
		}
		case "close": {
			const cwd = positional[0] || process.cwd();
			const workspaceRoot = requireWorkspace(cwd);
			const sessionId = flags.sessionId || process.env.HELI_SESSION_ID;
			if (!sessionId) throw new Error("set HELI_SESSION_ID or pass --session");
			const session = readSession(workspaceRoot, sessionId);
			if (session?.taskId && session.mode === "write") {
				try {
					releaseWriteLease(workspaceRoot, session.taskId, { sessionId });
				} catch {
					/* if not owner, leave lease */
				}
			}
			if (session?.worktreePath) clearBindingSession(workspaceRoot, session.worktreePath, sessionId);
			closeSession(workspaceRoot, sessionId);
			writeConcurrentProjection(workspaceRoot);
			console.log(`Closed session ${sessionId}`);
			return;
		}
		default:
			console.log(`Usage:
  heli session start [--task id] [--mode write|review|observe] [path]
  heli session attach <task-id> [--mode ...] [path]
  heli session status [path]
  heli session list [path]
  heli session close [path]`);
	}
}
