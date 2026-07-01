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
assert.equal(manifest.version, "0.5.12");
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
