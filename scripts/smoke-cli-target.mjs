#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listRepos, showTarget, setTarget, clearTarget } from "../lib/cli/target.mjs";

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

console.log("cli target smoke ok");
