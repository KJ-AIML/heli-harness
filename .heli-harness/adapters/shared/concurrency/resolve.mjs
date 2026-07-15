/**
 * Shared execution-context resolver used by all runtime adapters.
 */
import { pathExists, readJson, readText } from "./fs-atomic.mjs";
import {
	findWorkspaceRoot,
	resolveWorktreeRoot,
	pathsFor,
	taskPaths,
	canonicalizePath,
} from "./paths.mjs";
import { isConcurrentMode, readWorkspaceSchema } from "./schema.mjs";
import { readTask, listActiveTasks, readTaskMarkdown } from "./task.mjs";
import {
	createSession,
	readSession,
	findSessionByExternalId,
	touchSession,
	writeSession,
} from "./session.mjs";
import { readBinding, writeBinding } from "./binding.mjs";
import { readLease, sessionHoldsWriteLease, refreshLease, isLeaseExpired } from "./lease.mjs";
import { resolveYolo } from "./yolo-scope.mjs";

/**
 * Extract optional external host session id from known documented-ish fields.
 * Never invent; only copy when present on payload or env.
 */
export function extractExternalHostSessionId(hookPayload = {}, env = process.env) {
	if (env.HELI_EXTERNAL_HOST_SESSION_ID) return String(env.HELI_EXTERNAL_HOST_SESSION_ID).trim();
	const p = hookPayload || {};
	const candidates = [
		p.session_id,
		p.sessionId,
		p.conversation_id,
		p.conversationId,
		p?.session?.id,
		p?.session?.session_id,
	];
	for (const c of candidates) {
		if (c != null && String(c).trim()) return String(c).trim();
	}
	return null;
}

function field(text, label) {
	const match = new RegExp(`^${label}:[ \\t]*(.*)$`, "m").exec(text || "");
	return match ? match[1].trim() : "";
}

/**
 * resolveExecutionContext({ cwd, environment, hookPayload, host, createIfMissing })
 */
