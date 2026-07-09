#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	assertFile,
	assertHookDeny,
	assertHookDenyInCwd,
	assertHookAllowInCwd,
	assertSessionContext,
	nodeCheck,
	read,
	withFixtureWorkspace,
} from "./lib/plugin-smoke-helpers.mjs";

const root = process.cwd();
const plugin = ".heli-harness/adapters/kimi-plugin";
const pluginRoot = join(root, plugin);
const pre = `${plugin}/hooks/heli-pre-tool-use.mjs`;
const session = `${plugin}/hooks/heli-session-start.mjs`;

assertFile(join(pluginRoot, "plugin.json"), "Kimi plugin.json");
assertFile(join(pluginRoot, "config.toml.example"), "Kimi config example");
assertFile(join(pluginRoot, "install-user-hooks.mjs"), "Kimi installer");
assertFile(join(pluginRoot, "hooks", "hooks.json"), "Kimi hooks.json");
assert.ok(existsSync(join(pluginRoot, "README.md")));

const config = read(join(pluginRoot, "config.toml.example"));
assert.match(config, /PreToolUse/);
assert.match(config, /heli-pre-tool-use/);

for (const rel of [session, pre, `${plugin}/install-user-hooks.mjs`]) {
	nodeCheck(root, rel);
}

assertSessionContext(root, session);
assertHookDeny(root, pre, {
	tool_name: "Shell",
	tool_input: { command: "git push origin main" },
}, /git push/);
assertHookDeny(root, pre, {
	tool_name: "WriteFile",
	tool_input: { file_path: ".env" },
}, /\.env/);

const writeCall = { tool_name: "WriteFile", tool_input: { file_path: "notes.txt" } };

withFixtureWorkspace({
	".heli-harness/HARNESS.md": "# Heli-Harness\n",
	".heli-harness/state/current-task.md": "# Current Task\n\nTarget repo: demo\n\nCurrent status: blocked\n\nFailed attempts count: 2\n",
}, (cwd) => {
	assertHookDenyInCwd(root, pre, cwd, writeCall, /2 failed attempts/);
});

withFixtureWorkspace({
	".heli-harness/HARNESS.md": "# Heli-Harness\n",
	".heli-harness/state/current-task.md": "# Current Task\n\nTarget repo: demo\n\nCurrent status: in progress\n\nFailed attempts count: 0\n",
}, (cwd) => {
	assertHookAllowInCwd(root, pre, cwd, writeCall);
});

console.log("smoke-kimi-plugin: ok");
