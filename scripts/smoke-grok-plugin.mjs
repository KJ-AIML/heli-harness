#!/usr/bin/env node

import assert from "node:assert/strict";
import { join } from "node:path";
import {
	assertFile,
	assertGrokHookDeny,
	assertGrokHookDenyInCwd,
	assertGrokHookAllowInCwd,
	assertSessionContext,
	json,
	nodeCheck,
	withFixtureWorkspace,
} from "./lib/plugin-smoke-helpers.mjs";

const root = process.cwd();
const plugin = ".heli-harness/adapters/grok-plugin";
const pluginRoot = join(root, plugin);
const pre = `${plugin}/hooks/heli-pre-tool-use.mjs`;
const session = `${plugin}/hooks/heli-session-start.mjs`;

assertFile(join(pluginRoot, ".claude-plugin", "plugin.json"), "Grok .claude-plugin manifest");
assertFile(join(pluginRoot, ".grok-plugin", "plugin.json"), "Grok .grok-plugin manifest");
assertFile(join(pluginRoot, "hooks", "hooks.json"), "Grok hook config");
assertFile(join(pluginRoot, "install-user-hooks.mjs"), "Grok user-hooks installer");
assertFile(join(pluginRoot, "skills", "heli-governance", "SKILL.md"), "Grok plugin skill");

const manifest = json(join(pluginRoot, ".claude-plugin", "plugin.json"));
assert.equal(manifest.name, "heli-harness");
assert.equal(typeof manifest.author, "object");
assert.ok(manifest.author.name);

const hooks = json(join(pluginRoot, "hooks", "hooks.json"));
assert.ok(hooks.hooks.SessionStart);
assert.ok(hooks.hooks.PreToolUse);

for (const rel of [session, pre, `${plugin}/install-user-hooks.mjs`]) {
	nodeCheck(root, rel);
}

assertSessionContext(root, session);
assertGrokHookDeny(root, pre, {
	tool_name: "Bash",
	tool_input: { command: "git push origin main" },
}, /git push/);
assertGrokHookDeny(root, pre, {
	tool_name: "Write",
	tool_input: { file_path: ".env" },
}, /\.env/);

const writeCall = { tool_name: "Write", tool_input: { file_path: "notes.txt" } };

withFixtureWorkspace({
	".heli-harness/HARNESS.md": "# Heli-Harness\n",
	".heli-harness/state/current-task.md": "# Current Task\n\nTarget repo: demo\n\nCurrent status: blocked\n\nFailed attempts count: 2\n",
}, (cwd) => {
	assertGrokHookDenyInCwd(root, pre, cwd, writeCall, /2 failed attempts/);
});

withFixtureWorkspace({
	".heli-harness/HARNESS.md": "# Heli-Harness\n",
	".heli-harness/state/current-task.md": "# Current Task\n\nTarget repo: repo-a\n\nCurrent status: in progress\n\nFailed attempts count: 0\n",
	".heli-harness/workspace/target.json": JSON.stringify({ targetRepo: "repo-a" }),
}, (cwd) => {
	assertGrokHookAllowInCwd(root, pre, cwd, writeCall);
});

console.log("smoke-grok-plugin: ok");