export function resolveExecutionContext({
	cwd = process.cwd(),
	environment = process.env,
	hookPayload = null,
	host = "unknown",
	createIfMissing = true,
	refreshLeaseOnResolve = false,
} = {}) {
	const env = environment || process.env;
	const workspaceRoot = findWorkspaceRoot(cwd);
	const worktreeRoot = resolveWorktreeRoot(cwd);
	const repositoryRoot = worktreeRoot;
	const schema = workspaceRoot
		? readWorkspaceSchema(workspaceRoot)
		: { mode: "legacy", exists: false };
	const concurrentMode = workspaceRoot ? isConcurrentMode(workspaceRoot) : false;
	const legacyMode = !concurrentMode;

	const externalHostSessionId = extractExternalHostSessionId(hookPayload || {}, env);
	let sessionId = env.HELI_SESSION_ID ? String(env.HELI_SESSION_ID).trim() : null;
	let session = null;
	let identitySource = null;
	const warnings = [];
	const errors = [];

	if (!workspaceRoot) {
		return {
			workspaceRoot: null,
			worktreeRoot,
			repositoryRoot,
			taskId: null,
			sessionId: null,
			externalHostSessionId,
			host,
			mode: null,
			target: null,
			taskPaths: null,
			lease: null,
			legacyMode: true,
			concurrentMode: false,
			yolo: { active: false },
			bound: false,
			warnings: ["No Heli workspace found (missing .heli-harness/HARNESS.md upward from cwd)"],
			errors: [],
			identitySource: null,
		};
	}

	// 1. Explicit HELI_SESSION_ID (authoritative when set — never invent a different id)
	if (sessionId) {
		session = readSession(workspaceRoot, sessionId);
		identitySource = "env:HELI_SESSION_ID";
		if (!session && createIfMissing) {
			// Resume/create with the exact caller-supplied id — not a new random session.
			session = createSession(workspaceRoot, {
				sessionId,
				externalHostSessionId,
				host,
				worktreePath: worktreeRoot,
				mode: "observe",
			});
			writeBinding(workspaceRoot, {
				worktreePath: worktreeRoot,
				sessionId,
				host,
				mode: "observe",
			});
		}
	}

	// 2. Documented external host session id (metadata mapping only)
	if (!session && externalHostSessionId) {
		session = findSessionByExternalId(workspaceRoot, externalHostSessionId);
		if (session) {
			sessionId = session.sessionId;
			identitySource = "externalHostSessionId";
		} else if (createIfMissing) {
			// One Heli session per external host id when starting; do not mint on every PreToolUse
			// (callers should set createIfMissing only for SessionStart).
			session = createSession(workspaceRoot, {
				externalHostSessionId,
				host,
				worktreePath: worktreeRoot,
				mode: "observe",
			});
			sessionId = session.sessionId;
			identitySource = "externalHostSessionId-created";
			writeBinding(workspaceRoot, {
				worktreePath: worktreeRoot,
				sessionId,
				host,
				mode: "observe",
			});
		}
	}

	// 3. Unique active session binding for canonical worktree
	if (!session) {
		const binding = readBinding(workspaceRoot, worktreeRoot);
		if (binding?.defaultSessionId) {
			const bound = readSession(workspaceRoot, binding.defaultSessionId);
			if (bound && bound.status === "active") {
				session = bound;
				sessionId = bound.sessionId;
				identitySource = "worktree-binding";
			}
		}
	}

	// 4. Newly generated unbound Heli session (SessionStart / explicit only)
	if (!session && createIfMissing) {
		session = createSession(workspaceRoot, {
			externalHostSessionId,
			host,
			worktreePath: worktreeRoot,
			mode: "observe",
		});
		sessionId = session.sessionId;
		identitySource = "generated";
		// Bind so subsequent PreToolUse (createIfMissing=false) resumes the same session.
		writeBinding(workspaceRoot, {
			worktreePath: worktreeRoot,
			sessionId,
			host,
			mode: "observe",
		});
	}

	if (session) {
		sessionId = session.sessionId;
		if (externalHostSessionId && !session.externalHostSessionId) {
			session.externalHostSessionId = externalHostSessionId;
			writeSession(workspaceRoot, session);
		}
		// Do not silently re-activate closed sessions for writers; leave as-is for status.
		if (session.status === "active") {
			touchSession(workspaceRoot, sessionId);
			session = readSession(workspaceRoot, sessionId);
		}
	}

	const taskId = session?.taskId || null;
	const task = taskId ? readTask(workspaceRoot, taskId) : null;
	const tp = taskId ? taskPaths(workspaceRoot, taskId) : null;
	let lease = taskId ? readLease(workspaceRoot, taskId) : null;
	if (lease?.invalid) {
		warnings.push(`malformed lease for task ${taskId}: ${lease.reason}`);
		lease = { ...lease, stale: true };
	}

	if (refreshLeaseOnResolve && taskId && sessionId && sessionHoldsWriteLease(workspaceRoot, taskId, sessionId)) {
		try {
			lease = refreshLease(workspaceRoot, taskId, { sessionId });
		} catch {
			/* ignore refresh failures on resolve */
		}
	}

	// Target: concurrent uses task target; legacy uses global target.json
	let target = null;
	if (concurrentMode && task?.target) {
		target = {
			targetRepo: task.target.repositoryId || "",
			targetGitRoot: task.target.repositoryPath || task.target.worktreePath || "",
			writesAllowedUnder: task.target.repositoryPath || task.target.worktreePath || "",
			source: "task",
		};
	} else {
		const globalTarget = readJson(pathsFor(workspaceRoot).targetPath, null);
		if (globalTarget) {
			target = {
				targetRepo: globalTarget.targetRepo || "",
				targetGitRoot: globalTarget.targetGitRoot || "",
				writesAllowedUnder: globalTarget.writesAllowedUnder || "",
				source: "workspace",
			};
		}
	}

	const yolo = resolveYolo({
		workspaceRoot,
		cwd,
		taskId,
		sessionId,
		env,
		legacyMode,
	});

	const otherActiveTasks = concurrentMode
		? listActiveTasks(workspaceRoot)
				.filter((t) => t.taskId !== taskId)
				.map((t) => t.taskId)
		: [];

	return {
		workspaceRoot,
		worktreeRoot,
		repositoryRoot,
		taskId,
		sessionId,
		externalHostSessionId: session?.externalHostSessionId || externalHostSessionId,
		host,
		mode: session?.mode || null,
		target,
		task,
		taskPaths: tp,
		lease: lease && !isLeaseExpired(lease) ? lease : lease ? { ...lease, stale: true } : null,
		legacyMode,
		concurrentMode,
		yolo,
		bound: !!(session && session.taskId),
		session,
		otherActiveTasks,
		warnings,
		errors,
		identitySource,
		schema,
	};
}

