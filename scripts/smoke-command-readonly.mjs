#!/usr/bin/env node
/**
 * Read-only forms of the shipped release rules need no approval; the release actions still do.
 *
 * `git tag -l`, a bare `npm version`, `npm publish --dry-run` and `heli sync auto` print or check something and change
 * nothing, but they used to need `heli grant issue` like a real tag, version bump, publish or sync, so an agent stopped to ask.
 * The read-only forms are recognized for the rules Heli ships (keyed by rule id and the rule's own words, so a project that
 * rewrites a rule keeps its own reading), and `<rule words> --help` is help for every rules-file T5 rule. Anything else,
 * including a read-only flag next to a write one (`git tag -l -d v1`), still needs its approval.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateCommandRules } from "../.heli-harness/adapters/shared/command-policy.mjs";
import { evaluatePreToolUse } from "../.heli-harness/adapters/shared/hook-core.mjs";
import { scrubHeliProcessEnv } from "./lib/hermetic-env.mjs";

scrubHeliProcessEnv();
const root = process.cwd();
const scratch = mkdtempSync(join(tmpdir(), "heli-command-readonly-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
const env = { ...process.env, HELI_CONFIG_DIR: join(scratch, "config"), HELI_DATA_DIR: join(scratch, "data") };

function workspace(name, rules) {
	const dir = join(scratch, name);
	mkdirSync(join(dir, ".heli-harness", "state"), { recursive: true });
	mkdirSync(join(dir, ".heli-harness", "safety"), { recursive: true });
	writeFileSync(join(dir, ".heli-harness", "HARNESS.md"), "# Heli\n");
	writeFileSync(join(dir, ".heli-harness", "state", "current-task.md"), "# Current Task\n\nTarget repo: demo\n\nCurrent status: in progress\n\nFailed attempts count: 0\n");
	writeFileSync(join(dir, ".heli-harness", "safety", "command-rules.json"), rules ?? readFileSync(join(root, ".heli-harness", "safety", "command-rules.json"), "utf8"));
	return dir;
}
const dir = workspace("ws");
const approvalsFor = (command, at = dir) => evaluateCommandRules(at, command, {}, { comments: "posix" }).approvals.map((match) => match.id);

// Still release actions: each needs its approval.
for (const [command, id] of [
	["git tag v1.2.0", "git-tag"],
	["git tag v1.2.0 HEAD~1", "git-tag"],
	["git tag -a v1 -m release", "git-tag"],
	["git tag -s v1", "git-tag"],
	["git tag -f v1", "git-tag"],
	["git tag -fa v1", "git-tag"],
	["git tag -d v1", "git-tag"],
	["git tag --delete v1", "git-tag"],
	["git tag -l -d v1", "git-tag"], // a read-only flag next to a write one
	["git tag --list --annotate v1", "git-tag"],
	["git tag -F notes.txt v1", "git-tag"],
	["git -C repo tag v2", "git-tag"],
	["git tag --help v1", "git-tag"], // --help is only help on its own
	["npm version patch", "npm-version"],
	["npm version 1.2.3", "npm-version"],
	["npm version --json patch", "npm-version"],
	["npm version major --no-git-tag-version", "npm-version"],
	["npm publish", "npm-publish"],
	["npm publish --tag next", "npm-publish"],
	["npm publish --dry-run=false", "npm-publish"],
	["npm publish --dry-run --no-dry-run", "npm-publish"],
	["pnpm publish", "pnpm-publish"],
	["yarn publish --dry-run", "yarn-publish"], // yarn 1 has no dry run
	["heli sync", "heli-cloud-sync"],
	["heli sync --force", "heli-cloud-sync"],
	["heli sync auto on", "heli-cloud-sync"],
	["heli sync e2e off", "heli-cloud-sync"],
	["node .heli-harness/heli.mjs sync", "heli-mjs-cloud-sync"],
	["npm run release", "npm-run-release"],
	["npm run version", "npm-run-version"],
	["heli push", "heli-cloud-push"],
]) {
	assert.ok(approvalsFor(command).includes(id), `${command} needs ${id} (got ${JSON.stringify(approvalsFor(command))})`);
}

// Read-only: no approval.
for (const command of [
	"git tag",
	"git tag -l",
	"git tag --list 'v1.*'",
	"git tag -l 'v1.*' --sort=-v:refname",
	"git tag -n5",
	"git tag -n",
	"git tag --contains HEAD",
	"git tag --no-contains HEAD",
	"git tag --points-at HEAD",
	"git tag --merged main",
	"git tag --no-merged main",
	"git tag -v v1.0.0",
	"git tag --verify v1.0.0",
	"git tag -l > tags.txt",
	"git tag -l 2>/dev/null",
	"git -C repo tag -l",
	"git tag --help",
	"git tag -l | head -5",
	"npm version",
	"npm version --json",
	"npm version > versions.txt",
	"npm publish --dry-run",
	"npm publish --dry-run --tag next",
	"npm publish --dry-run=true",
	"pnpm publish --dry-run",
	"npm publish --help",
	"heli sync auto",
	"heli sync e2e",
	"heli sync --help",
	"node .heli-harness/heli.mjs sync auto",
	"heli push --help",
]) {
	assert.deepEqual(approvalsFor(command), [], `${command} is read-only`);
}

// A project that rewrites a shipped rule keeps its own reading: the read-only forms belong to the shipped words.
{
	const custom = workspace("custom", JSON.stringify({ version: 1, rules: [
		{ id: "git-tag", match: "git tag -l", tier: "T5", reason: "this project approves even tag listing" },
		{ id: "npm-version", match: "npm", tier: "T5", reason: "every npm call" },
	] }));
	assert.deepEqual(approvalsFor("git tag -l", custom), ["git-tag"]);
	assert.deepEqual(approvalsFor("npm version", custom), ["npm-version"]);
	assert.deepEqual(approvalsFor("npm --help", custom), [], "help is help for any rules-file T5 rule");
}
// A rules-file T6 rule is never relaxed by --help.
{
	const strict = workspace("strict", JSON.stringify({ version: 1, rules: [{ id: "no-terraform-destroy", match: "terraform destroy", tier: "T6", reason: "x" }] }));
	assert.deepEqual(evaluateCommandRules(strict, "terraform destroy --help", {}).hardDenies.map((match) => match.id), ["no-terraform-destroy"]);
}

// Through the hook.
const run = (command) => evaluatePreToolUse({ cwd: dir, host: "test", env, toolName: "Bash", toolInput: { command } });
assert.equal(run("git tag -l").deny, false);
assert.equal(run("npm publish --dry-run").deny, false);
assert.equal(run("heli sync auto").deny, false);
const tag = run("git tag v9");
assert.equal(tag.deny, true);
assert.equal(tag.code, "TIER_APPROVAL_REQUIRED");
assert.match(tag.reason, /command\.approval\.git-tag/);

console.log("command read-only forms smoke ok");
