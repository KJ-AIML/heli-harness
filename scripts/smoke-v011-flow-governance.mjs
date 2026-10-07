#!/usr/bin/env node
/**
 * v0.11 flow-first governance.
 *
 * Proves the developer-facing contract: normal work flows, stale authority
 * recovers, live overlap blocks, and non-overlapping work does not.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { linkProject } from "../lib/cli/link.mjs";
import { setupHeli } from "../lib/cli/setup.mjs";
import { evaluatePreToolUse } from "../.heli-harness/adapters/shared/hook-core.mjs";
import {
	closeSession,
	continuationForWorktree,
	createSession,
	ensureGovernanceProfile,
	formatRepairReport,
	isPathInside,
	listMutationLeases,
	listResourceLeases,
	normalizePathIdentity,
	readGovernanceProfile,
	readResourceLeaseForWorktree,
	readSession,
	repairGovernanceState,
	setGovernanceProfile,
} from "../lib/concurrency/index.mjs";
import { acquireResourceWriteAuthority } from "../lib/concurrency/resource-authority.mjs";
import { pathsFor } from "../lib/concurrency/paths.mjs";
import { evaluateOwnershipGate, resolveExecutionContext } from "../lib/concurrency/resolve.mjs";

const root = mkdtempSync(join(tmpdir(), "heli-v011-flow-"));
const packageRoot = process.cwd();
const config = join(root, "config");
const data = join(root, "data");
const env = { ...process.env, HELI_CONFIG_DIR: config, HELI_DATA_DIR: data };
delete env.HELI_SESSION_ID;
const oldConfig = process.env.HELI_CONFIG_DIR;
const oldData = process.env.HELI_DATA_DIR;
process.env.HELI_CONFIG_DIR = config;
process.env.HELI_DATA_DIR = data;
delete process.env.HELI_SESSION_ID;

function git(args, cwd) {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" });
	assert.equal(result.status, 0, `${args.join(" ")}\n${result.stderr}`);
}

function writeDecision(cwd, externalId, file, toolName = "Write") {
	return evaluatePreToolUse({
		cwd,
		host: "grok",
		env,
		toolName,
		toolInput: { file_path: file, content: "flow\n" },
		hookPayload: { session_id: externalId, toolUseId: `${externalId}:${file}:${toolName}` },
	});
}

function backdateLeases(workspace) {
	const past = new Date(Date.now() - 120_000).toISOString();
	for (const lease of listMutationLeases(workspace)) {
		lease.expiresAt = past;
		lease.lastActivityAt = past;
		const dir = join(pathsFor(workspace).heliDir, "locks", "mutations");
		writeFileSync(join(dir, `${lease.leaseId}.json`), JSON.stringify(lease, null, 2));
	}
	for (const lease of listResourceLeases(workspace)) {
		if (lease.invalid || !lease.worktreePath) continue;
		lease.expiresAt = past;
		lease.lastActivityAt = past;
		const lock = join(pathsFor(workspace).resourceLocksDir, `${lease.resource.id}.write.lock`, "lease.json");
		writeFileSync(lock, JSON.stringify(lease, null, 2));
	}
}

try {
	setupHeli({ env });

	// Windows 8.3 and long-path spellings are one identity.
	{
		const realpath = (input) => String(input).replace(/\\/g, "/").replace(/RUNNER~1/gi, "runneradmin");
		const shortPath = "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\ws";
		const longPath = "C:/Users/runneradmin/AppData/Local/Temp/ws";
		assert.equal(
			normalizePathIdentity(shortPath, { platform: "win32", realpath }),
			normalizePathIdentity(longPath, { platform: "win32", realpath }),
		);
		console.log("ok: windows 8.3 and long path share one identity");
	}

	const project = join(root, "workspace");
	mkdirSync(project, { recursive: true });
	const parentLink = linkProject(packageRoot, project, { env });
	const linked = ensureGovernanceProfile(project, { env });
	assert.equal(linked.profile, "flow");
	assert.equal(ensureGovernanceProfile(project, { env }).updatedAt, linked.updatedAt);
	assert.equal(readGovernanceProfile(project, { env }), "flow");

	const app = join(project, "src", "app.ts");
	const other = join(project, "src", "other.ts");
	mkdirSync(join(project, "src"), { recursive: true });
	writeFileSync(app, "export const value = 1;\n");

	const read = evaluatePreToolUse({
		cwd: project,
		host: "grok",
		env,
		toolName: "Read",
		toolInput: { file_path: app },
		hookPayload: { session_id: "reader" },
	});
	assert.equal(read.deny, false, read.reason);

	const created = writeDecision(project, "host-a", app);
	assert.equal(created.deny, false, created.reason);
	assert.equal(created.code, "RUNTIME_DEGRADED");
	assert.match(created.notice || "", /Runtime evidence incomplete/);
	assert.ok(created.ctx.sessionId, "missing SessionStart still yields a session");
	assert.equal(listResourceLeases(project).filter((lease) => !lease.invalid).length, 1);
	assert.equal(listMutationLeases(project).length, 1);
	console.log("ok: missing SessionStart recovers and a normal write flows");

	const edited = writeDecision(project, "host-a", app, "search_replace");
	assert.equal(edited.deny, false, edited.reason);
	const build = evaluatePreToolUse({
		cwd: project,
		host: "grok",
		env,
		toolName: "Bash",
		toolInput: { command: "node --version" },
		hookPayload: { session_id: "host-a", toolUseId: "build-1" },
	});
	assert.equal(build.deny, false, build.reason);
	console.log("ok: edit and build command flow");

	const firstSession = created.ctx.sessionId;
	closeSession(project, firstSession);
	assert.equal(readResourceLeaseForWorktree(project, project), null);
	assert.equal(listMutationLeases(project).length, 0);
	console.log("ok: clean close releases mutation authority");

	const crashed = writeDecision(project, "host-crash", app);
	assert.equal(crashed.deny, false, crashed.reason);
	backdateLeases(project);
	const recovered = writeDecision(project, "host-next", app);
	assert.equal(recovered.deny, false, recovered.reason);
	assert.notEqual(recovered.code, "STALE_RESOURCE_AUTHORITY");
	assert.notEqual(recovered.recoverability, "HUMAN_REQUIRED");
	assert.match(recovered.notice || "", /Recovered stale writer session/);
	assert.doesNotMatch(recovered.notice || "", /HUMAN_REQUIRED/);
	console.log("ok: crashed or stale writer recovers without takeover");
	closeSession(project, recovered.ctx.sessionId);

	const overlap = writeDecision(project, "host-live", app);
	assert.equal(overlap.deny, false, overlap.reason);
	const blocked = writeDecision(project, "host-other", app);
	assert.equal(blocked.deny, true);
	assert.equal(blocked.code, "MUTATION_CONFLICT");
	assert.equal(blocked.recoverability, "HUMAN_REQUIRED");
	assert.match(blocked.reason, /Active write conflict/);
	assert.match(blocked.reason, /Owner:/);
	console.log("ok: live overlapping mutation blocks");

	// If Heli knows an operation mutates but cannot resolve its exact paths, it
	// must conservatively treat that mutation as worktree-scoped. Otherwise an
	// unknown-path writer could bypass a proven live path-scoped mutation.
	const unknownCtx = resolveExecutionContext({
		cwd: project,
		host: "grok",
		environment: env,
		hookPayload: { session_id: "host-unknown" },
		createIfMissing: true,
	});
	const unknownBlocked = evaluateOwnershipGate(unknownCtx, {
		isWrite: true,
		mutationPaths: [],
		toolUseId: "host-unknown:unscoped-write",
		env,
	});
	assert.equal(unknownBlocked.deny, true);
	assert.equal(unknownBlocked.code, "MUTATION_CONFLICT");
	console.log("ok: unknown-path mutation cannot bypass a live worktree conflict");

	const side = writeDecision(project, "host-other", other);
	assert.equal(side.deny, false, side.reason);
	const sessions = new Set(listMutationLeases(project).map((lease) => lease.sessionId));
	assert.equal(sessions.size, 2);
	console.log("ok: live non-overlapping mutations both flow");

	const continuation = continuationForWorktree(project, project, { env });
	assert.ok(continuation);
	assert.equal(continuation.leaseId, undefined);
	assert.equal(continuation.authority, undefined);
	const resumeFile = join(project, "src", "resume.ts");
	const resumed = writeDecision(project, "host-resume", resumeFile);
	assert.equal(resumed.deny, false, resumed.reason);
	assert.ok(continuation.provenance.lastSessionId);
	assert.notEqual(resumed.ctx.sessionId, continuation.provenance.lastSessionId);
	console.log("ok: continuation keeps context and does not grant writer authority");

	// PostTool never arrives. Reconciliation releases the lease once it is idle.
	backdateLeases(project);
	const before = listMutationLeases(project).length;
	assert.ok(before > 0);
	const afterIdle = writeDecision(project, "host-after-ttl", other);
	assert.equal(afterIdle.deny, false, afterIdle.reason);
	assert.ok(listMutationLeases(project).every((lease) => lease.sessionId === afterIdle.ctx.sessionId));
	console.log("ok: missed PostTool lease expires through reconciliation");

	// v0.10 exclusive lease with a missing owner migrates once, then stays gone.
	{
		const legacy = join(root, "legacy");
		mkdirSync(legacy, { recursive: true });
		linkProject(packageRoot, legacy, { env });
		const owner = createSession(legacy, { sessionId: "legacy-owner", host: "codex", mode: "write", worktreePath: legacy });
		acquireResourceWriteAuthority(legacy, { sessionId: owner.sessionId, worktreePath: legacy });
		rmSync(join(pathsFor(legacy).sessionsDir, `${owner.sessionId}.json`), { force: true });
		const first = repairGovernanceState(legacy, { env });
		const second = repairGovernanceState(legacy, { env });
		assert.ok(first.orphanedLeases >= 1);
		assert.equal(second.orphanedLeases, 0);
		assert.equal(listResourceLeases(legacy).length, 0);
		const report = formatRepairReport(first);
		assert.match(report, /Repaired:/);
		assert.match(report, /Blocked:\n {2}0/);
		console.log("ok: v0.10 unknown authority migrates idempotently");
	}

	// A proven live writer is not stolen by repair, and strict still requires takeover.
	{
		const strictRoot = join(root, "strict");
		mkdirSync(strictRoot, { recursive: true });
		linkProject(packageRoot, strictRoot, { env });
		setGovernanceProfile(strictRoot, "strict", { env });
		assert.equal(readGovernanceProfile(strictRoot, { env }), "strict");
		const holder = createSession(strictRoot, { sessionId: "strict-holder", host: "codex", mode: "write", worktreePath: strictRoot });
		const contender = createSession(strictRoot, { sessionId: "strict-next", host: "grok", mode: "write", worktreePath: strictRoot });
		const held = acquireResourceWriteAuthority(strictRoot, { sessionId: holder.sessionId, worktreePath: strictRoot });
		held.expiresAt = new Date(Date.now() - 1000).toISOString();
		held.lastActivityAt = held.expiresAt;
		writeFileSync(join(pathsFor(strictRoot).resourceLocksDir, `${held.resource.id}.write.lock`, "lease.json"), JSON.stringify(held));
		const repair = repairGovernanceState(strictRoot, { env });
		assert.equal(repair.orphanedLeases, 0);
		assert.ok(readResourceLeaseForWorktree(strictRoot, strictRoot));
		const ctx = resolveExecutionContext({
			cwd: strictRoot,
			host: "grok",
			environment: { ...env, HELI_SESSION_ID: contender.sessionId },
			createIfMissing: false,
		});
		const decision = evaluateOwnershipGate(ctx, { isWrite: true, mutationPaths: [join(strictRoot, "src", "app.ts")], env });
		assert.equal(decision.deny, true);
		assert.equal(decision.code, "STALE_RESOURCE_AUTHORITY");
		console.log("ok: strict profile keeps stale takeover and does not steal the record");
	}

	// Symlinks inside the workspace stay inside. A symlink that leaves is outside.
	{
		const inside = join(project, "inside");
		const outside = join(root, "outside");
		mkdirSync(inside, { recursive: true });
		mkdirSync(outside, { recursive: true });
		writeFileSync(join(inside, "note.txt"), "in\n");
		symlinkSync(join(inside, "note.txt"), join(project, "alias.txt"));
		symlinkSync(outside, join(project, "escape"));
		assert.equal(isPathInside(project, normalizePathIdentity(join(project, "alias.txt"))), true);
		assert.equal(isPathInside(project, normalizePathIdentity(join(project, "escape"))), false);
		console.log("ok: internal symlink allowed and escaping symlink blocked");
	}

	// Parent workspace plus a nested Git repository registers. It does not create a second workspace.
	{
		const nested = join(project, "repos", "frontend");
		mkdirSync(nested, { recursive: true });
		git(["init", "-q"], nested);
		const registration = linkProject(packageRoot, nested, { env });
		assert.equal(registration.nestedRepositoryRegistered, true);
		assert.equal(registration.workspaceId, parentLink.workspaceId);
		assert.equal(registration.workspaceRoot, parentLink.workspaceRoot);
		assert.equal(registration.repository.path, "repos/frontend");
		console.log("ok: nested repository registers into the parent workspace");
	}

	const cli = spawnSync(process.execPath, [join(packageRoot, "bin", "heli.mjs"), "governance", "show", project, "--json"], {
		encoding: "utf8",
		env,
	});
	assert.equal(cli.status, 0, cli.stderr);
	assert.equal(JSON.parse(cli.stdout).data.profile, "flow");
	const repaired = spawnSync(process.execPath, [join(packageRoot, "bin", "heli.mjs"), "doctor", "--repair", project], {
		encoding: "utf8",
		env,
	});
	assert.equal(repaired.status, 0, repaired.stdout + repaired.stderr);
	assert.match(repaired.stdout, /Repaired:/);
	assert.match(repaired.stdout, /orphaned mutation lease/);
	console.log("ok: governance show and doctor --repair");

	const idle = createSession(project, { sessionId: "idle-session", host: "pi", mode: "observe", worktreePath: project });
	idle.lastSeenAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
	writeFileSync(join(pathsFor(project).sessionsDir, `${idle.sessionId}.json`), JSON.stringify(idle));
	const closedIdle = repairGovernanceState(project, { env, orphanSessionAfterMs: 1000 });
	assert.ok(closedIdle.staleSessions >= 1);
	assert.equal(readSession(project, idle.sessionId).status, "closed");
	console.log("ok: doctor repair closes an idle session that holds no live mutation");

	console.log("smoke-v011-flow-governance: ok");
} finally {
	if (oldConfig == null) delete process.env.HELI_CONFIG_DIR;
	else process.env.HELI_CONFIG_DIR = oldConfig;
	if (oldData == null) delete process.env.HELI_DATA_DIR;
	else process.env.HELI_DATA_DIR = oldData;
	rmSync(root, { recursive: true, force: true });
}