/**
 * Ownership gate for write tools in concurrent mode.
 * YOLO must never skip this.
 */
export function evaluateOwnershipGate(ctx, { isWrite = false } = {}) {
	if (!ctx.workspaceRoot) {
		return { deny: false };
	}
	if (!ctx.concurrentMode) {
		return { deny: false, legacy: true };
	}
	if (!isWrite) return { deny: false };

	if (!ctx.sessionId) {
		return {
			deny: true,
			reason:
				"Heli-Harness concurrent mode: no session identity resolved. Set HELI_SESSION_ID or run `heli session start` before write operations.",
			code: "NO_SESSION",
		};
	}
	if (!ctx.taskId || !ctx.bound) {
		return {
			deny: true,
			reason:
				"Heli-Harness concurrent mode: session is not bound to a task. Run `heli session attach <task-id> --mode write` or `heli task claim <task-id> --mode write` before editing.",
			code: "UNBOUND_SESSION",
		};
	}
	if (ctx.mode !== "write") {
		return {
			deny: true,
			reason: `Heli-Harness concurrent mode: session mode is "${ctx.mode || "unknown"}" (not write). Claim write mode or use review/observe without mutating production files.`,
			code: "NOT_WRITE_MODE",
		};
	}
	if (!sessionHoldsWriteLease(ctx.workspaceRoot, ctx.taskId, ctx.sessionId)) {
		const lease = readLease(ctx.workspaceRoot, ctx.taskId);
		if (lease?.invalid) {
			return {
				deny: true,
				reason: `Heli-Harness concurrent mode: malformed write lease for task ${ctx.taskId} (${lease.reason}). Inspect the lock directory, then re-claim or \`heli task takeover ${ctx.taskId} --confirm\`.`,
				code: "MALFORMED_LEASE",
			};
		}
		if (lease && isLeaseExpired(lease)) {
			return {
				deny: true,
				reason: `Heli-Harness concurrent mode: write lease for task ${ctx.taskId} is stale (owner ${lease.sessionId}, expired ${lease.expiresAt}). Use \`heli task takeover ${ctx.taskId} --confirm\`.`,
				code: "STALE_LEASE",
			};
		}
		if (lease) {
			return {
				deny: true,
				reason: `Heli-Harness concurrent mode: write lease for task ${ctx.taskId} is held by session ${lease.sessionId}. Attach as review/observe or use another worktree/task.`,
				code: "LEASE_HELD",
			};
		}
		return {
			deny: true,
			reason: `Heli-Harness concurrent mode: no active write lease for task ${ctx.taskId}. Run \`heli task claim ${ctx.taskId} --mode write\`.`,
			code: "NO_LEASE",
		};
	}
	return { deny: false, ok: true };
}

/**
 * Build compact SessionStart context for concurrent or legacy mode.
 */
