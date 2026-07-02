#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { assertFile, assertHookDeny, assertSessionContext, json, nodeCheck, read } from "./lib/plugin-smoke-helpers.mjs";

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
assert.equal(manifest.version, "0.5.14");

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
