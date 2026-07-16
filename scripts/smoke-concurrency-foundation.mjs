#!/usr/bin/env node
/**
 * Concurrent Session Foundation regression suite (v0.5.24).
 * Temp workspaces only — never touches a live parent install.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const concurrencyUrl = pathToFileURL(join(root, "lib/concurrency/index.mjs")).href;
const {
	createTask,
	readTask,
	findDuplicateTasks,
	migrateLegacyTask,
	writeTaskMarkdown,
	readTaskMarkdown,
	createSession,
	attachSession,
	readSession,
	acquireWriteLease,
	releaseWriteLease,
	takeoverWriteLease,
	readLease,
	sessionHoldsWriteLease,
	writeBinding,
	readBinding,
	canonicalizePath,
	resolveExecutionContext,
	evaluateOwnershipGate,
	resolveYolo,
	detectPathClaimConflicts,
	updateTask,
	setTaskYolo,
	setTaskTarget,
	writeConcurrentProjection,
	isConcurrentMode,
	listActiveTasks,
	writeJsonAtomic,
} = await import(concurrencyUrl);

const { evaluatePreToolUse, buildSessionContext, isYoloActive } = await import(
	pathToFileURL(join(root, ".heli-harness/adapters/shared/hook-core.mjs")).href
);

function fixtureWorkspace(label = "heli-conc") {
	const dir = mkdtempSync(join(tmpdir(), `${label}-`));
	mkdirSync(join(dir, ".heli-harness", "state"), { recursive: true });
	mkdirSync(join(dir, ".heli-harness", "workspace"), { recursive: true });
	writeFileSync(join(dir, ".heli-harness", "HARNESS.md"), "# Heli-Harness\n");
	writeFileSync(
		join(dir, ".heli-harness", "workspace", "index.json"),
		JSON.stringify({
			schemaVersion: 1,
			workspaceRoot: ".",
			repos: [
				{ name: "repo-a", path: "repos/repo-a", gitRoot: "repos/repo-a" },
				{ name: "repo-b", path: "repos/repo-b", gitRoot: "repos/repo-b" },
			],
		}) + "\n",
	);
	writeFileSync(
		join(dir, ".heli-harness", "workspace", "target.json"),
		JSON.stringify({ schemaVersion: 1, targetRepo: "", targetGitRoot: "", writesAllowedUnder: "" }) + "\n",
	);
	return dir;
}

function ok(name) {
	console.log(`  ✅ ${name}`);
}

// --- Identity ---
{
	console.log("▸ Identity");
	const dir = fixtureWorkspace("id");
	try {
		const a = createSession(dir, { host: "test", worktreePath: dir });
		const b = createSession(dir, { host: "test", worktreePath: dir });
		assert.notEqual(a.sessionId, b.sessionId);
		assert.match(a.sessionId, /^heli-ses-/);
		ok("unique heli session ids");

		process.env.HELI_SESSION_ID = a.sessionId;
		const ctx = resolveExecutionContext({ cwd: dir, host: "test", createIfMissing: false });
		assert.equal(ctx.sessionId, a.sessionId);
		assert.equal(ctx.identitySource, "env:HELI_SESSION_ID");
		delete process.env.HELI_SESSION_ID;
		ok("HELI_SESSION_ID precedence");

		const withExt = createSession(dir, {
			host: "claude",
			externalHostSessionId: "host-abc",
			worktreePath: dir,
		});
		const ctx2 = resolveExecutionContext({
			cwd: dir,
			host: "claude",
			hookPayload: { session_id: "host-abc" },
			createIfMissing: false,
		});
		assert.equal(ctx2.sessionId, withExt.sessionId);
		ok("external host session id mapping");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// --- Task isolation + YOLO + leases + mandatory acceptance ---
{
	console.log("▸ Task isolation / YOLO / leases / acceptance");
	const parent = fixtureWorkspace("accept");
	const wtA = join(parent, "wt-a");
	const wtB = join(parent, "wt-b");
	mkdirSync(wtA, { recursive: true });
	mkdirSync(wtB, { recursive: true });
	// Nested worktrees still find parent harness via upward search
	writeFileSync(join(wtA, "note.txt"), "a\n");
	writeFileSync(join(wtB, "note.txt"), "b\n");

	try {
		const taskA = createTask(parent, {
			taskId: "work-3a",
			title: "Work 3A",
			workItemKey: "3A",
			repositoryId: "repo-a",
			worktreePath: wtA,
			mode: "strict",
			pathClaims: { owns: ["packages/contracts/**"], reads: [], shared: [], forbidden: [] },
		});
		const taskB = createTask(parent, {
			taskId: "work-3b",
			title: "Work 3B",
			workItemKey: "3B",
			repositoryId: "repo-b",
			worktreePath: wtB,
			mode: "strict",
			pathClaims: { owns: ["packages/contracts/user.ts"], reads: [], shared: [], forbidden: [] },
		});
		assert.ok(isConcurrentMode(parent));
		ok("created work-3a and work-3b");

		// duplicate 3A
		assert.throws(
			() =>
				createTask(parent, {
					taskId: "work-3a-dup",
					title: "Work 3A again",
					workItemKey: "3A",
					repositoryId: "repo-a",
				}),
			(e) => e.code === "DUPLICATE_WORK",
		);
		ok("duplicate Work 3A detected");

		const sesA = createSession(parent, { host: "proc-a", taskId: "work-3a", mode: "write", worktreePath: wtA });
		const sesB = createSession(parent, { host: "proc-b", taskId: "work-3b", mode: "write", worktreePath: wtB });
		attachSession(parent, sesA.sessionId, "work-3a", { mode: "write", worktreePath: wtA });
		attachSession(parent, sesB.sessionId, "work-3b", { mode: "write", worktreePath: wtB });
		const leaseA = acquireWriteLease(parent, { taskId: "work-3a", sessionId: sesA.sessionId, worktreePath: wtA });
		const leaseB = acquireWriteLease(parent, { taskId: "work-3b", sessionId: sesB.sessionId, worktreePath: wtB });
		assert.ok(leaseA.leaseId && leaseB.leaseId && leaseA.leaseId !== leaseB.leaseId);
		writeBinding(parent, { worktreePath: wtA, taskId: "work-3a", sessionId: sesA.sessionId, host: "proc-a", mode: "write" });
		writeBinding(parent, { worktreePath: wtB, taskId: "work-3b", sessionId: sesB.sessionId, host: "proc-b", mode: "write" });
		ok("two write leases on different tasks");

		// same-task second writer
		const sesA2 = createSession(parent, { host: "proc-a2", worktreePath: wtA });
		assert.throws(
			() => acquireWriteLease(parent, { taskId: "work-3a", sessionId: sesA2.sessionId, worktreePath: wtA }),
			(e) => e.code === "LEASE_HELD",
		);
		ok("same-task second writer rejected");

		// review attach without write lease
		const reviewer = createSession(parent, { host: "review", worktreePath: wtA, mode: "review" });
		attachSession(parent, reviewer.sessionId, "work-3a", { mode: "review", worktreePath: wtA });
		assert.equal(readSession(parent, reviewer.sessionId).mode, "review");
		assert.equal(sessionHoldsWriteLease(parent, "work-3a", reviewer.sessionId), false);
		ok("review session attaches without write lease");

		// isolated markdown
		writeTaskMarkdown(parent, "work-3a", { currentTaskMd: "# A\n\nTask: work-3a\n", planMd: "# Plan A\n", decisionsMd: "# Dec A\n" });
		writeTaskMarkdown(parent, "work-3b", { currentTaskMd: "# B\n\nTask: work-3b\n", planMd: "# Plan B\n", decisionsMd: "# Dec B\n" });
		assert.match(readTaskMarkdown(parent, "work-3a").planMd, /Plan A/);
		assert.match(readTaskMarkdown(parent, "work-3b").planMd, /Plan B/);
		assert.doesNotMatch(readTaskMarkdown(parent, "work-3a").planMd, /Plan B/);
		ok("plans isolated");

		// targets isolated
		setTaskTarget(parent, "work-3a", { repositoryId: "repo-a", repositoryPath: "repos/repo-a" }, { sessionId: sesA.sessionId });
		setTaskTarget(parent, "work-3b", { repositoryId: "repo-b", repositoryPath: "repos/repo-b" }, { sessionId: sesB.sessionId });
		assert.equal(readTask(parent, "work-3a").target.repositoryId, "repo-a");
		assert.equal(readTask(parent, "work-3b").target.repositoryId, "repo-b");
		ok("targets isolated");

		// YOLO isolation: B yolo, A strict
		setTaskYolo(parent, "work-3b", true, { sessionId: sesB.sessionId });
		const yoloA = resolveYolo({ workspaceRoot: parent, taskId: "work-3a", sessionId: sesA.sessionId, legacyMode: false });
		const yoloB = resolveYolo({ workspaceRoot: parent, taskId: "work-3b", sessionId: sesB.sessionId, legacyMode: false });
		assert.equal(yoloA.active, false);
		assert.equal(yoloB.active, true);
		ok("task B YOLO does not affect task A");

		// global yolo.json must not bleed in concurrent mode
		writeFileSync(join(parent, ".heli-harness", "state", "yolo.json"), JSON.stringify({ enabled: true }));
		const yoloA2 = resolveYolo({ workspaceRoot: parent, taskId: "work-3a", sessionId: sesA.sessionId, legacyMode: false });
		assert.equal(yoloA2.active, false);
		ok("global yolo.json ignored in concurrent mode");

		// resolve contexts
		const ctxA = resolveExecutionContext({
			cwd: wtA,
			environment: { ...process.env, HELI_SESSION_ID: sesA.sessionId },
			host: "proc-a",
			createIfMissing: false,
		});
		const ctxB = resolveExecutionContext({
			cwd: wtB,
			environment: { ...process.env, HELI_SESSION_ID: sesB.sessionId },
			host: "proc-b",
			createIfMissing: false,
		});
		assert.equal(ctxA.taskId, "work-3a");
		assert.equal(ctxB.taskId, "work-3b");
		assert.equal(ctxA.workspaceRoot, canonicalizePath(parent));
		ok("sessions resolve correct tasks via worktree/session");

		// ownership gate: unbound write denied
		const unbound = resolveExecutionContext({ cwd: parent, host: "x", createIfMissing: true });
		const gate = evaluateOwnershipGate(unbound, { isWrite: true });
		assert.equal(gate.deny, true);
		ok("unbound write denied");

		// YOLO cannot bypass ownership
		const pre = evaluatePreToolUse({
			cwd: wtA,
			toolName: "Write",
			toolInput: { file_path: "src/x.ts" },
			host: "proc-a",
			env: { ...process.env, HELI_SESSION_ID: sesA2.sessionId, HELI_YOLO: "1" },
		});
		// sesA2 has no lease
		assert.equal(pre.deny, true);
		assert.match(pre.reason, /lease|write|bound|mode/i);
		ok("YOLO cannot bypass write lease denial");

		// evidence report with ids
		const reportPath = join(parent, ".heli-harness", "tasks", "work-3a", "reports", "run.json");
		writeJsonAtomic(reportPath, {
			taskId: "work-3a",
			sessionId: sesA.sessionId,
			repository: "repo-a",
			worktreePath: canonicalizePath(wtA),
			timestamp: new Date().toISOString(),
			outcome: "ok",
		});
		const rep = JSON.parse(readFileSync(reportPath, "utf8"));
		assert.equal(rep.taskId, "work-3a");
		assert.equal(rep.sessionId, sesA.sessionId);
		ok("reports include task and session ids");

		// path conflicts advisory
		const conflicts = detectPathClaimConflicts(parent);
		assert.ok(conflicts.some((c) => c.severity === "high"));
		ok("path claim overlap detected");

		// concurrent process lease race
		const raceTask = createTask(parent, { taskId: "race-task", title: "Race", workItemKey: "race", allowDuplicate: true });
		const script = `
import { acquireWriteLease } from ${JSON.stringify(concurrencyUrl)};
const root = process.argv[1];
const sid = process.argv[2];
try {
  const lease = acquireWriteLease(root, { taskId: "race-task", sessionId: sid, worktreePath: root });
  process.stdout.write(JSON.stringify({ ok: true, leaseId: lease.leaseId, sessionId: sid }));
} catch (e) {
  process.stdout.write(JSON.stringify({ ok: false, code: e.code, sessionId: sid }));
}
`;
		const s1 = createSession(parent, { host: "r1", worktreePath: parent }).sessionId;
		const s2 = createSession(parent, { host: "r2", worktreePath: parent }).sessionId;
		const p1 = spawnSync(process.execPath, ["--input-type=module", "-e", script, parent, s1], { encoding: "utf8" });
		const p2 = spawnSync(process.execPath, ["--input-type=module", "-e", script, parent, s2], { encoding: "utf8" });
		const r1 = JSON.parse(p1.stdout || "{}");
		const r2 = JSON.parse(p2.stdout || "{}");
		const wins = [r1, r2].filter((r) => r.ok);
		assert.equal(wins.length, 1, `exactly one lease winner, got ${JSON.stringify([r1, r2])}`);
		ok("simultaneous lease acquisition: exactly one winner");

		// revision conflict
		const t0 = readTask(parent, "work-3a");
		updateTask(parent, "work-3a", (t) => {
			t.title = "updated-a";
			return t;
		}, { expectedRevision: t0.revision, sessionId: sesA.sessionId });
		assert.throws(
			() =>
				updateTask(
					parent,
					"work-3a",
					(t) => {
						t.title = "stale";
						return t;
					},
					{ expectedRevision: t0.revision, sessionId: sesA.sessionId },
				),
			(e) => e.code === "REVISION_CONFLICT",
		);
		ok("task revision CAS detects lost update");

		// takeover requires confirm
		assert.throws(
			() => takeoverWriteLease(parent, { taskId: "work-3a", sessionId: sesA2.sessionId, confirm: false }),
			(e) => e.code === "CONFIRM_REQUIRED",
		);
		ok("takeover requires confirmation");

		// adapter parity: hooks resolve fixtures
		const ctxText = buildSessionContext(wtA, {
			host: "claude",
			env: { ...process.env, HELI_SESSION_ID: sesA.sessionId },
		});
		assert.match(ctxText, /work-3a|Concurrent Session/i);
		ok("session context injects bound task");

		const hook = join(root, ".heli-harness/adapters/claude-plugin/hooks/heli-pre-tool-use.mjs");
		const denyUnbound = spawnSync(process.execPath, [hook], {
			cwd: parent,
			input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: "x.ts" } }),
			encoding: "utf8",
			env: { ...process.env, HELI_SESSION_ID: unbound.sessionId },
		});
		const denyBody = denyUnbound.stdout?.trim() ? JSON.parse(denyUnbound.stdout) : {};
		assert.equal(denyBody?.hookSpecificOutput?.permissionDecision, "deny");
		ok("claude-style hook denies unbound write in concurrent mode");

		// multi-task projection
		writeConcurrentProjection(parent);
		const proj = readFileSync(join(parent, ".heli-harness", "state", "current-task.md"), "utf8");
		assert.match(proj, /Concurrent task mode|Active tasks/i);
		ok("multi-task projection is neutral");
	} finally {
		rmSync(parent, { recursive: true, force: true });
	}
}

// --- Legacy compatibility ---
{
	console.log("▸ Legacy compatibility");
	const dir = fixtureWorkspace("legacy");
	try {
		writeFileSync(
			join(dir, ".heli-harness", "state", "current-task.md"),
			"# Current Task\n\nTarget repo: demo\n\nCurrent status: in progress\n\nFailed attempts count: 0\n",
		);
		writeFileSync(join(dir, ".heli-harness", "state", "plan.md"), "# Plan: legacy\n\n## Step 1\n\nStatus: pending\n\nAttempts: 0\n");
		assert.equal(isConcurrentMode(dir), false);
		const pre = evaluatePreToolUse({
			cwd: dir,
			toolName: "Bash",
			toolInput: { command: "git push origin main" },
			host: "test",
		});
		assert.equal(pre.deny, true);
		ok("legacy still denies git push");

		const migrated = migrateLegacyTask(dir, "legacy-main", { title: "Legacy import", repositoryId: "demo" });
		assert.equal(migrated.taskId, "legacy-main");
		assert.equal(isConcurrentMode(dir), true);
		assert.ok(existsSync(join(dir, ".heli-harness", "state", "current-task.md")));
		ok("migrate-legacy imports one task and enables concurrent mode");

		// legacy yolo still works before concurrent - already concurrent now; test fresh
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}

	const yoloLegacy = fixtureWorkspace("yolo-leg");
	try {
		writeFileSync(join(yoloLegacy, ".heli-harness", "state", "yolo.json"), JSON.stringify({ enabled: true }));
		const y = isYoloActive(yoloLegacy);
		assert.equal(y.active, true);
		ok("legacy yolo.json still activates safety YOLO");
	} finally {
		rmSync(yoloLegacy, { recursive: true, force: true });
	}
}

// --- Canonical path binding ---
{
	console.log("▸ Worktree binding canonicalization");
	const dir = fixtureWorkspace("canon");
	try {
		const p1 = canonicalizePath(dir);
		const p2 = canonicalizePath(dir + (process.platform === "win32" ? "\\" : "/"));
		assert.equal(p1, p2);
		if (process.platform === "win32") {
			const mixed = dir.replace(/\//g, "\\");
			assert.equal(canonicalizePath(mixed), p1);
			ok("Windows separator aliases normalize");
		} else {
			ok("Unix path canonicalization");
		}
		writeBinding(dir, { worktreePath: dir, taskId: "t1", sessionId: "heli-ses-x", host: "t" });
		const b = readBinding(dir, dir);
		assert.equal(b.taskId, "t1");
		ok("canonical path binding round-trip");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// --- Adversarial review suite ---
{
	console.log("▸ Adversarial review cases");
	const dir = fixtureWorkspace("adv");
	try {
		createTask(dir, { taskId: "t-a", workItemKey: "KA", repositoryId: "repo-a", worktreePath: dir });
		const preNoSess = evaluatePreToolUse({
			cwd: dir,
			toolName: "Write",
			toolInput: { file_path: "x.ts" },
			host: "test",
			env: { ...process.env, HELI_SESSION_ID: "" },
		});
		assert.equal(preNoSess.deny, true);
		const sessDir = join(dir, ".heli-harness", "sessions");
		const countBeforeStart = existsSync(sessDir) ? readdirSyncSafe(sessDir) : 0;
		const started = resolveExecutionContext({
			cwd: dir,
			host: "test",
			createIfMissing: true,
		});
		assert.ok(started.sessionId);
		const started2 = resolveExecutionContext({
			cwd: dir,
			host: "test",
			createIfMissing: false,
		});
		assert.equal(started2.sessionId, started.sessionId, "resume via worktree binding must not mint a second session");
		// PreToolUse still must not mint
		evaluatePreToolUse({
			cwd: dir,
			toolName: "Write",
			toolInput: { file_path: "y.ts" },
			host: "test",
			env: { ...process.env, HELI_SESSION_ID: "" },
		});
		const countAfterPre = readdirSyncSafe(sessDir);
		assert.equal(countAfterPre, countBeforeStart + 1, "only SessionStart mint + binding; PreToolUse adds none");
		ok("PreToolUse does not mint sessions; SessionStart binds for resume");

		// same worktree second writer (different task)
		const wt = dir;
		const s1 = createSession(dir, { host: "w1", worktreePath: wt, mode: "write" });
		const s2 = createSession(dir, { host: "w2", worktreePath: wt, mode: "write" });
		createTask(dir, { taskId: "t-b", workItemKey: "KB", repositoryId: "repo-b", worktreePath: wt });
		acquireWriteLease(dir, { taskId: "t-a", sessionId: s1.sessionId, worktreePath: wt });
		assert.throws(
			() => acquireWriteLease(dir, { taskId: "t-b", sessionId: s2.sessionId, worktreePath: wt }),
			(e) => e.code === "WORKTREE_WRITER_HELD",
		);
		ok("same-worktree second writer denied across tasks");

		// release requires owner session
		assert.throws(
			() => releaseWriteLease(dir, "t-a", { sessionId: null, force: false }),
			(e) => e.code === "SESSION_REQUIRED",
		);
		assert.throws(
			() => releaseWriteLease(dir, "t-a", { sessionId: s2.sessionId, force: false }),
			(e) => e.code === "LEASE_NOT_OWNER",
		);
		ok("lease release cannot delete another session's lease");

		// stale lease never silent steal
		const lease = readLease(dir, "t-a");
		lease.expiresAt = new Date(Date.now() - 1000).toISOString();
		writeFileSync(
			join(dir, ".heli-harness", "locks", "tasks", "t-a.write.lock", "lease.json"),
			JSON.stringify(lease, null, 2),
		);
		assert.throws(
			() => acquireWriteLease(dir, { taskId: "t-a", sessionId: s2.sessionId, worktreePath: wt }),
			(e) => e.code === "STALE_LEASE",
		);
		const taken = takeoverWriteLease(dir, {
			taskId: "t-a",
			sessionId: s2.sessionId,
			worktreePath: wt,
			confirm: true,
		});
		assert.equal(taken.sessionId, s2.sessionId);
		const events = readFileSync(join(dir, ".heli-harness", "tasks", "t-a", "events.jsonl"), "utf8");
		assert.match(events, /lease_takeover/);
		ok("stale lease requires explicit takeover and records event");

		// malformed lease fails safe
		releaseWriteLease(dir, "t-a", { sessionId: s2.sessionId });
		mkdirSync(join(dir, ".heli-harness", "locks", "tasks", "t-a.write.lock"), { recursive: true });
		writeFileSync(join(dir, ".heli-harness", "locks", "tasks", "t-a.write.lock", "lease.json"), "{not-json");
		const mal = readLease(dir, "t-a");
		assert.equal(mal.invalid, true);
		assert.throws(
			() => acquireWriteLease(dir, { taskId: "t-a", sessionId: s1.sessionId, worktreePath: wt }),
			(e) => e.code === "MALFORMED_LEASE" || e.code === "LEASE_LOCK_DIR_EXISTS",
		);
		ok("malformed lease.json fails safely");
		releaseWriteLease(dir, "t-a", { force: true });

		// concurrent revision updates (stale expectedRevision rejected)
		const t0 = readTask(dir, "t-b");
		const revScript = `
import { updateTask } from ${JSON.stringify(concurrencyUrl)};
const root = process.argv[1];
const expected = Number(process.argv[2]);
const label = process.argv[3];
try {
  const t = updateTask(root, "t-b", (x) => { x.title = label; return x; }, { expectedRevision: expected });
  process.stdout.write(JSON.stringify({ ok: true, revision: t.revision, label }));
} catch (e) {
  process.stdout.write(JSON.stringify({ ok: false, code: e.code, label }));
}
`;
		const rA = spawnSync(process.execPath, ["--input-type=module", "-e", revScript, dir, String(t0.revision), "A"], {
			encoding: "utf8",
		});
		const rB = spawnSync(process.execPath, ["--input-type=module", "-e", revScript, dir, String(t0.revision), "B"], {
			encoding: "utf8",
		});
		const outA = JSON.parse(rA.stdout || "{}");
		const outB = JSON.parse(rB.stdout || "{}");
		const winners = [outA, outB].filter((x) => x.ok);
		const losers = [outA, outB].filter((x) => !x.ok);
		assert.equal(winners.length, 1, `one CAS winner: ${JSON.stringify([outA, outB])}`);
		assert.equal(losers[0]?.code, "REVISION_CONFLICT");
		ok("concurrent revision update: exactly one winner, loser REVISION_CONFLICT");

		// title alone is not a duplicate
		createTask(dir, {
			taskId: "title-a",
			title: "Same Title",
			workItemKey: "W1",
			repositoryId: "repo-a",
		});
		createTask(dir, {
			taskId: "title-b",
			title: "Same Title",
			workItemKey: "W2",
			repositoryId: "repo-a",
		});
		ok("title-only similarity does not false-positive as duplicate");

		// allow-duplicate recorded
		createTask(dir, {
			taskId: "dup-forced",
			title: "Forced",
			workItemKey: "W1",
			repositoryId: "repo-a",
			allowDuplicate: true,
		});
		const ev = readFileSync(join(dir, ".heli-harness", "tasks", "dup-forced", "events.jsonl"), "utf8");
		assert.match(ev, /"allowDuplicate":true/);
		ok("--allow-duplicate is recorded in events");

		// neutral projection after multi-task
		writeConcurrentProjection(dir);
		const proj = readFileSync(join(dir, ".heli-harness", "state", "current-task.md"), "utf8");
		assert.match(proj, /Concurrent task mode|Active tasks/i);
		ok("neutral projection after multiple active tasks");

		// HELI_SESSION_ID resume does not duplicate
		const sid = started.sessionId;
		const again = resolveExecutionContext({
			cwd: dir,
			environment: { ...process.env, HELI_SESSION_ID: sid },
			createIfMissing: true,
			host: "test",
		});
		assert.equal(again.sessionId, sid);
		ok("HELI_SESSION_ID resume does not create a duplicate session");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function readdirSyncSafe(p) {
	try {
		return readdirSync(p).length;
	} catch {
		return 0;
	}
}

// --- Update preserves concurrent state ---
{
	console.log("▸ Update preserves concurrent state");
	const { install } = await import(pathToFileURL(join(root, "lib/cli/install.mjs")).href);
	const { update } = await import(pathToFileURL(join(root, "lib/cli/update.mjs")).href);
	const parent = mkdtempSync(join(tmpdir(), "heli-upd-conc-"));
	try {
		install(join(root, ".heli-harness"), parent);
		createTask(parent, { taskId: "keep-me", workItemKey: "K", repositoryId: "repo-a" });
		const before = readFileSync(join(parent, ".heli-harness", "tasks", "keep-me", "task.json"), "utf8");
		update(join(root, ".heli-harness"), parent);
		const after = readFileSync(join(parent, ".heli-harness", "tasks", "keep-me", "task.json"), "utf8");
		assert.equal(after, before);
		ok("update preserves tasks/ concurrent state");
	} finally {
		rmSync(parent, { recursive: true, force: true });
	}
}

console.log("smoke-concurrency-foundation: ok");
