/**
 * Approved runs: a plan a human approved once (`heli run approve`), and what it allows until it ends or expires.
 *
 * The plan names what it needs in a fenced `heli-run` block of `key: value` lines:
 *
 *     ```heli-run
 *     branch: feat/x      # the branch the run may push (required with push: yes)
 *     push: yes           # default no
 *     remote: origin      # default origin
 *     hours: 8            # how long the approval lasts, at most 24 (default 8)
 *     keep-going: yes     # whether the agent is kept working until it says done or blocked (default yes)
 *     ```
 *
 * Approving it records the run in the machine-local Heli data directory (agents may not write there):
 * `<data>/runs/workspaces/<workspace-key>/<run-id>.json`, with the plan's path and the sha256 of its text, and issues a
 * `git.push` grant constrained to that branch of that remote (see grant.mjs constraintAllows), void as soon as the plan's
 * text changes, revoked when the run is done or stopped, and expiring with it. Heli runs nothing: the agent works the plan,
 * Heli only answers its tool calls and (with keep-going, see runContinuation) keeps it from stopping before it says
 * `heli run done` or `heli run blocked "<what it needs>"`.
 */
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { ensureDir, listFileNames, readJson, readText, writeJsonAtomic } from "./fs-atomic.mjs";
import { fileSha256, issueGrant, revokeGrant } from "./grant.mjs";
import { globalDataDir, projectWorkspaceKey } from "./project-binding.mjs";
import { canonicalizePath } from "./paths.mjs";
import { findSessionByExternalId, listActiveSessions } from "./session.mjs";

export const RUN_SCHEMA_VERSION = 1;
export const DEFAULT_RUN_HOURS = 8;
export const MAX_RUN_HOURS = 24;
// How many times one run keeps its agent from stopping: a backstop against a loop the agent cannot get out of.
export const MAX_RUN_CONTINUATIONS = 40;
// Branches a run never pushes: the usual default branches (and the remote's own default, see approveRun).
const PROTECTED_BRANCHES = new Set(["main", "master", "trunk", "develop", "production", "release"]);
const ENVELOPE_KEYS = new Set(["branch", "push", "remote", "hours", "keep-going"]);
// The agent session a run binds to at approval: the one most recently active near the plan, within this window.
const BIND_WINDOW_MS = 30 * 60 * 1000;

function error(code, message) {
	return Object.assign(new Error(message), { code });
}

function yesNo(value, key) {
	const word = String(value).trim().toLowerCase();
	if (["yes", "true", "on"].includes(word)) return true;
	if (["no", "false", "off"].includes(word)) return false;
	throw error("RUN_ENVELOPE_INVALID", `heli-run ${key}: expected yes or no, got "${value}"`);
}

/**
 * The `heli-run` block of a plan's text: `{ branch, push, remote, hours, keepGoing }`. Throws RUN_ENVELOPE_MISSING when the
 * plan has none, RUN_ENVELOPE_INVALID for an unknown key, a bad value, or a push without a branch.
 */
export function parseRunEnvelope(text) {
	const match = /^```heli-run[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/m.exec(String(text ?? ""));
	if (!match) throw error("RUN_ENVELOPE_MISSING", "the plan has no ```heli-run block (branch, push, remote, hours, keep-going)");
	const fields = {};
	for (const raw of match[1].split(/\r?\n/)) {
		const line = raw.replace(/\s+#.*$/, "").trim();
		if (!line || line.startsWith("#")) continue;
		const colon = line.indexOf(":");
		if (colon <= 0) throw error("RUN_ENVELOPE_INVALID", `heli-run: expected "key: value", got "${line}"`);
		const key = line.slice(0, colon).trim().toLowerCase();
		if (!ENVELOPE_KEYS.has(key)) throw error("RUN_ENVELOPE_INVALID", `heli-run: unknown key "${key}" (allowed: ${[...ENVELOPE_KEYS].join(", ")})`);
		fields[key] = line.slice(colon + 1).trim();
	}
	const push = fields.push === undefined ? false : yesNo(fields.push, "push");
	const branch = fields.branch || null;
	if (push && !branch) throw error("RUN_ENVELOPE_INVALID", "heli-run: push: yes needs a branch");
	if (branch && !/^[A-Za-z0-9._/-]+$/.test(branch)) throw error("RUN_ENVELOPE_INVALID", `heli-run branch: "${branch}" is not a plain branch name`);
	const hours = fields.hours === undefined ? DEFAULT_RUN_HOURS : Number(fields.hours);
	if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_RUN_HOURS) throw error("RUN_ENVELOPE_INVALID", `heli-run hours: between 0 and ${MAX_RUN_HOURS}, got "${fields.hours}"`);
	return {
		branch,
		push,
		remote: fields.remote || "origin",
		hours,
		keepGoing: fields["keep-going"] === undefined ? true : yesNo(fields["keep-going"], "keep-going"),
	};
}

