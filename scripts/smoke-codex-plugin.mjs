#!/usr/bin/env node

import assert from "node:assert/strict";
import { join } from "node:path";
import { assertFile, assertHookDeny, assertSessionContext, json, nodeCheck, read } from "./lib/plugin-smoke-helpers.mjs";

const root = process.cwd();
const plugin = ".heli-harness/adapters/codex-plugin";
const pluginRoot = join(root, plugin);

assertFile(join(pluginRoot, ".codex-plugin", "plugin.json"), "Codex plugin manifest");
assertFile(join(pluginRoot, "hooks", "hooks.json"), "Codex hook config");
assertFile(join(pluginRoot, "skills", "heli-governance", "SKILL.md"), "Codex plugin skill");
assertFile(join(pluginRoot, "AGENTS.md"), "Codex plugin AGENTS.md");

const manifest = json(join(pluginRoot, ".codex-plugin", "plugin.json"));
assert.equal(manifest.name, "heli-harness");
assert.equal(manifest.version, "0.5.10");
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
assertHookDeny(root, `${plugin}/hooks/heli-pre-tool-use.mjs`, {
	tool_name: "apply_patch",
	tool_input: { path: ".env.local" },
}, /\.env/);

const codex = json(join(root, ".heli-harness", "adapters", "adapters.json")).adapters.find((adapter) => adapter.id === "codex");
assert.equal(codex.status, "verified-plugin-wired");
assert.ok(codex.evidence.includes(".heli-harness/adapters/codex-plugin/.codex-plugin/plugin.json"));
assert.ok(codex.verification.includes("node scripts/smoke-codex-plugin.mjs"));

const matrix = read(join(root, "docs", "ADAPTER_SUPPORT_MATRIX.md"));
const row = matrix.split("\n").find((line) => line.includes("**Codex**")) || "";
assert.match(row, /verified-plugin-wired/);
assert.doesNotMatch(row, /enforced/);

console.log("codex plugin smoke ok");
