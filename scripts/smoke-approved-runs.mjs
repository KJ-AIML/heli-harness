#!/usr/bin/env node
/**
 * Approved runs: a human approves a plan once, and the agent works it without asking about what the plan approved.
 *
 * Before, every push of an overnight plan needed the user at a terminal (or a grant that allowed every branch, `main`
 * included, or YOLO, which turned every other block off). `heli run approve plan.md` reads the plan's `heli-run` block,
 * shows what it allows and what stays blocked, and records the run: a push grant limited to the plan's own branch (never
 * main/master or the remote's default), void when the plan text changes, revoked when the run is done or stopped, expiring
 * with it; bound to the agent session working near the plan, which SessionStart tells about the run. Approving is human-only
 * (a terminal, and the hooks refuse an agent-run `heli run approve`); `done`, `blocked`, `resume` and `stop` are not.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { linkProject } from "../lib/cli/link.mjs";
import { runRun } from "../lib/cli/run.mjs";
import { setupHeli } from "../lib/cli/setup.mjs";
import { listGrants } from "../lib/concurrency/grant.mjs";
import { currentRun, listRuns, parseRunEnvelope, runSessionLine, runStoreDir } from "../lib/concurrency/runs.mjs";
import { evaluatePreToolUse } from "../.heli-harness/adapters/shared/hook-core.mjs";
import { resolveExecutionContext } from "../.heli-harness/adapters/shared/concurrency/resolve.mjs";
import { scrubHeliProcessEnv } from "./lib/hermetic-env.mjs";

scrubHeliProcessEnv();
const startedIn = process.cwd();
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "heli-approved-runs-")));
const project = join(scratch, "project");
const repo = join(project, "app");
const env = { ...process.env, HELI_CONFIG_DIR: join(scratch, "config"), HELI_DATA_DIR: join(scratch, "data") };
process.env.HELI_CONFIG_DIR = env.HELI_CONFIG_DIR;
process.env.HELI_DATA_DIR = env.HELI_DATA_DIR;
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
const human = { terminal: { stdin: true, stdout: true } };
const quiet = (fn) => {
	const log = console.log;
	console.log = () => {};
	try {
		return fn();
	} finally {
		console.log = log;
	}
};
const throwsCode = (fn, code) => assert.throws(() => quiet(fn), (error) => error.code === code, code);

// ------------------------------------------------------------------ 1. the heli-run block
assert.deepEqual(parseRunEnvelope("x\n```heli-run\nbranch: feat/a\npush: yes\n```\n"), { branch: "feat/a", push: true, remote: "origin", hours: 8, keepGoing: true });
assert.deepEqual(parseRunEnvelope("```heli-run\n# only work, no pushes\nkeep-going: no  # quiet\nhours: 2\n```"), { branch: null, push: false, remote: "origin", hours: 2, keepGoing: false });
for (const [text, code] of [
	["no block here", "RUN_ENVELOPE_MISSING"],
	["```heli-run\nbranch: feat/a\nsudo: yes\n```", "RUN_ENVELOPE_INVALID"],
	["```heli-run\npush: yes\n```", "RUN_ENVELOPE_INVALID"],
	["```heli-run\nbranch: feat/a b\npush: yes\n```", "RUN_ENVELOPE_INVALID"],
	["```heli-run\nbranch: feat/a\nhours: 48\n```", "RUN_ENVELOPE_INVALID"],
	["```heli-run\npush: maybe\n```", "RUN_ENVELOPE_INVALID"],
]) {
	throwsCode(() => parseRunEnvelope(text), code);
}

// ------------------------------------------------------------------ 2. a linked project, a repo, an agent session
const git = (...args) => {
	const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
	assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
	return result.stdout.trim();
};
mkdirSync(repo, { recursive: true });
git("init", "-q", "-b", "main");
writeFileSync(join(repo, "a.txt"), "a\n");
git("add", "a.txt");
git("commit", "-q", "-m", "init");
git("checkout", "-q", "-b", "feat/run-x");
git("remote", "add", "origin", join(scratch, "remote.git"));
git("update-ref", "refs/remotes/origin/feat/run-x", "HEAD");
git("config", "branch.feat/run-x.remote", "origin");
git("config", "branch.feat/run-x.merge", "refs/heads/feat/run-x");
git("update-ref", "refs/remotes/origin/integration", "HEAD");
git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/integration");
setupHeli({ env });
linkProject(startedIn, project, { env });

const sessionFor = (hostSessionId) => resolveExecutionContext({ cwd: repo, environment: env, hookPayload: { session_id: hostSessionId }, host: "claude", createIfMissing: true }).sessionId;
const other = sessionFor("claude-other-window");
const agent = sessionFor("claude-agent"); // the most recently active session near the plan
const plan = join(repo, "plan.md");
const writePlan = (block) => writeFileSync(plan, `# Plan: wire the thing\n\n1. edit\n2. test\n3. push\n\n\`\`\`heli-run\n${block}\n\`\`\`\n`);
const push = (command) => evaluatePreToolUse({ cwd: repo, host: "claude", env, toolName: "Bash", toolInput: { command } });
const pushVerdict = (command) => (push(command).deny ? push(command).code : "allow");

// ------------------------------------------------------------------ 3. approving is the human's
writePlan("branch: feat/run-x\npush: yes");
throwsCode(() => runRun(["approve", plan, "--yes"], { terminal: { stdin: false, stdout: false } }), "HUMAN_TERMINAL_REQUIRED");
assert.equal(push(`heli run approve ${plan} --yes`).code, "TIER_BLOCKED", "the hooks refuse an agent-run approval");
for (const command of ["heli run status", "heli run done", "heli run blocked \"need the API key\"", "heli run stop"]) {
	assert.equal(push(command).deny, false, `${command} gives no authority`);
}
assert.equal(listRuns(project, { env }).length, 0, "nothing was approved");

// A run never pushes a default branch: main/master and the like, or the remote's own default.
writePlan("branch: main\npush: yes");
throwsCode(() => runRun(["approve", plan, "--yes"], human), "RUN_BRANCH_PROTECTED");
writePlan("branch: integration\npush: yes");
throwsCode(() => runRun(["approve", plan, "--yes"], human), "RUN_BRANCH_PROTECTED");

// ------------------------------------------------------------------ 4. an approved run
writePlan("branch: feat/run-x\npush: yes\nhours: 4");
assert.equal(pushVerdict("git push origin feat/run-x"), "REMOTE_PUSH_DENIED", "before approval");
const { run } = quiet(() => runRun(["approve", plan, "--yes"], human));
assert.equal(run.status, "active");
assert.equal(run.branch, "feat/run-x");
assert.equal(run.sessionId, agent, "bound to the agent session most recently active near the plan");
assert.ok(Math.abs(Date.parse(run.expiresAt) - Date.now() - 4 * 3600_000) < 60_000);
assert.ok(runStoreDir(project, { env }).startsWith(env.HELI_DATA_DIR), "kept in Heli's own data directory");
const [grant] = listGrants(project, { activeOnly: true, env }).filter((item) => item.runId === run.runId);
assert.deepEqual(grant.constraint.branches, ["feat/run-x"]);

assert.equal(pushVerdict("git push origin feat/run-x"), "allow");
assert.equal(pushVerdict("git push"), "allow", "its upstream is the approved branch");
assert.equal(pushVerdict("git push origin main"), "REMOTE_PUSH_DENIED");
assert.equal(pushVerdict("git push --force origin feat/run-x"), "REMOTE_PUSH_DENIED");
{
	const tag = push("git tag v1 && git push origin v1");
	assert.equal(tag.deny, true, "tags still need their own approval");
	assert.deepEqual([...tag.missingApprovals].sort(), ["command.approval.git-tag", "git.push"], "the tag, and the push of a ref that is not the plan's branch");
}
assert.equal(pushVerdict("npm publish"), "TIER_APPROVAL_REQUIRED");
assert.equal(pushVerdict("rm -rf build"), "TIER_BLOCKED");

// SessionStart tells the bound session about the run, and no other.
assert.match(runSessionLine(project, { sessionId: agent, env }), new RegExp(`Heli approved run ${run.runId} \\(active\\).*pushes allowed only to origin/feat/run-x.*heli run done.*heli run blocked`));
assert.equal(runSessionLine(project, { sessionId: other, env }), null);

// The agent reports: blocked keeps the grant (the user may answer), resume picks the run up again.
quiet(() => runRun(["blocked", "need the staging API key", project]));
assert.equal(currentRun(project, { env }).status, "blocked");
assert.equal(currentRun(project, { env }).blocked.reason, "need the staging API key");
assert.equal(pushVerdict("git push origin feat/run-x"), "allow");
quiet(() => runRun(["resume", project]));
assert.equal(currentRun(project, { env }).status, "active");

// An edited plan voids the approval.
writePlan("branch: feat/run-x\npush: yes\nhours: 4\n# and also main please");
assert.equal(pushVerdict("git push origin feat/run-x"), "REMOTE_PUSH_DENIED");
writePlan("branch: feat/run-x\npush: yes\nhours: 4");
assert.equal(pushVerdict("git push origin feat/run-x"), "allow");

// done ends it: the grant is revoked.
quiet(() => runRun(["done", "--note", "all green", project]));
assert.equal(currentRun(project, { env }), null);
assert.equal(listRuns(project, { env })[0].status, "done");
assert.equal(pushVerdict("git push origin feat/run-x"), "REMOTE_PUSH_DENIED");

// stop ends one at once; an expired run is over; --no-keep-going binds no session.
quiet(() => runRun(["approve", plan, "--yes", "--no-keep-going"], human));
const quietRun = currentRun(project, { env });
assert.equal(quietRun.keepGoing, false);
assert.equal(quietRun.sessionId, null);
quiet(() => runRun(["stop", project]));
assert.equal(currentRun(project, { env }), null);
assert.equal(pushVerdict("git push origin feat/run-x"), "REMOTE_PUSH_DENIED");
quiet(() => runRun(["approve", plan, "--yes"], human));
const recordPath = join(runStoreDir(project, { env }), `${currentRun(project, { env }).runId}.json`);
writeFileSync(recordPath, JSON.stringify({ ...JSON.parse(readFileSync(recordPath, "utf8")), expiresAt: "2026-01-01T00:00:00.000Z" }));
assert.equal(currentRun(project, { env }), null, "expired");

// A plan with no pushes approves work only.
writePlan("keep-going: yes");
quiet(() => runRun(["approve", plan, "--yes"], human));
assert.equal(currentRun(project, { env }).push, false);
assert.equal(currentRun(project, { env }).grantIds.length, 0);
assert.equal(pushVerdict("git push origin feat/run-x"), "REMOTE_PUSH_DENIED");

console.log("approved runs smoke ok");