export function runStoreDir(workspaceRoot, { env = process.env } = {}) {
	return join(globalDataDir(env), "runs", "workspaces", projectWorkspaceKey(workspaceRoot, { env }));
}

function runPath(workspaceRoot, runId, options) {
	return join(runStoreDir(workspaceRoot, options), `${runId}.json`);
}

function writeRun(workspaceRoot, run, options) {
	ensureDir(runStoreDir(workspaceRoot, options));
	writeJsonAtomic(runPath(workspaceRoot, run.runId, options), run);
	return run;
}

/** Every run of the workspace, newest first. */
export function listRuns(workspaceRoot, { env = process.env } = {}) {
	const dir = runStoreDir(workspaceRoot, { env });
	return listFileNames(dir, { suffix: ".json" })
		.map((name) => readJson(join(dir, name), null))
		.filter((run) => run && run.runId)
		.sort((a, b) => String(b.approvedAt).localeCompare(String(a.approvedAt)));
}

export function runExpired(run, now = Date.now()) {
	const expires = Date.parse(run?.expiresAt || "");
	return !Number.isFinite(expires) || now > expires;
}

/** The newest run that is still on (active or blocked, not expired), optionally the one with `runId`; else null. */
export function currentRun(workspaceRoot, { runId = null, env = process.env } = {}) {
	return listRuns(workspaceRoot, { env }).find((run) =>
		(!runId || run.runId === runId) && (run.status === "active" || run.status === "blocked") && !runExpired(run),
	) || null;
}

/**
 * The agent session the run keeps going: the active session most recently seen working where the plan is (its
 * worktree holds the plan, or the plan's folder holds it), within the last half hour. null when there is none.
 */
export function bindableSession(workspaceRoot, planPath, { now = Date.now() } = {}) {
	const planDir = canonicalizePath(dirname(planPath));
	const near = (worktree) => {
		if (!worktree) return false;
		const tree = canonicalizePath(worktree);
		return planDir === tree || planDir.startsWith(`${tree}/`) || tree.startsWith(`${planDir}/`);
	};
	return listActiveSessions(workspaceRoot)
		.filter((session) => near(session.worktreePath) && now - Date.parse(session.lastSeenAt || 0) <= BIND_WINDOW_MS)
		.sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)))[0] || null;
}

/**
 * Approve a plan: record the run and issue its push grant. The caller (heli run approve) is human-only; this records what
 * the human approved. `sessionId`: the Heli session to keep going (default: bindableSession; null keeps nobody going).
 * `remoteDefault`: the remote's default branch, refused like main/master.
 */
export function approveRun(workspaceRoot, { planPath, hours = null, sessionId, keepGoing = null, remoteDefault = null, env = process.env } = {}) {
	if (!planPath) throw error("RUN_PLAN_REQUIRED", "heli run approve needs the plan file");
	const plan = isAbsolute(planPath) ? planPath : resolve(planPath);
	const text = readText(plan, null);
	if (text === null) throw error("RUN_PLAN_NOT_FOUND", `no plan at ${plan}`);
	const envelope = parseRunEnvelope(text);
	const branchName = envelope.branch;
	if (envelope.push && (PROTECTED_BRANCHES.has(branchName) || branchName === remoteDefault)) {
		throw error("RUN_BRANCH_PROTECTED", `an approved run never pushes ${branchName}: name the plan's own branch`);
	}
	const lasts = hours ?? envelope.hours;
	if (!(Number(lasts) > 0 && Number(lasts) <= MAX_RUN_HOURS)) throw error("RUN_HOURS_INVALID", `hours: between 0 and ${MAX_RUN_HOURS}`);
	const runId = `heli-run-${randomUUID().slice(0, 8)}`;
	const approvedAt = new Date();
	const expiresAt = new Date(approvedAt.getTime() + Number(lasts) * 3600_000).toISOString();
	const planSha256 = fileSha256(plan);
	const bound = sessionId === undefined ? bindableSession(workspaceRoot, plan)?.sessionId ?? null : sessionId;
	const grantIds = [];
	if (envelope.push) {
		const grant = issueGrant(workspaceRoot, {
			action: "git.push",
			scope: "time",
			expiresAt,
			resource: { type: "workspace", id: projectWorkspaceKey(workspaceRoot, { env }) },
			constraint: { kind: "git-push", remote: envelope.remote, branches: [branchName], planPath: plan, planSha256 },
			runId,
			reason: `approved run ${runId}: ${plan}`,
			env,
		});
		grantIds.push(grant.grantId);
	}
	return writeRun(workspaceRoot, {
		schemaVersion: RUN_SCHEMA_VERSION,
		runId,
		planPath: plan,
		planSha256,
		branch: branchName,
		remote: envelope.remote,
		push: envelope.push,
		keepGoing: keepGoing ?? envelope.keepGoing,
		sessionId: bound,
		approvedAt: approvedAt.toISOString(),
		expiresAt,
		status: "active",
		grantIds,
		continuations: 0,
		blocked: null,
		endedAt: null,
		note: null,
	}, { env });
}

