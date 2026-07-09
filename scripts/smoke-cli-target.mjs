#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { listRepos, showTarget, setTarget, clearTarget } from "../lib/cli/target.mjs";

const heliPath = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "heli.mjs");

function runHeliTarget(cwdForProcess, targetArgs) {
	return spawnSync(process.execPath, [heliPath, "target", ...targetArgs], { cwd: cwdForProcess, encoding: "utf8" });
}

function fixtureIndex(cwd, repos) {
	const dir = join(cwd, ".heli-harness", "workspace");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "index.json"), JSON.stringify({ schemaVersion: 1, repos }));
}

function readTargetJson(cwd) {
	return JSON.parse(readFileSync(join(cwd, ".heli-harness", "workspace", "target.json"), "utf8"));
}

function withTempDir(fn) {
	const dir = mkdtempSync(join(tmpdir(), "heli-cli-target-"));
	try {
		fn(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

withTempDir((cwd) => {
	const result = listRepos(cwd);
	assert.equal(result.configured, false, "no index.json means not configured");
});

withTempDir((cwd) => {
	fixtureIndex(cwd, [{ name: "repo-a", path: "repos/repo-a", gitRoot: "repos/repo-a", profile: ".heli-harness/profiles/repo-a.md", defaultTarget: true }]);
	const result = listRepos(cwd);
	assert.equal(result.configured, true);
	assert.equal(result.repos.length, 1);
	assert.equal(result.repos[0].name, "repo-a");
});

withTempDir((cwd) => {
	fixtureIndex(cwd, [{ name: "Repo-A", path: "repos/repo-a", gitRoot: "repos/repo-a", profile: ".heli-harness/profiles/repo-a.md" }]);
	const result = setTarget(cwd, "repo-a");
	assert.equal(result.needsConfirm, false);
	assert.equal(result.target.targetRepo, "Repo-A", "match is case-insensitive but preserves the index's stored casing");
	const written = readTargetJson(cwd);
	assert.equal(written.targetRepo, "Repo-A");
	assert.equal(written.targetGitRoot, "repos/repo-a");
	assert.equal(written.selectedBy, "heli-cli");
});

withTempDir((cwd) => {
	fixtureIndex(cwd, [{ name: "repo-a", path: "repos/repo-a", gitRoot: "repos/repo-a" }]);
	assert.throws(() => setTarget(cwd, "nonexistent"), /No workspace repo matched/);
});

withTempDir((cwd) => {
	fixtureIndex(cwd, [
		{ name: "repo-a", path: "repos/repo-a", gitRoot: "repos/repo-a" },
		{ name: "repo-b", path: "repos/repo-b", gitRoot: "repos/repo-b" },
	]);
	setTarget(cwd, "repo-a");
	const result = setTarget(cwd, "repo-b");
	assert.equal(result.needsConfirm, true);
	assert.equal(result.currentRepo, "repo-a");
	assert.equal(result.newRepo, "repo-b");
	const stillTargeted = readTargetJson(cwd);
	assert.equal(stillTargeted.targetRepo, "repo-a", "mismatch without confirm must not write");
});

withTempDir((cwd) => {
	fixtureIndex(cwd, [
		{ name: "repo-a", path: "repos/repo-a", gitRoot: "repos/repo-a" },
		{ name: "repo-b", path: "repos/repo-b", gitRoot: "repos/repo-b" },
	]);
	setTarget(cwd, "repo-a");
	const result = setTarget(cwd, "repo-b", { confirm: true });
	assert.equal(result.needsConfirm, false);
	const written = readTargetJson(cwd);
	assert.equal(written.targetRepo, "repo-b");
});

withTempDir((cwd) => {
	fixtureIndex(cwd, [{ name: "repo-a", path: "repos/repo-a", gitRoot: "repos/repo-a" }]);
	setTarget(cwd, "repo-a");
	clearTarget(cwd);
	const cleared = readTargetJson(cwd);
	assert.equal(cleared.targetRepo, "");
	assert.equal(cleared.reason, "cleared");
});

withTempDir((cwd) => {
	fixtureIndex(cwd, [{ name: "repo-a", path: "repos/repo-a", gitRoot: "repos/repo-a", profile: ".heli-harness/profiles/repo-a.md" }]);
	setTarget(cwd, "repo-a");
	const result = showTarget(cwd);
	assert.equal(result.targetRepo, "repo-a");
	assert.equal(result.activeProfile, ".heli-harness/profiles/repo-a.md");
});

// --- runTarget CLI-facing path-argument threading ---
// Regression coverage for a real bug: runTarget previously always used
// process.cwd() and silently ignored any path argument, so pointing the CLI
// at a different workspace still read/wrote the process's own cwd with zero
// indication anything was wrong. These spawn the real binary from a THIRD,
// unrelated cwd to prove the path argument -- not process.cwd() -- is honored.
withTempDir((otherCwd) => {
	withTempDir((targetDir) => {
		fixtureIndex(otherCwd, [{ name: "repo-in-other-cwd", path: "repos/repo-in-other-cwd", gitRoot: "repos/repo-in-other-cwd" }]);
		fixtureIndex(targetDir, [{ name: "repo-in-target", path: "repos/repo-in-target", gitRoot: "repos/repo-in-target" }]);

		const list = runHeliTarget(otherCwd, ["list", targetDir]);
		assert.equal(list.status, 0);
		assert.ok(list.stdout.includes("repo-in-target"), "target list <path> must read the given path's index");
		assert.ok(!list.stdout.includes("repo-in-other-cwd"), "target list <path> must not fall back to process.cwd()'s index");

		const setResult = runHeliTarget(otherCwd, ["set", "repo-in-target", targetDir]);
		assert.equal(setResult.status, 0);
		assert.ok(setResult.stdout.includes("Target repo set: repo-in-target"));
		const writtenInTarget = readTargetJson(targetDir);
		assert.equal(writtenInTarget.targetRepo, "repo-in-target", "target set <repo> <path> must write into the given path, not process.cwd()");

		const show = runHeliTarget(otherCwd, ["show", targetDir]);
		assert.equal(show.status, 0);
		assert.ok(show.stdout.includes("Target repo: repo-in-target"), "target show <path> must read the given path's target.json");

		const clear = runHeliTarget(otherCwd, ["clear", targetDir]);
		assert.equal(clear.status, 0);
		const clearedInTarget = readTargetJson(targetDir);
		assert.equal(clearedInTarget.targetRepo, "", "target clear <path> must clear the given path's target.json, not process.cwd()'s");

		assert.ok(!list.stderr, "no stderr on the list case");
	});
});

console.log("cli target smoke ok");
