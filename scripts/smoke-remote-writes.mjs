#!/usr/bin/env node
/**
 * Remote writes that are not spelled `git push` need approval too.
 *
 * The push gate only read `git push`, so `gh pr merge` (which lands a pull request on its base branch, often the default
 * one) and `git subtree push` changed a remote's branches with no approval, and nothing guarded a GitHub release, a
 * registry push or a live cluster/infrastructure change. Now:
 *  - `gh pr merge`, `glab mr merge` and `git subtree push` are remote git writes: the same gate and `git.push` approval
 *    as `git push`, with a reason that names the command;
 *  - the shipped rules ask for approval for `gh release create`, `docker push`, `kubectl apply|delete` and
 *    `terraform apply|destroy` (rules-file T5 rules, so a project can drop them), with `kubectl ... --dry-run=client|server`
 *    and `<words> --help` read-only.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluatePreToolUse } from "../.heli-harness/adapters/shared/hook-core.mjs";
import { scrubHeliProcessEnv } from "./lib/hermetic-env.mjs";

scrubHeliProcessEnv();
const root = process.cwd();
const scratch = mkdtempSync(join(tmpdir(), "heli-remote-writes-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
const env = { ...process.env, HELI_CONFIG_DIR: join(scratch, "config"), HELI_DATA_DIR: join(scratch, "data") };

const dir = join(scratch, "ws");
mkdirSync(join(dir, ".heli-harness", "state"), { recursive: true });
mkdirSync(join(dir, ".heli-harness", "safety"), { recursive: true });
writeFileSync(join(dir, ".heli-harness", "HARNESS.md"), "# Heli\n");
writeFileSync(join(dir, ".heli-harness", "state", "current-task.md"), "# Current Task\n\nTarget repo: demo\n\nCurrent status: in progress\n\nFailed attempts count: 0\n");
writeFileSync(join(dir, ".heli-harness", "safety", "command-rules.json"), readFileSync(join(root, ".heli-harness", "safety", "command-rules.json"), "utf8"));
const run = (command, extraEnv = {}) => evaluatePreToolUse({ cwd: dir, host: "test", env: { ...env, ...extraEnv }, toolName: "Bash", toolInput: { command } });

// 1. Remote git writes: the push gate.
for (const [command, named] of [
	["gh pr merge 12 --squash", "gh pr merge"],
	["gh pr merge --auto --merge", "gh pr merge"],
	["glab mr merge 3", "glab mr merge"],
	["git subtree push --prefix dist origin gh-pages", "git subtree push"],
	["git -C repo subtree push --prefix docs origin docs", "git subtree push"],
	["npm test && gh pr merge 7", "gh pr merge"],
]) {
	const result = run(command);
	assert.equal(result.code, "REMOTE_PUSH_DENIED", command);
	assert.ok(result.reason.includes(named), `${command}: ${result.reason}`);
	assert.match(result.reason, /--action git\.push/);
	assert.equal(run(command, { HELI_ALLOW_GIT_PUSH: "1" }).deny, false, `${command}: the push approval covers it`);
}
assert.match(run("git push origin main").reason, /^Heli-Harness blocks git push without scoped authority/, "a push reads as before");
for (const command of ["gh pr create --fill", "gh pr view 12", "gh pr checks 12", "glab mr view 3", "git subtree split --prefix dist"]) {
	assert.equal(run(command).deny, false, command);
}

// 2. The shipped release / registry / live-infrastructure rules.
for (const [command, id] of [
	["gh release create v1.2.0 --notes x", "gh-release-create"],
	["docker push ghcr.io/acme/app:1.2.0", "docker-push"],
	["kubectl apply -f deploy.yaml", "kubectl-apply"],
	["kubectl apply -f deploy.yaml --dry-run=none", "kubectl-apply"],
	["kubectl delete pod web-0", "kubectl-delete"],
	["terraform apply -auto-approve", "terraform-apply"],
	["terraform destroy", "terraform-destroy"],
]) {
	const result = run(command);
	assert.equal(result.code, "TIER_APPROVAL_REQUIRED", command);
	assert.equal(result.ruleId, id, command);
	assert.equal(run(command, { HELI_ALLOW_COMMAND: id }).deny, false, `${command}: its approval`);
}
for (const command of [
	"kubectl apply -f deploy.yaml --dry-run=client",
	"kubectl apply --dry-run=server -f deploy.yaml",
	"kubectl delete pod web-0 --dry-run=client",
	"docker push --help",
	"terraform apply --help",
	"terraform plan",
	"kubectl get pods",
	"docker build -t app .",
	"gh release view v1.2.0",
]) {
	assert.equal(run(command).deny, false, command);
}

console.log("remote writes smoke ok");
