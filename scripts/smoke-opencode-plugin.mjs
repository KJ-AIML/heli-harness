#!/usr/bin/env node

import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	assertFile,
	nodeCheck,
	withFixtureWorkspace,
} from "./lib/plugin-smoke-helpers.mjs";

const root = process.cwd();
const pluginRel = ".heli-harness/adapters/opencode-plugin/heli-harness.mjs";
const pluginPath = join(root, pluginRel);

assertFile(pluginPath, "OpenCode plugin module");
assertFile(join(root, ".heli-harness/adapters/opencode-plugin/plugin.json"), "OpenCode plugin.json");
assertFile(join(root, ".heli-harness/adapters/opencode-plugin/hooks/hooks.json"), "OpenCode hooks.json");
nodeCheck(root, pluginRel);
nodeCheck(root, ".heli-harness/adapters/shared/hook-core.mjs");

const mod = await import(pathToFileURL(pluginPath).href);
assert.equal(typeof mod.HeliHarness, "function");
assert.equal(typeof mod.default, "function");

// Plugin resolves shared hook-core from process.cwd() (package root during smoke).
// Gate evaluation uses the fixture directory passed as ctx.directory.

await withFixtureWorkspace({
	".heli-harness/HARNESS.md": "# Heli-Harness\n",
	".heli-harness/state/current-task.md": "# Current Task\n\nTarget repo: demo\n\nCurrent status: blocked\n\nFailed attempts count: 2\n",
}, async (cwd) => {
	const hooks = await mod.HeliHarness({ directory: cwd });
	await assert.rejects(
		() => hooks["tool.execute.before"](
			{ tool: "bash" },
			{ args: { command: "git push origin main" } },
		),
		/git push/,
	);
	await assert.rejects(
		() => hooks["tool.execute.before"](
			{ tool: "write" },
			{ args: { filePath: ".env" } },
		),
		/\.env/,
	);
	await assert.rejects(
		() => hooks["tool.execute.before"](
			{ tool: "write" },
			{ args: { filePath: "notes.txt" } },
		),
		/2 failed attempts/,
	);
});

await withFixtureWorkspace({
	".heli-harness/HARNESS.md": "# Heli-Harness\n",
	".heli-harness/state/current-task.md": "# Current Task\n\nTarget repo: demo\n\nCurrent status: in progress\n\nFailed attempts count: 0\n",
}, async (cwd) => {
	const hooks = await mod.HeliHarness({ directory: cwd });
	await hooks["tool.execute.before"](
		{ tool: "write" },
		{ args: { filePath: "notes.txt" } },
	);

	const compactOut = { context: [] };
	await hooks["experimental.session.compacting"]({}, compactOut);
	assert.ok(compactOut.context.some((c) => /Heli-Harness plugin context/.test(c)));
});

console.log("smoke-opencode-plugin: ok");
