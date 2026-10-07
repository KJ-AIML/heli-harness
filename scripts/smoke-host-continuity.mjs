#!/usr/bin/env node
import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
	appendFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import {
	canonicalizePath,
	closeSession,
	continuationForWorktree,
	listTasks,
	readResourceLeaseForWorktree,
	resolveExecutionContext,
} from "../lib/concurrency/index.mjs";
import { buildSessionContext, evaluatePreToolUse } from "../.heli-harness/adapters/shared/hook-core.mjs";
import { buildResumeContext } from "../lib/cli/resume.mjs";

const scratch = mkdtempSync(join(tmpdir(), "heli-host-continuity-"));
const workspace = join(scratch, "workspace");
const repo = join(workspace, "repos", "app");
const src = join(repo, "src");
const file = join(src, "continuity.txt");
const config = join(scratch, "config");
const data = join(scratch, "data");
const home = join(scratch, "home");
const heli = join(process.cwd(), "bin", "heli.mjs");
const env = {
	...process.env,
	HELI_CONFIG_DIR: config,
	HELI_DATA_DIR: data,
	HOME: home,
	USERPROFILE: home,
};
const priorEnv = {
	HELI_CONFIG_DIR: process.env.HELI_CONFIG_DIR,
	HELI_DATA_DIR: process.env.HELI_DATA_DIR,
	HOME: process.env.HOME,
	USERPROFILE: process.env.USERPROFILE,
};
Object.assign(process.env, {
	HELI_CONFIG_DIR: config,
	HELI_DATA_DIR: data,
	HOME: home,
	USERPROFILE: home,
});

