import {
	createSession,
	attachSession,
	readSession,
	listSessions,
	closeSession,
	setSessionYolo,
} from "../concurrency/session.mjs";
import { acquireWriteLease, releaseWriteLease } from "../concurrency/lease.mjs";
import { transferWriteAuthority, effectiveSessionAuthority } from "../concurrency/authority.mjs";
import { writeBinding, clearBindingSession } from "../concurrency/binding.mjs";
import { writeConcurrentProjection } from "../concurrency/task.mjs";
import { findWorkspaceRoot, resolveWorktreeRoot } from "../concurrency/paths.mjs";
import { resolveExecutionContext } from "../concurrency/resolve.mjs";
import { protocolOk } from "../protocol/result.mjs";
import { wantsJson, stripOutputFlags, printProtocolResult } from "./output.mjs";

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
		else if (a === "--parent" && args[i + 1]) flags.parentSessionId = args[++i];
		else if (a === "--role" && args[i + 1]) flags.role = args[++i];
		else if (a === "--delegate" && args[i + 1]) flags.delegate = args[++i];
		else if (a === "--yolo") flags.yolo = true;
		else if (a.startsWith("--")) flags[a.slice(2)] = true;
		else positional.push(a);
	}
	return { flags, positional };
}

function emit(json, command, data, human) {
	const result = protocolOk(command, data);
	if (json) printProtocolResult(result);
	else human?.(data);
	return result;
}

