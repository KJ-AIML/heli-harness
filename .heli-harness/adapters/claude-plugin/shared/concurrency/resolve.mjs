/**
 * Shared execution-context resolver used by all runtime adapters.
 */
import { isAbsolute, resolve } from "node:path";
import { pathExists, readJson, readText } from "./fs-atomic.mjs";
import {
	findWorkspaceRoot,
	resolveWorktreeRoot,
	pathsFor,
	taskPaths,
	canonicalizePath,
	isWindows,
} from "./paths.mjs";
import { isConcurrentMode, readWorkspaceSchema } from "./schema.mjs";
import { readTask, listTasks, listTaskIds, listActiveTasks, readTaskMarkdown } from "./task.mjs";
import {
	createSession,
	readSession,
	findSessionByExternalId,
	touchSession,
	writeSession,
} from "./session.mjs";
import { readBinding, writeBinding } from "./binding.mjs";
import {
	readLease,
	sessionHoldsWriteLease,
	refreshLease,
	acquireWriteLease,
	isLeaseExpired,
	findActiveWriteLeaseForWorktree,
} from "./lease.mjs";
import { effectiveSessionAuthority } from "./authority.mjs";
import { resolveYolo } from "./yolo-scope.mjs";
import { readDiagnosis } from "./diagnosis.mjs";
import { isLinkedWorkspace, readProjectBinding } from "./project-binding.mjs";
import { classifyToolPaths } from "./protected-paths.mjs";
import { continuationForWorktree } from "./continuation.mjs";
import {
	acquireResourceWriteAuthority,
	readResourceLeaseForWorktree,
	isResourceLeaseExpired,
	resourceIdForWorktree,
} from "./resource-authority.mjs";

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
			hookPayload: hookPayload || null,
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
		session = findSessionByExternalId(workspaceRoot, externalHostSessionId, { host });
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

	// 3. Resume the session this host already bound to the worktree.
	// A host session id that SessionStart did not see yet must still resume
	// hostBindings[host]. Do not steal another host's default session when an
	// external id is present, and do not reuse a binding that already belongs
	// to a different host session id. With no external id, keep the worktree
	// default so CLI readers such as `heli explain` see the host session.
	if (!session) {
		const binding = readBinding(workspaceRoot, worktreeRoot);
		const payloadHostSessionId = String(
			hookPayload?.sessionId || hookPayload?.session_id || hookPayload?.session?.id || hookPayload?.session?.sessionId || "",
		).trim();
		const resumeBound = (candidateId, source) => {
			if (!candidateId) return false;
			const bound = readSession(workspaceRoot, candidateId);
			if (!bound || bound.status !== "active") return false;
			if (source === "host-binding") {
				const sameHost = !bound.host || !host || bound.host === host || bound.host === "unknown";
				const externalFree = !externalHostSessionId || !bound.externalHostSessionId || bound.externalHostSessionId === externalHostSessionId;
				if (!sameHost || !externalFree) return false;
			}
			session = bound;
			sessionId = bound.sessionId;
			identitySource = source;
			return true;
		};
		const hostBoundId = host && binding?.hostBindings?.[host]?.sessionId;
		if (!resumeBound(hostBoundId, "host-binding") && !externalHostSessionId) {
			resumeBound(binding?.defaultSessionId, "worktree-binding");
		}
		// Some native hosts identify their conversation only in PreToolUse's
		// session_id/tool-call envelope. When that id first appears after
		// SessionStart, bind it to the already-created session for this host and
		// worktree. Refuse to attach a foreign id or any other host's session.
		if (!session && payloadHostSessionId) {
			const bindingSessionIds = [hostBoundId, binding?.hostBindings?.cli?.sessionId, binding?.defaultSessionId].filter(Boolean);
			for (const candidateId of new Set(bindingSessionIds)) {
				const bound = readSession(workspaceRoot, candidateId);
				if (!bound || bound.status !== "active") continue;
				if (bound.host && host && bound.host !== host && bound.host !== "unknown") continue;
				if (bound.externalHostSessionId && bound.externalHostSessionId !== payloadHostSessionId) continue;
				bound.externalHostSessionId = payloadHostSessionId;
				writeSession(workspaceRoot, bound);
				session = readSession(workspaceRoot, candidateId);
				sessionId = candidateId;
				identitySource = "host-binding-payload-session-id";
				break;
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
		hookPayload: hookPayload || null,
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

function resourceHeldReason(existing, resourceId) {
	const resource = resourceId || existing?.resource?.id || "unknown";
	const task = existing?.taskId ? ` (work record ${existing.taskId})` : "";
	return `Heli linked mode: worktree resource ${resource} is held by session ${existing.sessionId}${task} until ${existing.expiresAt}.`;
}

/**
 * A write whose path resolves inside another checkout of the same workspace
 * must name that checkout's writer. Resource authority stays per worktree.
 */
export function evaluateForeignWorktreeWrite(ctx, rawPaths, { cwd = process.cwd() } = {}) {
	if (!ctx?.workspaceRoot || !isLinkedWorkspace(ctx.workspaceRoot)) return { deny: false };
	const local = readProjectBinding(ctx.workspaceRoot);
	if (!local?.workspaceId) return { deny: false };
	const localRoot = canonicalizePath(ctx.workspaceRoot);
	for (const raw of rawPaths || []) {
		const text = String(raw ?? "").trim();
		if (!text) continue;
		const abs = canonicalizePath(isAbsolute(text) ? text : resolve(cwd, text));
		if (!abs) continue;
		const foreign = findWorkspaceRoot(abs);
		if (!foreign || foreign === localRoot || !isLinkedWorkspace(foreign)) continue;
		const other = readProjectBinding(foreign);
		if (!other || other.workspaceId !== local.workspaceId) continue;
		const resourceId = resourceIdForWorktree(foreign);
		const existing = readResourceLeaseForWorktree(foreign, foreign);
		if (existing && !existing.invalid && !isResourceLeaseExpired(existing)) {
			return {
				deny: true,
				code: "RESOURCE_WRITER_HELD",
				reason: resourceHeldReason(existing, resourceId),
				authority: existing,
			};
		}
		return {
			deny: true,
			code: "NO_SESSION",
			// Host binding UX (issue #35 acceptance 5): the host/plugin route comes
			// first; the CLI write session is the fallback for hosts without the
			// plugin, not the primary recommendation.
			reason: `Heli linked mode: write targets worktree resource ${resourceId}, and no active host/session identity is bound to that worktree. Start the coding host in that worktree with the Heli plugin loaded (its SessionStart binds the writer), or, for hosts without the plugin, run \`heli session start --mode write\` there before mutation.`,
		};
	}
	return { deny: false };
}

/**
 * Ownership gate for write tools in concurrent mode.
 * YOLO must never skip this.
 */
export function evaluateOwnershipGate(ctx, { isWrite = false } = {}) {
	if (!ctx.workspaceRoot) {
		return { deny: false };
	}
	if (isLinkedWorkspace(ctx.workspaceRoot)) {
		if (!isWrite) return { deny: false, linked: true };
		if (!ctx.sessionId || !ctx.session || ctx.session.status !== "active") {
			const existing = ctx.worktreeRoot ? readResourceLeaseForWorktree(ctx.workspaceRoot, ctx.worktreeRoot) : null;
			if (existing && !existing.invalid && !isResourceLeaseExpired(existing)) {
				return {
					deny: true,
					code: "RESOURCE_WRITER_HELD",
					reason: resourceHeldReason(existing, resourceIdForWorktree(ctx.worktreeRoot)),
					authority: existing,
				};
			}
			return {
			deny: true,
			code: "NO_SESSION",
			// Host binding UX (issue #35 acceptance 5): host plugin first, CLI session fallback.
			reason: "Heli linked mode: no active host/session identity is bound to this worktree. Start the coding host here with the Heli plugin loaded (its SessionStart binds the writer), or, for hosts without the plugin, run `heli session start --mode write` before mutation.",
		};
		}
		if (!ctx.worktreeRoot) return { deny: true, code: "RESOURCE_UNRESOLVED", reason: "Heli linked mode: current worktree resource could not be resolved." };
		const existing = readResourceLeaseForWorktree(ctx.workspaceRoot, ctx.worktreeRoot);
		if (existing?.invalid) return { deny: true, code: "MALFORMED_LEASE", reason: `Heli linked mode: malformed resource authority (${existing.reason}).`, authority: existing };
		if (existing && !isResourceLeaseExpired(existing) && existing.sessionId !== ctx.sessionId) {
			return { deny: true, code: "RESOURCE_WRITER_HELD", reason: resourceHeldReason(existing, resourceIdForWorktree(ctx.worktreeRoot)), authority: existing };
		}
		if (existing && isResourceLeaseExpired(existing) && existing.sessionId !== ctx.sessionId) {
			return { deny: true, code: "STALE_RESOURCE_AUTHORITY", reason: `Heli linked mode: stale resource authority from session ${existing.sessionId} requires an explicit takeover before a different actor may write.`, authority: existing };
		}
		try {
			const authority = acquireResourceWriteAuthority(ctx.workspaceRoot, { taskId: ctx.taskId || null, sessionId: ctx.sessionId, worktreePath: ctx.worktreeRoot });
			return { deny: false, ok: true, linked: true, code: existing ? "RESOURCE_AUTHORITY_REFRESHED" : "RESOURCE_AUTHORITY_ACQUIRED", authority };
		} catch (error) {
			return { deny: true, code: error.code || "RESOURCE_AUTHORITY_FAILED", reason: `Heli linked mode: could not establish resource authority: ${error.message}`, authority: error.lease || null };
		}
	}

	if (!ctx.concurrentMode) {
		return { deny: false, legacy: true };
	}
	if (!isWrite) return { deny: false };

	// Concurrent is the install default. With zero tasks, allow single-agent
	// bootstrap writes so S0/S1 work is not blocked until the first claim.
	// Once any task exists, full session/lease ownership applies.
	// Count task DIRECTORIES, not readable tasks: a corrupt task.json must not
	// be indistinguishable from "no tasks" and silently re-open bootstrap.
	const taskIds = listTaskIds(ctx.workspaceRoot);
	if (!taskIds.length) {
		return {
			deny: false,
			bootstrap: true,
			code: "CONCURRENT_BOOTSTRAP",
		};
	}

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
	const delegated = effectiveSessionAuthority(ctx.workspaceRoot, ctx.sessionId);
	if (delegated.delegationActive === false) {
		return {
			deny: true,
			reason: `Heli-Harness concurrent mode: delegated authority is inactive (${delegated.reason}).`,
			code: delegated.reason || "DELEGATION_INACTIVE",
			authority: delegated,
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
			if (lease.sessionId === ctx.sessionId) {
				const conflict = findActiveWriteLeaseForWorktree(
					ctx.workspaceRoot,
					lease.worktreePath || ctx.worktreeRoot || "",
					{ exceptSessionId: ctx.sessionId },
				);
				if (!conflict) {
					return { deny: false, ok: true, renewalRequired: true, code: "LEASE_RENEWAL_REQUIRED" };
				}
				return {
					deny: true,
					reason: `Heli-Harness concurrent mode: expired lease cannot renew because worktree authority is now held by task ${conflict.taskId}, session ${conflict.lease.sessionId}.`,
					code: "WORKTREE_WRITER_HELD",
					lease: conflict.lease,
				};
			}
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
		try {
			const acquired = acquireWriteLease(ctx.workspaceRoot, {
				taskId: ctx.taskId,
				sessionId: ctx.sessionId,
				worktreePath: ctx.worktreeRoot || ctx.session?.worktreePath || ctx.task?.target?.worktreePath || "",
			});
			return {
				deny: false,
				ok: true,
				autoRecovered: true,
				code: "LEASE_AUTO_ACQUIRED",
				lease: acquired,
			};
		} catch (error) {
			const code = error?.code || "LEASE_AUTO_ACQUIRE_FAILED";
			const liveConflict = code === "WORKTREE_WRITER_HELD" || code === "LEASE_HELD";
			return {
				deny: true,
				reason: liveConflict
					? `Heli-Harness concurrent mode: cannot establish writer authority because another live writer owns this worktree (${error.message}). Stop retrying this write and ask the user to continue with the current writer, close it, use another worktree, or explicitly approve takeover.`
					: `Heli-Harness concurrent mode: could not establish writer authority automatically (${error.message}). Inspect with \`heli status\` and \`heli explain authority\` before retrying.`,
				code,
				authority: error?.lease || null,
				autoRecoveryFailed: true,
			};
		}
	}
	return { deny: false, ok: true };
}

/**
 * Build compact SessionStart context for concurrent or legacy mode.
 */
export function buildConcurrentSessionContext(ctx, { env = process.env } = {}) {
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

	if (isLinkedWorkspace(ctx.workspaceRoot)) {
		const authority = ctx.worktreeRoot ? readResourceLeaseForWorktree(ctx.workspaceRoot, ctx.worktreeRoot) : null;
		const active = authority && !authority.invalid && !isResourceLeaseExpired(authority) ? authority : null;
		lines.push("", "Heli Linked Session");
		lines.push("Governance enforcement: plugin hooks are active for this session (not a sandbox). Linked writes use execution-local, resource-scoped authority; named tasks are optional work records.");
		lines.push(`- Session: ${ctx.sessionId || "none"}`);
		lines.push(`- Work record: ${ctx.taskId || "none"}`);
		lines.push(`- Target: ${ctx.target?.targetRepo || "n/a"}`);
		lines.push(`- Resource: ${ctx.worktreeRoot || "n/a"}`);
		lines.push(`- Resource authority: ${active ? (active.sessionId === ctx.sessionId ? `held by this session (generation ${active.generation || 1}, revision ${active.revision || 1})` : `held by session ${active.sessionId}`) : authority?.invalid ? "malformed (writes fail closed)" : "available; first guarded mutation acquires it conflict-safely"}`);
		lines.push("- Project binding lives under .heli/; grants, sessions, live authority, and capability observations remain execution-local.");
		if (!ctx.taskId && ctx.worktreeRoot) {
			const continuation = continuationForWorktree(ctx.workspaceRoot, ctx.worktreeRoot, { env });
			if (continuation) {
				lines.push(
					"",
					"Durable continuation available from previous meaningful work:",
					`- Continuation: ${continuation.continuationId}`,
					`- Previous host: ${continuation.provenance?.lastHost || "unknown"}`,
					`- Repository: ${continuation.repositoryName || continuation.repositoryId || continuation.repositoryPath || "unknown"}`,
					`- Branch/HEAD: ${continuation.branch || "unknown"} @ ${continuation.head || "unknown"}`,
					`- Last activity: ${continuation.lastActivity?.at || continuation.updatedAt || "unknown"}`,
					`- Intended paths: ${continuation.intentPaths?.length ? continuation.intentPaths.slice(-12).join(", ") : "not recorded"}`,
					"- Read heli resume before editing. Continuation context is durable; writer authority is NOT inherited from the previous host/session.",
				);
			}
		}
		return lines.join("\n");
	}

	lines.push("", "Heli Concurrent Session");
	const allTasks = listTasks(ctx.workspaceRoot);
	const bootstrapEmpty = !allTasks.length;
	if (bootstrapEmpty) {
		lines.push(
			"Governance enforcement: plugin hooks active for this session (not a sandbox). Workspace mode is concurrent with no tasks yet — single-agent bootstrap writes are allowed. Before multi-agent work: heli task create <id> --work-item <key> --repo <name> && heli task claim <id> --mode write (export HELI_SESSION_ID).",
		);
	} else {
		lines.push(
			"Governance enforcement: plugin hooks active for this session (not a sandbox). A bound write session auto-establishes or renews its own lease when the worktree is free; live writer conflicts still deny; YOLO never bypasses ownership.",
		);
	}
	lines.push(`- Session: ${ctx.sessionId || "none"}`);
	lines.push(`- Task: ${ctx.taskId || "unbound"}`);
	lines.push(`- Mode: ${ctx.mode || "n/a"}`);
	lines.push(`- Target: ${ctx.target?.targetRepo || "n/a"}`);
	lines.push(`- Worktree: ${ctx.worktreeRoot || "n/a"}`);
	lines.push(`- Lease: ${ctx.lease && !ctx.lease.stale ? "active" : ctx.lease?.stale ? "stale" : "none"}`);
	lines.push(`- YOLO: ${ctx.yolo?.active ? `active (${ctx.yolo.source})` : "strict"}`);
	lines.push(`- Tasks registered: ${allTasks.length}`);
	if (ctx.otherActiveTasks?.length) {
		lines.push(`- Other active tasks: ${ctx.otherActiveTasks.join(", ")}`);
	} else {
		lines.push("- Other active tasks: none");
	}
	lines.push(
		"- Authoritative task state: .heli-harness/tasks/<task-id>/ — shared state/current-task.md is non-authoritative projection only.",
	);

	if (!ctx.bound) {
		const active = listActiveTasks(ctx.workspaceRoot);
		if (bootstrapEmpty) {
			lines.push(
				"",
				"No tasks yet (concurrent bootstrap). Prefer heli task create + claim before parallel agents share this workspace.",
			);
		} else {
			lines.push(
				"",
				"Session is unbound. WRITE TOOLS ARE DENIED until you bind: heli task claim <id> --mode write (or heli session attach) and export HELI_SESSION_ID. If a write is denied, do not retry alternate write commands against the same blocker; run the stated recovery action once, or ask the user when Heli says human approval is required.",
			);
		}
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
		const diagnosis = readDiagnosis(ctx.workspaceRoot, ctx.taskId);
		if (diagnosis.active) {
			lines.push(
				"",
				"Active diagnosis (machine state; read diagnosis.json for full evidence):",
				`  phase: ${diagnosis.phase}; route: ${diagnosis.route || "pending"}; hypothesis: ${diagnosis.hypothesisStatus}; root cause: ${diagnosis.rootCauseStatus}`,
				`  boundary: ${diagnosis.closestProvenBoundary?.statement || "not established"}`,
				`  gate: ${diagnosis.rerouteRequired ? diagnosis.routeReason || "reroute required" : diagnosis.checkpointRequired ? "subsystem checkpoint required" : diagnosis.implementationBlocked ? "evidence required" : "clear"}`,
			);
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

/**
 * True when EVERY path is a narrative state file the caller may write without
 * holding write authority: the shared state/ ledger (current-task.md, plan.md,
 * decisions.md, reports/, runs/) or the same files in the caller's OWN task
 * directory. Paths are normalized first (cwd-relative resolution, `..`
 * collapse, realpath, Windows casing), so `tasks/../../src/x` or another
 * task's files never qualify. Authority-bearing files never qualify either.
 * A path that cannot be classified is not exempt: the ownership gate applies.
 */
export function isTaskStateWriteForContext(ctx, paths, { cwd = process.cwd(), env = process.env, cache } = {}) {
	if (!ctx?.workspaceRoot || !Array.isArray(paths) || paths.length === 0) return false;
	const sameTask = (a, b) => (isWindows() ? a.toLowerCase() === b.toLowerCase() : a === b);
	const ownTask = ctx.taskId ? String(ctx.taskId) : null;
	try {
		return classifyToolPaths(paths, { workspaceRoot: ctx.workspaceRoot, cwd, env, cache }).every(
			(entry) =>
				entry.kind === "narrative" &&
				(entry.taskId == null || (ownTask !== null && sameTask(entry.taskId, ownTask))),
		);
	} catch {
		return false;
	}
}