function run(command, args, { cwd = workspace } = {}) {
	const result = spawnSync(command, args, { cwd, env, encoding: "utf8" });
	assert.equal(result.status, 0, `${command} ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
	return result;
}

function heliRun(args, cwd = workspace) {
	return run(process.execPath, [heli, ...args], { cwd });
}

function hostStart(host, externalId) {
	const payload = { session_id: externalId };
	const text = buildSessionContext(repo, {
		host,
		hookPayload: payload,
		env,
		recordSessionStart: true,
	});
	const ctx = resolveExecutionContext({
		cwd: repo,
		host,
		hookPayload: payload,
		environment: env,
		createIfMissing: false,
	});
	assert.ok(ctx.sessionId, `${host} SessionStart must create/resume a Heli session`);
	assert.equal(ctx.workspaceRoot, workspaceReal);
	assert.equal(ctx.worktreeRoot, repoReal);
	return { text, ctx, payload };
}

function writeDecision(host, payload, suffix) {
	return evaluatePreToolUse({
		cwd: repo,
		toolName: "Write",
		toolInput: { file_path: file, content: `${suffix}\n` },
		host,
		hookPayload: payload,
		env,
	});
}

mkdirSync(src, { recursive: true });
mkdirSync(home, { recursive: true });
run("git", ["init", "-q", repo]);
writeFileSync(file, "baseline\n");
run("git", ["add", "."], { cwd: repo });
run("git", ["-c", "user.name=Heli Test", "-c", "user.email=heli@example.invalid", "commit", "-qm", "baseline"], { cwd: repo });

heliRun(["setup", "--json"]);
const linked = JSON.parse(heliRun(["link", workspace, "--json"]).stdout);
assert.equal(linked.ok, true);
const workspaceReal = linked.data.workspaceRoot;
const registered = JSON.parse(heliRun(["link", repo, "--json"], repo).stdout);
assert.equal(registered.data.nestedRepositoryRegistered, true);
const repoReal = canonicalizePath(
	spawnSync("git", ["-C", repo, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).stdout.trim(),
);

// Codex starts and performs meaningful taskless work.
const codex = hostStart("codex", "codex-live-1");
assert.ok(!codex.text.includes("Durable continuation available"), "first host must not invent prior work");
const codexWrite = writeDecision("codex", codex.payload, "codex");
assert.equal(codexWrite.deny, false, codexWrite.reason);
assert.ok(codexWrite.continuation, "allowed taskless write must create continuation");
appendFileSync(file, "codex\n");

const firstContinuation = continuationForWorktree(workspaceReal, repoReal, { env });
assert.ok(firstContinuation);
assert.equal(firstContinuation.provenance.lastHost, "codex");
assert.equal(firstContinuation.repositoryPath, "repos/app");
assert.ok(firstContinuation.intentPaths.includes("src/continuity.txt"));
assert.equal(listTasks(workspaceReal, { env }).length, 0, "continuity must not fabricate an explicit task");

const codexAuthority = readResourceLeaseForWorktree(workspaceReal, repoReal);
assert.equal(codexAuthority.sessionId, codex.ctx.sessionId);

// Pi can see continuation but may not steal a still-live Codex writer.
const piBlocked = hostStart("pi", "pi-live-1");
assert.match(piBlocked.text, /Durable continuation available from previous meaningful work/i);
assert.match(piBlocked.text, /Previous host: codex/i);
const blocked = writeDecision("pi", piBlocked.payload, "pi-blocked");
assert.equal(blocked.deny, true);
assert.equal(blocked.code, "RESOURCE_WRITER_HELD");
assert.equal(blocked.recoverability, "HUMAN_REQUIRED");
assert.equal(blocked.retryable, false);

// Cleanly closing Codex releases exactly Codex's resource authority.
const closedCodex = closeSession(workspaceReal, codex.ctx.sessionId);
assert.equal(closedCodex.status, "closed");
assert.equal(closedCodex.releasedResourceAuthorities.length, 1);
assert.equal(readResourceLeaseForWorktree(workspaceReal, repoReal), null);

// Pi now continues the same durable work and acquires fresh authority.
const piWrite = writeDecision("pi", piBlocked.payload, "pi");
assert.equal(piWrite.deny, false, piWrite.reason);
appendFileSync(file, "pi\n");
let continuation = continuationForWorktree(workspaceReal, repoReal, { env });
assert.equal(continuation.continuationId, firstContinuation.continuationId);
assert.equal(continuation.provenance.lastHost, "pi");
assert.equal(readResourceLeaseForWorktree(workspaceReal, repoReal).sessionId, piBlocked.ctx.sessionId);

const resumeFromPi = buildResumeContext(repo, { env });
assert.equal(resumeFromPi.currentContinuation.continuationId, firstContinuation.continuationId);
assert.equal(resumeFromPi.currentContinuation.provenance.lastHost, "pi");
assert.ok(resumeFromPi.guidance.some((line) => /writer authority is never inherited/i.test(line)));
assert.equal(resumeFromPi.tasks.length, 0);

// Continue through additional enforced host identities. Each new host gets the
// same durable continuation, but only after the prior writer closes can it write.
let previous = piBlocked;
for (const [host, id] of [
	["claude", "claude-live-1"],
	["opencode", "opencode-live-1"],
]) {
	closeSession(workspaceReal, previous.ctx.sessionId);
	assert.equal(readResourceLeaseForWorktree(workspaceReal, repoReal), null);
	const next = hostStart(host, id);
	assert.match(next.text, /Durable continuation available from previous meaningful work/i);
	const decision = writeDecision(host, next.payload, host);
	assert.equal(decision.deny, false, decision.reason);
	appendFileSync(file, `${host}\n`);
	continuation = continuationForWorktree(workspaceReal, repoReal, { env });
	assert.equal(continuation.continuationId, firstContinuation.continuationId);
	assert.equal(continuation.provenance.lastHost, host);
	assert.equal(readResourceLeaseForWorktree(workspaceReal, repoReal).sessionId, next.ctx.sessionId);
	previous = next;
}

closeSession(workspaceReal, previous.ctx.sessionId);
assert.equal(readResourceLeaseForWorktree(workspaceReal, repoReal), null);
assert.equal(listTasks(workspaceReal, { env }).length, 0);

const finalResume = buildResumeContext(repo, { env });
assert.equal(finalResume.currentContinuation.provenance.firstHost, "codex");
assert.equal(finalResume.currentContinuation.provenance.lastHost, "opencode");
assert.equal(finalResume.authority.state, "available");
assert.equal(finalResume.git.dirty, true);
assert.ok(finalResume.git.changes.some((change) => change.path === "src/continuity.txt"));

console.log("smoke-host-continuity: codex -> pi -> claude -> opencode passed without YOLO");

for (const [key, value] of Object.entries(priorEnv)) {
	if (value == null) delete process.env[key];
	else process.env[key] = value;
}
rmSync(scratch, { recursive: true, force: true });