export function runSession(args) {
	const json = wantsJson(args);
	const clean = stripOutputFlags(args);
	const [sub, ...rest] = clean;
	const { flags, positional } = parseArgs(rest);

	switch (sub || "status") {
		case "start": {
			const cwd = positional[0] || process.cwd();
			const workspaceRoot = requireWorkspace(cwd);
			const worktreePath = resolveWorktreeRoot(cwd);
			const mode = flags.mode || (flags.parentSessionId ? "observe" : flags.task ? "write" : "observe");
			let session = createSession(workspaceRoot, {
				sessionId: flags.sessionId || undefined,
				host: flags.host || "cli",
				taskId: flags.task || null,
				mode,
				worktreePath,
				parentSessionId: flags.parentSessionId || null,
				role: flags.role || null,
				delegation: { mode: flags.delegate || (flags.parentSessionId ? "observe" : mode) },
			});
			if (flags.yolo) session = setSessionYolo(workspaceRoot, session.sessionId, true);
			if (flags.task) {
				session = attachSession(workspaceRoot, session.sessionId, flags.task, { mode, worktreePath });
				if (mode === "write") acquireWriteLease(workspaceRoot, { taskId: flags.task, sessionId: session.sessionId, worktreePath });
			}
			writeBinding(workspaceRoot, { worktreePath, taskId: session.taskId, sessionId: session.sessionId, host: session.host, mode: session.mode });
			return emit(json, "session.start", { session, authority: effectiveSessionAuthority(workspaceRoot, session.sessionId) }, (data) => {
				console.log(`Session started: ${data.session.sessionId}`);
				console.log(`  host: ${data.session.host}`);
				console.log(`  task: ${data.session.taskId || "unbound"}`);
				console.log(`  mode: ${data.session.mode}`);
				console.log(`  parent: ${data.session.parentSessionId || "none"}`);
				console.log(`  role: ${data.session.role}`);
				console.log(`  export HELI_SESSION_ID=${data.session.sessionId}`);
			});
		}
		case "attach": {
			const taskId = positional[0] || flags.task;
			if (!taskId) throw new Error("Usage: heli session attach <task-id> [--mode write|review|observe] [path]");
			const cwd = positional[1] || process.cwd();
			const workspaceRoot = requireWorkspace(cwd);
			const worktreePath = resolveWorktreeRoot(cwd);
			const mode = flags.mode || "write";
			let sessionId = flags.sessionId || process.env.HELI_SESSION_ID || null;
			let session = sessionId ? readSession(workspaceRoot, sessionId) : null;
			if (!session) {
				session = createSession(workspaceRoot, { host: flags.host || "cli", taskId, mode, worktreePath });
				sessionId = session.sessionId;
			} else session = attachSession(workspaceRoot, sessionId, taskId, { mode, worktreePath });
			if (mode === "write") acquireWriteLease(workspaceRoot, { taskId, sessionId, worktreePath });
			writeBinding(workspaceRoot, { worktreePath, taskId, sessionId, host: session.host, mode });
			if (flags.yolo) session = setSessionYolo(workspaceRoot, sessionId, true);
			writeConcurrentProjection(workspaceRoot);
			return emit(json, "session.attach", { session, authority: effectiveSessionAuthority(workspaceRoot, sessionId) }, (data) => {
				console.log(`Session ${sessionId} attached to ${taskId} as ${mode}`);
				console.log(`  export HELI_SESSION_ID=${sessionId}`);
			});
		}
		case "transfer-write": {
			const childSessionId = positional[0];
			if (!childSessionId) throw new Error("Usage: heli session transfer-write <child-session-id> [path] --session <parent-session-id>");
			const cwd = positional[1] || process.cwd();
			const workspaceRoot = requireWorkspace(cwd);
			const parentSessionId = flags.sessionId || process.env.HELI_SESSION_ID;
			if (!parentSessionId) throw new Error("parent session id required via --session or HELI_SESSION_ID");
			const transferred = transferWriteAuthority(workspaceRoot, { parentSessionId, childSessionId, worktreePath: resolveWorktreeRoot(cwd) });
			writeConcurrentProjection(workspaceRoot);
			return emit(json, "session.transfer-write", transferred, () => console.log(`Write authority transferred ${parentSessionId} -> ${childSessionId}`));
		}
		case "status": {
			const cwd = positional[0] || process.cwd();
			const ctx = resolveExecutionContext({ cwd, host: "cli", createIfMissing: false, refreshLeaseOnResolve: false });
			if (!ctx.workspaceRoot) throw new Error(`No Heli workspace from ${cwd}`);
			const data = {
				workspaceMode: ctx.concurrentMode ? "concurrent" : "legacy",
				workspaceRoot: ctx.workspaceRoot,
				worktree: ctx.worktreeRoot,
				session: ctx.sessionId ? readSession(ctx.workspaceRoot, ctx.sessionId) : null,
				taskId: ctx.taskId || null,
				mode: ctx.mode || null,
				target: ctx.target || null,
				lease: ctx.lease || null,
				yolo: ctx.yolo || null,
				authority: ctx.sessionId ? effectiveSessionAuthority(ctx.workspaceRoot, ctx.sessionId) : null,
			};
			return emit(json, "session.status", data, (d) => {
				console.log(`Workspace mode: ${d.workspaceMode}`);
				console.log(`Workspace root: ${d.workspaceRoot}`);
				console.log(`Session: ${d.session?.sessionId || "none"}`);
				console.log(`Task: ${d.taskId || "unbound"}`);
				console.log(`Mode: ${d.mode || "n/a"}`);
				console.log(`Parent: ${d.session?.parentSessionId || "none"}`);
				console.log(`Role: ${d.session?.role || "n/a"}`);
				console.log(`Lease: ${d.lease ? (d.lease.stale ? "stale" : "active") : "none"}`);
			});
		}
		case "list": {
			const cwd = positional[0] || process.cwd();
			const workspaceRoot = requireWorkspace(cwd);
			const sessions = listSessions(workspaceRoot);
			return emit(json, "session.list", { workspaceRoot, sessions }, (data) => {
				if (!data.sessions.length) return console.log("No sessions.");
				for (const s of data.sessions) console.log(`- ${s.sessionId} status=${s.status} task=${s.taskId || "-"} mode=${s.mode} role=${s.role} parent=${s.parentSessionId || "-"} host=${s.host}`);
			});
		}
		case "close": {
			const cwd = positional[0] || process.cwd();
			const workspaceRoot = requireWorkspace(cwd);
			const sessionId = flags.sessionId || process.env.HELI_SESSION_ID;
			if (!sessionId) throw new Error("set HELI_SESSION_ID or pass --session");
			const session = readSession(workspaceRoot, sessionId);
			if (session?.taskId && session.mode === "write") {
				try { releaseWriteLease(workspaceRoot, session.taskId, { sessionId }); } catch { /* non-owner keeps lease */ }
			}
			if (session?.worktreePath) clearBindingSession(workspaceRoot, session.worktreePath, sessionId);
			const closed = closeSession(workspaceRoot, sessionId);
			writeConcurrentProjection(workspaceRoot);
			return emit(json, "session.close", { session: closed }, () => console.log(`Closed session ${sessionId}`));
		}
		default:
			throw new Error("Usage: heli session start|attach|transfer-write|status|list|close");
	}
}