export function buildConcurrentSessionContext(ctx) {
	const lines = [
		"Heli-Harness plugin context:",
		"Read .heli-harness/HARNESS.md before substantive work.",
		"Instruction files are not a sandbox; plugin hooks are guardrails only.",
	];

	if (!ctx.workspaceRoot) {
		lines.push("", "No Heli workspace detected from cwd.");
		return lines.join("\n");
	}

	if (!ctx.concurrentMode) {
		// legacy injection handled by caller; provide marker
		lines.push("", "Workspace mode: legacy (singular current-task.md).");
		return lines.join("\n");
	}

	lines.push("", "Heli Concurrent Session");
	lines.push(`- Session: ${ctx.sessionId || "none"}`);
	lines.push(`- Task: ${ctx.taskId || "unbound"}`);
	lines.push(`- Mode: ${ctx.mode || "n/a"}`);
	lines.push(`- Target: ${ctx.target?.targetRepo || "n/a"}`);
	lines.push(`- Worktree: ${ctx.worktreeRoot || "n/a"}`);
	lines.push(`- Lease: ${ctx.lease && !ctx.lease.stale ? "active" : ctx.lease?.stale ? "stale" : "none"}`);
	lines.push(`- YOLO: ${ctx.yolo?.active ? `active (${ctx.yolo.source})` : "strict"}`);
	if (ctx.otherActiveTasks?.length) {
		lines.push(`- Other active tasks: ${ctx.otherActiveTasks.join(", ")}`);
	} else {
		lines.push("- Other active tasks: none");
	}

	if (!ctx.bound) {
		const active = listActiveTasks(ctx.workspaceRoot);
		lines.push("", "Session is unbound. Bind or create a task before write operations.");
		if (active.length) {
			lines.push("Active tasks:");
			for (const t of active.slice(0, 12)) {
				const lease = readLease(ctx.workspaceRoot, t.taskId);
				const writer = lease && !isLeaseExpired(lease) ? lease.sessionId : "available";
				lines.push(`  - ${t.taskId} — writer: ${writer}`);
			}
		}
	} else if (ctx.taskId) {
		const md = readTaskMarkdown(ctx.workspaceRoot, ctx.taskId);
		if (md.currentTaskMd?.trim()) {
			lines.push(
				"",
				`Bound task state from tasks/${ctx.taskId}/current-task.md:`,
				md.currentTaskMd.trim(),
			);
		}
		if (md.planMd?.trim()) {
			// compact: only say plan exists, do not dump full plan
			lines.push("", `Plan file: tasks/${ctx.taskId}/plan.md (read full file before resuming multi-step work).`);
		}
	}

	return lines.join("\n");
}

/**
 * Legacy stuck-task / plan / target gates using task-local paths when concurrent.
 */
