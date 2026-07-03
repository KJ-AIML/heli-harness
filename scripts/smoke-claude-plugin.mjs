#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { assertFile, assertHookDeny, assertHookAllowInCwd, assertHookDenyInCwd, assertSessionContext, json, nodeCheck, read, sessionContextInCwd, withFixtureWorkspace } from "./lib/plugin-smoke-helpers.mjs";

const root = process.cwd();
const plugin = ".heli-harness/adapters/claude-plugin";
const pluginRoot = join(root, plugin);

assertFile(join(pluginRoot, ".claude-plugin", "plugin.json"), "Claude plugin manifest");
assertFile(join(pluginRoot, "hooks", "hooks.json"), "Claude hook config");
assertFile(join(pluginRoot, "skills", "heli-governance", "SKILL.md"), "Claude plugin skill");
assertFile(join(pluginRoot, "skills", "heli-target", "SKILL.md"), "Claude plugin heli-target skill");
assertFile(join(pluginRoot, "skills", "heli-install", "SKILL.md"), "Claude plugin heli-install skill");

const manifest = json(join(pluginRoot, ".claude-plugin", "plugin.json"));
assert.equal(manifest.name, "heli-harness");
assert.equal(manifest.version, "0.5.16");

const hooks = json(join(pluginRoot, "hooks", "hooks.json"));
assert.ok(hooks.hooks.SessionStart, "Claude plugin should define SessionStart");
assert.ok(hooks.hooks.PreToolUse, "Claude plugin should define PreToolUse");

for (const rel of [
	`${plugin}/hooks/heli-session-start.mjs`,
	`${plugin}/hooks/heli-pre-tool-use.mjs`,
]) {
	nodeCheck(root, rel);
}

assertSessionContext(root, `${plugin}/hooks/heli-session-start.mjs`);
assertHookDeny(root, `${plugin}/hooks/heli-pre-tool-use.mjs`, {
	tool_name: "Bash",
	tool_input: { command: "git push origin main" },
}, /git push/);
assertHookDeny(root, `${plugin}/hooks/heli-pre-tool-use.mjs`, {
	tool_name: "Write",
	tool_input: { file_path: ".env" },
}, /\.env/);
// apply_patch-style calls (e.g. Codex, or Bash-driven patch flows) embed the
// target path in a patch body under `command`, not a path/file field.
assertHookDeny(root, `${plugin}/hooks/heli-pre-tool-use.mjs`, {
	tool_name: "apply_patch",
	tool_input: { command: "*** Begin Patch\n*** Add File: .env\n+FOO=bar\n*** End Patch\n" },
}, /\.env/);

const hookScript = `${plugin}/hooks/heli-pre-tool-use.mjs`;
const writeCall = { tool_name: "Write", tool_input: { file_path: "notes.txt" } };

withFixtureWorkspace({
	".heli-harness/HARNESS.md": "# Heli-Harness\n",
	".heli-harness/state/current-task.md": "# Current Task\n\nTarget repo: demo\n\nCurrent status: blocked\n\nFailed attempts count: 2\n",
}, (cwd) => {
	assertHookDenyInCwd(root, hookScript, cwd, writeCall, /2 failed attempts/);
});

withFixtureWorkspace({
	".heli-harness/HARNESS.md": "# Heli-Harness\n",
	".heli-harness/state/current-task.md": "# Current Task\n\nTarget repo: repo-a\n\nCurrent status: in progress\n\nFailed attempts count: 0\n",
	".heli-harness/workspace/target.json": JSON.stringify({ targetRepo: "repo-b" }),
}, (cwd) => {
	assertHookDenyInCwd(root, hookScript, cwd, writeCall, /target repo "repo-a".*"repo-b"/s);
});

withFixtureWorkspace({
	".heli-harness/HARNESS.md": "# Heli-Harness\n",
	".heli-harness/state/current-task.md": "# Current Task\n\nTarget repo: repo-a\n\nCurrent status: in progress\n\nFailed attempts count: 0\n",
	".heli-harness/workspace/target.json": JSON.stringify({ targetRepo: "repo-a" }),
}, (cwd) => {
	assertHookAllowInCwd(root, hookScript, cwd, writeCall);
});

withFixtureWorkspace({
	".heli-harness/HARNESS.md": "# Heli-Harness\n",
	".heli-harness/state/current-task.md": "# Current Task\n\nTarget repo: demo\n\nCurrent status: blocked\n\nFailed attempts count: 2\n",
}, (cwd) => {
	assertHookAllowInCwd(root, hookScript, cwd, {
		tool_name: "Write",
		tool_input: { file_path: ".heli-harness/state/current-task.md" },
	});
});

const sessionScript = `${plugin}/hooks/heli-session-start.mjs`;

withFixtureWorkspace({
	".heli-harness/HARNESS.md": "# Heli-Harness\n",
	".heli-harness/state/decisions.md": "# Decisions\n\n## alpha\n\n- oldest, should be dropped\n\n## bravo\n\n- kept\n\n## charlie\n\n- kept\n\n## delta\n\n- kept\n\n## echo\n\n- kept\n\n## foxtrot\n\n- newest, kept\n",
}, (cwd) => {
	const context = sessionContextInCwd(root, sessionScript, cwd);
	assert.match(context, /Recent durable decisions/);
	assert.match(context, /foxtrot/);
	assert.ok(!/alpha/.test(context), "oldest section (6th from newest) should have been dropped");
});

withFixtureWorkspace({
	".heli-harness/HARNESS.md": "# Heli-Harness\n",
}, (cwd) => {
	const context = sessionContextInCwd(root, sessionScript, cwd);
	assert.ok(!/Recent durable decisions/.test(context), "no decisions.md present should mean no injection");
});

const claude = json(join(root, ".heli-harness", "adapters", "adapters.json")).adapters.find((adapter) => adapter.id === "claude");
assert.equal(claude.status, "enforced");
assert.ok(claude.evidence.includes(".heli-harness/adapters/claude-plugin/.claude-plugin/plugin.json"));
assert.ok(claude.evidence.includes("scripts/live-verify-claude-plugin.mjs"));
assert.ok(claude.verification.includes("node scripts/smoke-claude-plugin.mjs"));
assert.ok(claude.verification.includes("node scripts/live-verify-claude-plugin.mjs"));

const matrix = read(join(root, "docs", "ADAPTER_SUPPORT_MATRIX.md"));
const row = matrix.split("\n").find((line) => line.includes("**Claude Code**")) || "";
assert.match(row, /enforced/);

const validate = spawnSync("claude", ["plugin", "validate", pluginRoot], {
	cwd: root,
	encoding: "utf8",
	stdio: ["ignore", "pipe", "pipe"],
});
if (validate.error && validate.error.code !== "ENOENT") throw validate.error;
if (!validate.error) assert.equal(validate.status, 0, validate.stderr || validate.stdout);

console.log("claude plugin smoke ok");
