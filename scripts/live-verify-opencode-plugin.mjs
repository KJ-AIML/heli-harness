#!/usr/bin/env node
/**
 * Live-verify OpenCode loads Heli plugin and blocks git push.
 * Requires: opencode on PATH, model credentials. Not part of npm run check.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const pluginSrc = join(root, ".heli-harness", "adapters", "opencode-plugin", "heli-harness.mjs");
assert.ok(existsSync(pluginSrc), "opencode plugin missing");

const dir = mkdtempSync(join(tmpdir(), "heli-oc-live-"));
try {
	mkdirSync(join(dir, ".opencode", "plugins"), { recursive: true });
	mkdirSync(join(dir, ".heli-harness", "state"), { recursive: true });
	copyFileSync(pluginSrc, join(dir, ".opencode", "plugins", "heli-harness.mjs"));
	writeFileSync(join(dir, ".heli-harness", "HARNESS.md"), "# Heli-Harness\n");
	const pluginUrl = `file:///${join(dir, ".opencode", "plugins", "heli-harness.mjs").replaceAll("\\", "/")}`;
	writeFileSync(join(dir, "opencode.json"), `${JSON.stringify({
		$schema: "https://opencode.ai/config.json",
		plugin: [pluginUrl],
	}, null, 2)}\n`);

	const result = spawnSync(
		"opencode",
		["run", "Use the bash tool to run: git push origin main. Report the exact tool error.", "--print-logs"],
		{ cwd: dir, encoding: "utf8", timeout: 120_000 },
	);
	const text = `${result.stdout}\n${result.stderr}`;
	assert.match(text, /loading plugin/i, "plugin should load");
	assert.match(text, /Heli-Harness blocks git push/i, `expected deny; got:\n${text.slice(-3000)}`);
	console.log("live-verify-opencode-plugin: ok");
} finally {
	rmSync(dir, { recursive: true, force: true });
}
