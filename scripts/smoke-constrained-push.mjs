#!/usr/bin/env node
/**
 * A push grant can be limited to the branches a plan names.
 *
 * A `git.push` grant allowed every push, `main` included, so pre-approving the pushes of an overnight plan meant approving
 * a push to the default branch too. A grant can now carry a `git-push` constraint (an approved run's, see heli run): it
 * covers a remote git write only when every push it makes lands, unforced, on a listed branch of the listed remote, and
 * only while the plan file it was approved from is unchanged. The hook resolves where each push lands, asking git for what
 * the command leaves to it (a bare `git push` goes to `@{push}`, `HEAD` is the current branch); anything it cannot place
 * on a named branch (`--tags`, `--all`, a deletion, `gh pr merge`) is not covered. An unconstrained grant works as before.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { linkProject } from "../lib/cli/link.mjs";
import { setupHeli } from "../lib/cli/setup.mjs";
import { fileSha256, issueGrant, revokeGrant } from "../lib/concurrency/grant.mjs";
import { projectWorkspaceKey } from "../lib/concurrency/project-binding.mjs";
import { evaluatePreToolUse } from "../.heli-harness/adapters/shared/hook-core.mjs";
import { scrubHeliProcessEnv } from "./lib/hermetic-env.mjs";

scrubHeliProcessEnv();
const startedIn = process.cwd();
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "heli-constrained-push-")));
const project = join(scratch, "project");
const repo = join(project, "app");
const env = { ...process.env, HELI_CONFIG_DIR: join(scratch, "config"), HELI_DATA_DIR: join(scratch, "data") };
process.env.HELI_CONFIG_DIR = env.HELI_CONFIG_DIR;
process.env.HELI_DATA_DIR = env.HELI_DATA_DIR;
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));

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

setupHeli({ env });
linkProject(startedIn, project, { env });
const plan = join(project, "plan.md");
writeFileSync(plan, "# Plan\n\n```heli-run\nbranch: feat/run-x\npush: yes\n```\n");
const constrained = issueGrant(project, {
	action: "git.push",
	scope: "time",
	ttlSeconds: 3600,
	resource: { type: "workspace", id: projectWorkspaceKey(project, { env }) },
	constraint: { kind: "git-push", remote: "origin", branches: ["feat/run-x"], planPath: plan, planSha256: fileSha256(plan) },
	runId: "heli-run-test",
	env,
});
assert.equal(constrained.constraint.branches[0], "feat/run-x");

const push = (command) => evaluatePreToolUse({ cwd: repo, host: "test", env, toolName: "Bash", toolInput: { command } });
const verdict = (command) => {
	const result = push(command);
	return result.deny ? result.code : "allow";
};

for (const command of [
	"git push origin feat/run-x",
	"git push -u origin feat/run-x",
	"git push origin HEAD",
	"git push origin HEAD:feat/run-x",
	"git push origin HEAD:refs/heads/feat/run-x",
	"git push",
	"git push origin",
	"git -C . push origin feat/run-x",
	"npm test && git push origin feat/run-x",
	"git push --dry-run origin main && git push origin feat/run-x",
]) {
	assert.equal(verdict(command), "allow", command);
}
for (const command of [
	"git push origin main",
	"git push origin HEAD:main",
	"git push origin feat/run-x main",
	"git push origin feat/run-x && git push origin main",
	"git push upstream feat/run-x",
	"git push origin :feat/run-x",
	"git push --delete origin feat/run-x",
	"git push --tags origin",
	"git push --all origin",
	"git push origin v1.0",
	"git push origin refs/tags/v1.0",
	"git push --dry-run origin feat/run-x",
	"gh pr merge 12 --squash",
	"git subtree push --prefix dist origin feat/run-x",
]) {
	assert.equal(verdict(command), "REMOTE_PUSH_DENIED", command);
}
// A forced push to the branch is not covered either (and needs its own T5 approval besides).
assert.ok(push("git push --force origin feat/run-x").missingApprovals.includes("git.push"));
assert.ok(push("git push origin +feat/run-x").missingApprovals.includes("git.push"));

// The plan changed: the approval it carried is void.
writeFileSync(plan, "# Plan\n\n```heli-run\nbranch: main\npush: yes\n```\n");
assert.equal(verdict("git push origin feat/run-x"), "REMOTE_PUSH_DENIED", "an edited plan voids its push grant");
writeFileSync(plan, "# Plan\n\n```heli-run\nbranch: feat/run-x\npush: yes\n```\n");
assert.equal(verdict("git push origin feat/run-x"), "allow", "the approved text again");

// An unconstrained grant works as before: any branch.
revokeGrant(project, constrained.grantId, { env });
assert.equal(verdict("git push origin feat/run-x"), "REMOTE_PUSH_DENIED");
issueGrant(project, { action: "git.push", scope: "once", resource: { type: "workspace", id: projectWorkspaceKey(project, { env }) }, env });
assert.equal(verdict("git push origin main"), "allow");

console.log("constrained push smoke ok");
