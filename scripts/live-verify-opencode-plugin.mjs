#!/usr/bin/env node
/**
 * Live-verify OpenCode loads the Heli plugin from .opencode/plugins/ and blocks git push.
 * Requires: opencode on PATH, model credentials. Not part of npm run check.
 *
 * Layout notes (verified against OpenCode 1.18.21):
 * - Auto-discovery covers .js/.ts files under .opencode/plugins/; .mjs is NOT discovered.
 * - The entry imports ./shared/hook-core.mjs relative to itself, so copy the whole tree.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const pluginSrc = join(root, ".heli-harness", "adapters", "opencode-plugin");
const pluginEntry = join(pluginSrc, "heli-harness.js");
assert.ok(existsSync(pluginEntry), `opencode plugin entry missing: ${pluginEntry}`);

const dir = mkdtempSync(join(tmpdir(), "heli-oc-live-"));
try {
	mkdirSync(join(dir, ".heli-harness", "state"), { recursive: true });
	cpSync(pluginSrc, join(dir, ".opencode", "plugins"), { recursive: true });
	writeFileSync(join(dir, ".heli-harness", "HARNESS.md"), "# Heli-Harness\n");

	const result = spawnSync(
		"opencode",
		["run", "Use the bash tool to run: git push origin main. Report the exact tool error."],
		{
			cwd: dir,
			encoding: "utf8",
			timeout: 180_000,
			// spawnSync cwd does not update $PWD; a stale $PWD makes the CLI attach
			// to an ambient project/server for the invoking directory and execute
			// bash there instead of the isolated workspace.
			env: { ...process.env, PWD: dir, OLDPWD: dir },
		},
	);
	const text = `${result.stdout}\n${result.stderr}`;
	assert.match(
		text,
		/Heli-Harness blocks git push/i,
		`expected live deny proving the plugin loaded and blocked; got:\n${text.slice(-3000)}`,
	);
	console.log("live-verify-opencode-plugin: ok");
} finally {
	rmSync(dir, { recursive: true, force: true });
}
