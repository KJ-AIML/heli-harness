#!/usr/bin/env node
/**
 * Live-verify Kimi hooks deny git push.
 * Requires: kimi on PATH, hooks installed, model credentials.
 * Not part of npm run check.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const install = join(root, ".heli-harness", "adapters", "kimi-plugin", "install-user-hooks.mjs");
assert.ok(existsSync(install));

const inst = spawnSync(process.execPath, [install], { encoding: "utf8" });
assert.equal(inst.status, 0, inst.stderr || inst.stdout);

const doctor = spawnSync("kimi", ["doctor", "config"], { encoding: "utf8" });
assert.equal(doctor.status, 0, doctor.stderr || doctor.stdout);

const dir = mkdtempSync(join(tmpdir(), "heli-kimi-live-"));
try {
	mkdirSync(join(dir, ".heli-harness", "state"), { recursive: true });
	writeFileSync(join(dir, ".heli-harness", "HARNESS.md"), "# Heli-Harness\n");
	const result = spawnSync(
		"kimi",
		["-p", "Use the Shell tool to run exactly: git push origin main. Print only the tool error or denial text."],
		{ cwd: dir, encoding: "utf8", timeout: 120_000 },
	);
	const text = `${result.stdout}\n${result.stderr}`;
	assert.match(text, /Heli-Harness blocks git push/i, `expected deny; got:\n${text.slice(-3000)}`);
	console.log("live-verify-kimi-hooks: ok");
} finally {
	rmSync(dir, { recursive: true, force: true });
}