export function readTaskGateForContext(ctx) {
	if (!ctx.workspaceRoot) return null;

	if (ctx.concurrentMode) {
		if (!ctx.taskId) return null;
		const tp = taskPaths(ctx.workspaceRoot, ctx.taskId);
		if (!pathExists(tp.currentTaskMd)) return null;
		const taskText = readText(tp.currentTaskMd, "");
		const status = field(taskText, "Current status");
		const failedAttempts = parseInt(field(taskText, "Failed attempts count") || "0", 10) || 0;
		if (failedAttempts >= 2 && status.toLowerCase() !== "complete") {
			return `Heli-Harness: task ${ctx.taskId} current-task.md shows ${failedAttempts} failed attempts and status "${status || "(empty)"}" — update tasks/${ctx.taskId}/current-task.md before continuing.`;
		}
		const taskTarget = field(taskText, "Target repo");
		const workspaceTarget = ctx.target?.targetRepo || "";
		if (taskTarget && workspaceTarget && workspaceTarget.toLowerCase() !== taskTarget.toLowerCase()) {
			return `Heli-Harness: task ${ctx.taskId} current-task.md says target "${taskTarget}" but task target is "${workspaceTarget}" — confirm and update task state.`;
		}
		return null;
	}

	// legacy
	const { legacyTaskPath, targetPath } = pathsFor(ctx.workspaceRoot);
	if (!pathExists(legacyTaskPath)) return null;
	const taskText = readText(legacyTaskPath, "");
	const taskTarget = field(taskText, "Target repo");
	const status = field(taskText, "Current status");
	const failedAttempts = parseInt(field(taskText, "Failed attempts count") || "0", 10) || 0;
	if (failedAttempts >= 2 && status.toLowerCase() !== "complete") {
		return `Heli-Harness: current-task.md shows ${failedAttempts} failed attempts and status "${status || "(empty)"}" on an incomplete task — this looks carried over from a previous session. Read .heli-harness/state/current-task.md, diagnose or reset it, and update the file before continuing.`;
	}
	if (taskTarget && pathExists(targetPath)) {
		let workspaceTarget = "";
		try {
			workspaceTarget = readJson(targetPath, {})?.targetRepo || "";
		} catch {
			/* ignore */
		}
		if (workspaceTarget && workspaceTarget.toLowerCase() !== taskTarget.toLowerCase()) {
			return `Heli-Harness: current-task.md says target repo "${taskTarget}" but .heli-harness/workspace/target.json is set to "${workspaceTarget}" — confirm which repo you're working in and update current-task.md before continuing.`;
		}
	}
	return null;
}

export function readPlanGateForContext(ctx) {
	if (!ctx.workspaceRoot) return null;
	let planPath;
	if (ctx.concurrentMode) {
		if (!ctx.taskId) return null;
		planPath = taskPaths(ctx.workspaceRoot, ctx.taskId).planMd;
	} else {
		planPath = pathsFor(ctx.workspaceRoot).legacyPlanPath;
	}
	if (!pathExists(planPath)) return null;
	const planText = readText(planPath, "");
	const sections = planText.split(/(?=^## )/m).filter((part) => part.startsWith("## "));
	const current = sections.find((section) => field(section, "Status").toLowerCase() !== "complete");
	if (!current) return null;
	const status = field(current, "Status");
	const attempts = parseInt(field(current, "Attempts") || "0", 10) || 0;
	if (attempts >= 2 && status.toLowerCase() !== "complete") {
		const stepTitleMatch = /^## (.+)$/m.exec(current);
		const stepTitle = stepTitleMatch ? stepTitleMatch[1].trim() : "current step";
		const label = ctx.concurrentMode ? `tasks/${ctx.taskId}/plan.md` : "plan.md";
		return `Heli-Harness: ${label} step "${stepTitle}" shows ${attempts} failed attempts and status "${status || "(empty)"}" — update it before continuing.`;
	}
	return null;
}

export function isTaskStateWriteForContext(ctx, paths) {
	const normalized = paths.map((p) => p.replaceAll("\\", "/").toLowerCase());
	const endsWithAny = (suffixes) =>
		normalized.some((path) => suffixes.some((s) => path.endsWith(s.toLowerCase())));

	if (
		endsWithAny([
			".heli-harness/state/current-task.md",
			".heli-harness/state/plan.md",
			".heli-harness/workspace/target.json",
			".heli-harness/state/yolo.json",
			".heli-harness/workspace/schema.json",
		])
	) {
		return true;
	}
	if (ctx.taskId) {
		const prefix = `.heli-harness/tasks/${ctx.taskId.toLowerCase()}/`;
		if (normalized.some((p) => p.includes(prefix))) return true;
	}
	// allow sessions/bindings/locks maintenance
	if (
		normalized.some(
			(p) =>
				p.includes(".heli-harness/sessions/") ||
				p.includes(".heli-harness/bindings/") ||
				p.includes(".heli-harness/locks/"),
		)
	) {
		return true;
	}
	return false;
}
