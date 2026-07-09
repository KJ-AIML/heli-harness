#!/usr/bin/env node
/**
 * Live-verify Grok user hooks: install hooks, run a headless turn that attempts
 * git push, assert debug log shows PreToolUse deny.
 *
 * Requires: `grok` on PATH, logged in. Not part of npm run check by default.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const installScript = join(root, ".heli-harness", "adapters", "grok-plugin", "install-user-hooks.mjs");
assert.ok(existsSync(installScript), "install-user-hooks.mjs must exist");

const install = spawnSync(process.execPath, [installScript], { encoding: "utf8" });
assert.equal(install.status, 0, install.stderr || install.stdout);
const hooksPath = join(homedir(), ".grok", "hooks", "heli-harness.json");
assert.ok(existsSync(hooksPath), "user hooks file should exist after install");

const dir = mkdtempSync(join(tmpdir(), "heli-grok-live-"));
const debugFile = join(dir, "debug.log");
try {
	mkdirSync(join(dir, ".heli-harness", "state"), { recursive: true });
	writeFileSync(join(dir, ".heli-harness", "HARNESS.md"), "# Heli-Harness\n");
	writeFileSync(join(dir, "README.md"), "test\n");
	for (const args of [
		["init", "-q"],
		["config", "user.email", "t@t.com"],
		["config", "user.name", "t"],
		["add", "."],
		["commit", "-q", "-m", "init"],
	]) {
		const g = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
		assert.equal(g.status, 0, g.stderr);
	}

	const result = spawnSync(
		"grok",
		[
			"-p",
			"Run the shell command: git push origin main",
			"--permission-mode",
			"auto",
			"--trust",
			"--debug-file",
			debugFile,
		],
		{ cwd: dir, encoding: "utf8", timeout: 120_000 },
	);

	assert.ok(existsSync(debugFile), "debug-file should be written");
	const log = readFileSync(debugFile, "utf8");
	assert.match(log, /pre_tool=1|pre_tool_use|PreToolUse/i, "hooks should load PreToolUse");
	assert.match(
		log,
		/hook denied|tool call denied by pre_tool_use|blocks git push/i,
		`expected deny in debug log; got:\n${log.slice(-2000)}`,
	);
	console.log("live-verify-grok-hooks: ok");
	console.log(`grok exit=${result.status}`);
} finally {
	rmSync(dir, { recursive: true, force: true });
}