/**
 * Change a run's status. `done` and `stopped` end it and revoke its grants; `blocked` (every remaining step needs the user)
 * keeps them and lets the agent stop; `active` resumes a blocked run. `note`: what it is blocked on, or how it ended.
 */
export function setRunStatus(workspaceRoot, { runId = null, status, note = null, env = process.env } = {}) {
	if (!["active", "blocked", "done", "stopped"].includes(status)) throw error("RUN_STATUS_INVALID", `unknown run status: ${status}`);
	const run = currentRun(workspaceRoot, { runId, env });
	if (!run) throw error("RUN_NOT_FOUND", runId ? `no current run ${runId}` : "no approved run is on in this workspace");
	const next = { ...run, status, note: note ?? run.note };
	if (status === "blocked") next.blocked = { reason: note || "needs the user", at: new Date().toISOString() };
	if (status === "active") next.blocked = null;
	if (status === "done" || status === "stopped") {
		next.endedAt = new Date().toISOString();
		for (const grantId of run.grantIds || []) {
			try {
				revokeGrant(workspaceRoot, grantId, { env });
			} catch {
				// Already revoked or gone: the run ends either way.
			}
		}
	}
	return writeRun(workspaceRoot, next, { env });
}

/**
 * The SessionStart line for a run that is on, or null: what it allows and how the agent ends it.
 */
export function runSessionLine(workspaceRoot, { sessionId = null, env = process.env } = {}) {
	const run = currentRun(workspaceRoot, { env });
	if (!run || (run.sessionId && sessionId && run.sessionId !== sessionId)) return null;
	const push = run.push ? `pushes allowed only to ${run.remote}/${run.branch}` : "no pushes";
	const state = run.status === "blocked" ? `blocked on: ${run.blocked?.reason}` : "active";
	return `Heli approved run ${run.runId} (${state}) until ${run.expiresAt}: plan ${run.planPath}; ${push}. Work the plan without asking about what it approves. When every step is done and verified run \`heli run done\`; if every remaining step needs the user run \`heli run blocked "<what you need>"\`.`;
}

/**
 * What the Stop hook does for a host session (`externalSessionId`, the host's session id): `{ block: true, reason, run }`
 * to keep the agent working its approved run, or `{ block: false }`. It keeps going only the session the run is bound to,
 * only while the run is active (not blocked, done, stopped or expired), with keep-going on, under MAX_RUN_CONTINUATIONS.
 */
export function runContinuation(workspaceRoot, { externalSessionId = null, host = null, env = process.env } = {}) {
	const run = currentRun(workspaceRoot, { env });
	if (!run || run.status !== "active" || !run.keepGoing || !run.sessionId) return { block: false };
	const session = findSessionByExternalId(workspaceRoot, externalSessionId, { host });
	if (!session || session.sessionId !== run.sessionId) return { block: false };
	if ((run.continuations || 0) >= MAX_RUN_CONTINUATIONS) return { block: false, run, exhausted: true };
	const next = writeRun(workspaceRoot, { ...run, continuations: (run.continuations || 0) + 1, lastContinuationAt: new Date().toISOString() }, { env });
	const reason = [
		`Heli: approved run ${run.runId} is still active (plan ${run.planPath}, until ${run.expiresAt}). Do not stop yet: continue with the next step of the plan.`,
		run.push ? `Pushing to ${run.remote}/${run.branch} is approved; anything the plan approved needs no confirmation.` : "Anything the plan approved needs no confirmation.",
		"When every step is done and verified, run `heli run done`. If every remaining step needs the user, run `heli run blocked \"<what you need from them>\"` and then stop.",
	].join(" ");
	return { block: true, reason, run: next };
}
