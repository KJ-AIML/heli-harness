#!/usr/bin/env node
/**
 * Command rules: every rule is evaluated, T6 can never be approved, each T5
 * needs its own approval, grants are consumed only on a final allow, and a
 * built-in T6 floor survives an empty/missing/malformed rules file.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeCommand, commandRunsGitPush, matchCommandRules } from "../.heli-harness/adapters/shared/command-policy.mjs";
import { evaluatePreToolUse } from "../.heli-harness/adapters/shared/hook-core.mjs";
import { issueGrant, listGrants } from "../lib/concurrency/grant.mjs";
import { projectWorkspaceKey } from "../lib/concurrency/project-binding.mjs";
import { scrubHeliProcessEnv } from "./lib/hermetic-env.mjs";

scrubHeliProcessEnv();
const root = process.cwd();
const scratch = mkdtempSync(join(tmpdir(), "heli-command-rules-"));
const env = { ...process.env, HELI_CONFIG_DIR: join(scratch, "config"), HELI_DATA_DIR: join(scratch, "data") };
const shippedRules = readFileSync(join(root, ".heli-harness", "safety", "command-rules.json"), "utf8");

// ---------------------------------------------------------------- parsing
const T6_TABLE = [
	["rm -rf build", ["destructive-delete"]],
	["rm -fr build", ["destructive-delete"]],
	["rm -r -f build", ["destructive-delete"]],
	["rm -Rf build", ["destructive-delete"]],
	["rm --recursive --force build", ["destructive-delete"]],
	["sudo /bin/rm -rf /", ["destructive-delete"]],
	["\"rm\" -rf x", ["destructive-delete"]],
	["r\\m -rf x", ["destructive-delete"]],
	["git clean -fdx", ["git-clean-force"]],
	["git clean -xfd", ["git-clean-force"]],
	["git clean -f -d", ["git-clean-force"]],
	["git clean --force -x", ["git-clean-force"]],
	["rd /s /q build", ["windows-rmdir"]],
	["rmdir /s /q build", ["windows-rmdir"]],
	["RD /S/Q build", ["windows-rmdir"]],
	["del /s /q *.tmp", ["windows-del"]],
	["Remove-Item -Recurse -Force src", ["powershell-remove-item-recurse-force"]],
	["Remove-Item src -Force -Recurse", ["powershell-remove-item-recurse-force"]],
	["Remove-Item -r -fo src", ["powershell-remove-item-recurse-force"]],
	["git reset --hard", ["git-reset-hard"]],
	["git -C repo reset --hard HEAD~1", ["git-reset-hard"]],
	["find . -delete", ["find-delete"]],
	["find src -type f -delete", ["find-delete"]],
	["git push --force origin main", ["git-push-force"]],
	["git push -f", ["git-push-force"]],
	["git push --force-with-lease", ["git-push-force"]],
	["git push origin +main", ["git-push-force"]],
	["bash -c 'rm -rf /'", ["destructive-delete"]],
	["sh -c \"git reset --hard\"", ["git-reset-hard"]],
	["cmd /c rd /s /q C:\\build", ["windows-rmdir"]],
	["pwsh -Command \"Remove-Item -Recurse -Force src\"", ["powershell-remove-item-recurse-force"]],
	["powershell -EncodedCommand " + Buffer.from("Remove-Item -Recurse -Force src", "utf16le").toString("base64"), ["powershell-remove-item-recurse-force"]],
	["echo ok && rm -rf dist", ["destructive-delete"]],
	["true || rm -rf dist", ["destructive-delete"]],
	["ls | xargs rm -rf", ["destructive-delete"]],
	["echo $(rm -rf dist)", ["destructive-delete"]],
	["echo `git reset --hard`", ["git-reset-hard"]],
	["ls\nrm -rf dist", ["destructive-delete"]],
	["eval 'git reset --hard'", ["git-reset-hard"]],
	// Legitimate, non-destructive commands must not match any built-in rule.
	["rm -f build.log", []],
	["rm -r build", []],
	["git clean -n", []],
	["git clean -fdn", []],
	["Remove-Item file.txt", []],
	["Remove-Item -Recurse src", []],
	["find . -name '*.pyc' -delete", []],
	["git reset --soft HEAD~1", []],
	["git push origin main", []],
	["echo 'a; b'", []],
	["npm test", []],
];
for (const [command, expected] of T6_TABLE) {
	const got = matchCommandRules(analyzeCommand(command)).map((match) => match.id).sort();
	assert.deepEqual(got, [...expected].sort(), `built-in rules for ${JSON.stringify(command)}`);
}

const PUSH_TABLE = [
	["git push", true],
	["git -C . push", true],
	["git -c user.name=x push", true],
	["git --git-dir=.git push", true],
	["git --no-pager push", true],
	["\"git\" push", true],
	["g\\it push", true],
	["GIT PUSH", true],
	["git \\\npush", true],
	["bash -c 'git push'", true],
	["cmd /c git push", true],
	["pwsh -Command git push", true],
	["echo digit pushups", false],
	["getprop | grep push", false],
	["git pull", false],
	["git -C push status", false],
];
for (const [command, expected] of PUSH_TABLE) {
	assert.equal(commandRunsGitPush(analyzeCommand(command)), expected, `git push detection for ${JSON.stringify(command)}`);
}

// Analysis cost stays bounded. Every `eval` token unwraps to its own suffix, and
// re-parsing those suffixes at every nesting level took 11 s for 32 tokens and 35 s
// for 40 (the hook timeout is 30 s). Hosts treat a hook that times out as an allow,
// so a slow parse would let the T6 floor be bypassed.
const evalChainStart = Date.now();
const evalChainMatches = matchCommandRules(analyzeCommand(`${"eval ".repeat(40)}rm -rf build`)).map((match) => match.id);
assert.deepEqual(evalChainMatches, ["destructive-delete"]);
assert.ok(Date.now() - evalChainStart < 2000, `analyzing a 40-token eval chain took ${Date.now() - evalChainStart} ms`);

// ------------------------------------------------------------ evaluation
function workspace(name, rulesText = shippedRules, taskText = "# Current Task\n\nTarget repo: demo\n\nCurrent status: in progress\n\nFailed attempts count: 0\n") {
	const dir = join(scratch, name);
	mkdirSync(join(dir, ".heli-harness", "state"), { recursive: true });
	writeFileSync(join(dir, ".heli-harness", "HARNESS.md"), "# Heli\n");
	writeFileSync(join(dir, ".heli-harness", "state", "current-task.md"), taskText);
	if (rulesText != null) {
		mkdirSync(join(dir, ".heli-harness", "safety"), { recursive: true });
		writeFileSync(join(dir, ".heli-harness", "safety", "command-rules.json"), rulesText);
	}
	return dir;
}

function bash(cwd, command, extraEnv = {}) {
	return evaluatePreToolUse({ cwd, host: "test", env: { ...env, ...extraEnv }, toolName: "Bash", toolInput: { command } });
}

function writeFile(cwd, filePath) {
	return evaluatePreToolUse({ cwd, host: "test", env, toolName: "Write", toolInput: { file_path: filePath, content: "x" } });
}

function grant(ws, action) {
	return issueGrant(ws, { action, scope: "once", resource: { type: "workspace", id: projectWorkspaceKey(ws, { env }) }, env });
}

function remainingUses(ws, grantId) {
	return listGrants(ws, { activeOnly: false, env }).find((item) => item.grantId === grantId).remainingUses;
}

try {
	const ws = workspace("main");

	// A granted T5 cannot hide a T6 in the same command; the T5 grant is not spent.
	const tagGrant = grant(ws, "command.approval.git-tag");
	const mixed = bash(ws, "git tag v1.0.0 && rm -rf build");
	assert.equal(mixed.deny, true);
	assert.equal(mixed.hardDeny, true);
	assert.equal(mixed.code, "TIER_BLOCKED");
	assert.deepEqual(mixed.ruleIds, ["destructive-delete"]);
	assert.equal(remainingUses(ws, tagGrant.grantId), 1, "a denied call must not consume the T5 grant");

	// T6 is never approvable: not by HELI_ALLOW_COMMAND, not by YOLO.
	assert.equal(bash(ws, "rm -rf build", { HELI_ALLOW_COMMAND: "destructive-delete" }).code, "TIER_BLOCKED");
	assert.equal(bash(ws, "git reset --hard", { HELI_YOLO: "1" }).code, "TIER_BLOCKED");
	assert.match(bash(ws, "rm -rf build").reason, /tier T6.*hard deny/s);

	// Every matched T5 needs its own approval; consumption happens only on allow.
	const needsTwo = bash(ws, "git tag v1.0.0 && npm publish");
	assert.equal(needsTwo.deny, true);
	assert.equal(needsTwo.code, "TIER_APPROVAL_REQUIRED");
	assert.deepEqual(needsTwo.missingApprovals, ["command.approval.npm-publish"]);
	assert.equal(remainingUses(ws, tagGrant.grantId), 1);
	const publishGrant = grant(ws, "command.approval.npm-publish");
	const both = bash(ws, "git tag v1.0.0 && npm publish");
	assert.equal(both.deny, false, both.reason);
	assert.deepEqual(both.grants.map((item) => item.action).sort(), ["command.approval.git-tag", "command.approval.npm-publish"]);
	assert.equal(remainingUses(ws, tagGrant.grantId), 0);
	assert.equal(remainingUses(ws, publishGrant.grantId), 0);

	// Force push is its own T5 on top of git.push.
	const pushGrant = grant(ws, "git.push");
	const force = bash(ws, "git push --force origin main");
	assert.equal(force.deny, true);
	assert.deepEqual(force.missingApprovals, ["command.approval.git-push-force"]);
	assert.equal(remainingUses(ws, pushGrant.grantId), 1);
	grant(ws, "command.approval.git-push-force");
	assert.equal(bash(ws, "git push --force origin main").deny, false);

	// Legitimate commands stay allowed; a valid grant allows a plain push.
	for (const command of ["rm -f build.log", "git clean -n", "Remove-Item file.txt", "git status", "npm test"]) {
		const result = bash(ws, command);
		assert.equal(result.deny, false, `${command}: ${result.reason}`);
	}
	grant(ws, "git.push");
	assert.equal(bash(ws, "git push origin main").deny, false);
	assert.equal(bash(ws, "git push origin main").code, "REMOTE_PUSH_DENIED", "a once grant allows exactly one push");

	// A grant is not consumed when a later check denies (stuck task gate).
	const stuck = workspace("stuck", shippedRules, "# Current Task\n\nTarget repo: demo\n\nCurrent status: blocked\n\nFailed attempts count: 2\n");
	const envGrant = grant(stuck, "env.write");
	const stuckWrite = writeFile(stuck, ".env");
	assert.equal(stuckWrite.deny, true);
	assert.match(stuckWrite.reason, /failed attempts/);
	assert.equal(remainingUses(stuck, envGrant.grantId), 1, "env.write grant must survive a later deny");

	// Rules file states. Built-ins survive an empty file; a project rule cannot
	// weaken a built-in id.
	const empty = workspace("empty-rules", JSON.stringify({ version: 1, rules: [] }));
	assert.equal(bash(empty, "rm -rf build").code, "TIER_BLOCKED");
	assert.equal(bash(empty, "npm publish").deny, false, "no project T5 rules -> npm publish is not gated");
	const weakened = workspace("weakened-rules", JSON.stringify({ version: 1, rules: [{ id: "destructive-delete", match: "rm -rf", tier: "T4", reason: "downgrade attempt" }] }));
	assert.equal(bash(weakened, "rm -rf build").code, "TIER_BLOCKED");

	for (const [name, rulesText, status] of [["malformed-rules", "{not json", "malformed"], ["missing-rules", null, "missing"]]) {
		const dir = workspace(name, rulesText);
		const denied = bash(dir, "git status");
		assert.equal(denied.code, "COMMAND_RULES_UNAVAILABLE", `${name}: ${denied.reason}`);
		assert.match(denied.reason, new RegExp(`command-rules\\.json is ${status}`));
		assert.equal(writeFile(dir, "notes.txt").deny, false, `${name}: file edits are not affected`);
		assert.equal(bash(dir, "rm -rf build").code, "TIER_BLOCKED", `${name}: the built-in floor still applies`);
		assert.equal(bash(dir, "git status", { HELI_YOLO: "1" }).deny, false, `${name}: YOLO skips approval rules`);
	}

	// A directory with no Heli binding at all must not start denying everything.
	const plain = join(scratch, "no-heli");
	mkdirSync(plain, { recursive: true });
	for (const command of ["npm test", "git status", "ls -la"]) {
		assert.equal(bash(plain, command).deny, false, `no-binding ${command}`);
	}
	assert.equal(writeFile(plain, "notes.txt").deny, false);
	assert.equal(bash(plain, "rm -rf /").code, "TIER_BLOCKED", "the T6 floor applies everywhere hooks run");

	console.log("command rules smoke ok");
} finally {
	rmSync(scratch, { recursive: true, force: true });
}
