#!/usr/bin/env node

import assert from "node:assert/strict";
import { join } from "node:path";
import {
	assertFile,
	assertHookDeny,
	assertHookDenyInCwd,
	assertHookAllowInCwd,
	assertSessionContext,
	json,
	nodeCheck,
	withFixtureWorkspace,
} from "./lib/plugin-smoke-helpers.mjs";

const root = process.cwd();
const plugin = ".heli-harness/adapters/antigravity-plugin";
const pluginRoot = join(root, plugin);
const sharedPre = ".heli-harness/adapters/shared/claude-style-pre-tool-use.mjs";
const sharedSession = ".heli-harness/adapters/shared/claude-style-session-start.mjs";

assertFile(join(pluginRoot, "plugin.json"), "Antigravity plugin manifest");
assertFile(join(pluginRoot, "hooks.json"), "Antigravity hooks.json");
assertFile(join(pluginRoot, "skills", "heli-governance", "SKILL.md"), "Antigravity skill");

const manifest = json(join(pluginRoot, "plugin.json"));
assert.equal(manifest.name, "heli-harness");

const hooks = json(join(pluginRoot, "hooks.json"));
assert.ok(hooks["heli-harness-pretool"]?.PreToolUse, "should define PreToolUse");
assert.ok(hooks["heli-harness-session"]?.SessionStart, "should define SessionStart");

for (const rel of [
	`${plugin}/hooks/heli-session-start.mjs`,
	`${plugin}/hooks/heli-pre-tool-use.mjs`,
	sharedPre,
	sharedSession,
]) {
	nodeCheck(root, rel);
}

assertSessionContext(root, sharedSession);
assertHookDeny(root, sharedPre, {
	tool_name: "run_command",
	tool_input: { command: "git push origin main" },
}, /git push/);
assertHookDeny(root, sharedPre, {
	tool_name: "write_to_file",
	tool_input: { file_path: ".env" },
}, /\.env/);

const writeCall = { tool_name: "write_to_file", tool_input: { file_path: "notes.txt" } };

withFixtureWorkspace({
	".heli-harness/HARNESS.md": "# Heli-Harness\n",
	".heli-harness/state/current-task.md": "# Current Task\n\nTarget repo: demo\n\nCurrent status: blocked\n\nFailed attempts count: 2\n",
}, (cwd) => {
	assertHookDenyInCwd(root, sharedPre, cwd, writeCall, /2 failed attempts/);
});

withFixtureWorkspace({
	".heli-harness/HARNESS.md": "# Heli-Harness\n",
	".heli-harness/state/current-task.md": "# Current Task\n\nTarget repo: demo\n\nCurrent status: in progress\n\nFailed attempts count: 0\n",
}, (cwd) => {
	assertHookAllowInCwd(root, sharedPre, cwd, writeCall);
});

console.log("smoke-antigravity-plugin: ok");
