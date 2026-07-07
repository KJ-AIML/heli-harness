#!/usr/bin/env node

import assert from "node:assert/strict";
import { join } from "node:path";
import { assertFile, assertHookDeny, assertHookAllowInCwd, assertHookDenyInCwd, assertSessionContext, json, nodeCheck, read, sessionContextInCwd, withFixtureWorkspace } from "./lib/plugin-smoke-helpers.mjs";

const root = process.cwd();
const plugin = ".heli-harness/adapters/codex-plugin";
const pluginRoot = join(root, plugin);

assertFile(join(pluginRoot, ".codex-plugin", "plugin.json"), "Codex plugin manifest");
assertFile(join(pluginRoot, "hooks", "hooks.json"), "Codex hook config");
assertFile(join(pluginRoot, "skills", "heli-governance", "SKILL.md"), "Codex plugin skill");
assertFile(join(pluginRoot, "skills", "heli-target", "SKILL.md"), "Codex plugin heli-target skill");
assertFile(join(pluginRoot, "skills", "heli-install", "SKILL.md"), "Codex plugin heli-install skill");
assertFile(join(pluginRoot, "AGENTS.md"), "Codex plugin AGENTS.md");

const manifest = json(join(pluginRoot, ".codex-plugin", "plugin.json"));
assert.equal(manifest.name, "heli-harness");
assert.equal(manifest.version, "0.5.16");
assert.equal(manifest.skills, "./skills/");
assert.equal(manifest.hooks, "./hooks/hooks.json");

const hooks = json(join(pluginRoot, "hooks", "hooks.json"));
assert.ok(hooks.hooks.SessionStart, "Codex plugin should define SessionStart");
assert.ok(hooks.hooks.PreToolUse, "Codex plugin should define PreToolUse");

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
// Real Codex apply_patch calls embed the target path in a patch body under
// `command` (confirmed by capturing a live Codex session's actual hook
// input), not a path/file field — a synthetic { path: ... } payload here
// would pass without exercising the real shape and hide the bug it once did.
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

withFixtureWorkspace({
	".heli-harness/HARNESS.md": "# Heli-Harness\n",
	".heli-harness/state/current-task.md": "# Current Task\n\nTarget repo:\n\nCurrent status: in progress\n\nFailed attempts count: 0\n",
	".heli-harness/workspace/target.json": JSON.stringify({ targetRepo: "repo-a" }),
}, (cwd) => {
	// Regression: an empty "Target repo:" field must not let field()'s regex
	// greedily consume the blank line and capture the next label as the value.
	assertHookAllowInCwd(root, hookScript, cwd, writeCall);
});

withFixtureWorkspace({
	".heli-harness/HARNESS.md": "# Heli-Harness\n",
	".heli-harness/state/plan.md": "# Plan: Demo\n\n## Step 1: First step\n\nStatus: blocked\n\nAttempts: 2\n",
}, (cwd) => {
	assertHookDenyInCwd(root, hookScript, cwd, writeCall, /plan\.md step "Step 1: First step" shows 2 failed attempts/);
});

withFixtureWorkspace({
	".heli-harness/HARNESS.md": "# Heli-Harness\n",
	".heli-harness/state/plan.md": "# Plan: Demo\n\n## Step 1: First step\n\nStatus: complete\n\nAttempts: 1\n\n## Step 2: Second step\n\nStatus: pending\n\nAttempts: 0\n",
}, (cwd) => {
	assertHookAllowInCwd(root, hookScript, cwd, writeCall);
});

withFixtureWorkspace({
	".heli-harness/HARNESS.md": "# Heli-Harness\n",
	".heli-harness/state/plan.md": "# Plan: Demo\n\n## Step 1: First step\n\nStatus: blocked\n\nAttempts: 2\n",
}, (cwd) => {
	assertHookAllowInCwd(root, hookScript, cwd, {
		tool_name: "Write",
		tool_input: { file_path: ".heli-harness/state/plan.md" },
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

withFixtureWorkspace({
	".heli-harness/HARNESS.md": "# Heli-Harness\n",
	".heli-harness/state/plan.md": "# Plan: Demo ledger\n\n## Step 1: First step\n\nStatus: complete\n\nAttempts: 1\n\n## Step 2: Second step\n\nStatus: pending\n\nAttempts: 0\n\n## Step 3: Third step\n\nStatus: pending\n\nAttempts: 0\n",
}, (cwd) => {
	const context = sessionContextInCwd(root, sessionScript, cwd);
	assert.match(context, /Active plan: Demo ledger/);
	assert.match(context, /Progress: 1\/3 steps complete/);
	assert.match(context, /Current step: Step 2: Second step — status: pending — attempts: 0/);
});

withFixtureWorkspace({
	".heli-harness/HARNESS.md": "# Heli-Harness\n",
}, (cwd) => {
	const context = sessionContextInCwd(root, sessionScript, cwd);
	assert.ok(!/Active plan:/.test(context), "no plan.md present should mean no injection");
});

withFixtureWorkspace({
	".heli-harness/HARNESS.md": "# Heli-Harness\n",
	".heli-harness/state/plan.md": "# Plan: Demo ledger\n\n## Step 1: Only step\n\nStatus: complete\n\nAttempts: 1\n",
}, (cwd) => {
	const context = sessionContextInCwd(root, sessionScript, cwd);
	assert.match(context, /Progress: 1\/1 steps complete/);
	assert.match(context, /All steps complete\./);
});

assertFile(join(pluginRoot, ".agents", "plugins", "marketplace.json"), "Codex plugin marketplace manifest");
const marketplace = json(join(pluginRoot, ".agents", "plugins", "marketplace.json"));
assert.equal(marketplace.plugins?.[0]?.source?.path, ".");

const codex = json(join(root, ".heli-harness", "adapters", "adapters.json")).adapters.find((adapter) => adapter.id === "codex");
assert.equal(codex.status, "enforced");
assert.ok(codex.evidence.includes(".heli-harness/adapters/codex-plugin/.codex-plugin/plugin.json"));
assert.ok(codex.evidence.includes(".heli-harness/adapters/codex-plugin/.agents/plugins/marketplace.json"));
assert.ok(codex.evidence.includes("scripts/live-verify-codex-plugin-hook.mjs"));
assert.ok(codex.verification.includes("node scripts/smoke-codex-plugin.mjs"));
assert.ok(codex.verification.includes("node scripts/live-verify-codex-plugin-install.mjs"));
assert.ok(codex.verification.includes("node scripts/live-verify-codex-plugin-hook.mjs"));

const matrix = read(join(root, "docs", "ADAPTER_SUPPORT_MATRIX.md"));
const row = matrix.split("\n").find((line) => line.includes("**Codex**")) || "";
assert.match(row, /enforced/);

console.log("codex plugin smoke ok");
