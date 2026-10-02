#!/usr/bin/env node
/**
 * Grok duplicate-hook lifecycle smoke (issue #35):
 * 1. With an installed plugin present, install-user-hooks skips the global
 *    hooks file (plugin is the single hook source).
 * 2. Without the plugin, the installer falls back to writing the global file.
 * 3. `heli host repair grok` canonicalizes a duplicated state to one source
 *    (keeps the plugin copy, removes the global file).
 * Runs against a hermetic home; never touches the real ~/.grok.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { inspectHost, installHost, repairHost } from "../lib/cli/host.mjs";
import { createHermeticEnv } from "./lib/hermetic-env.mjs";

const root = process.cwd();
const hermetic = createHermeticEnv({ prefix: "heli-grok-dup-" });
const restoreProcessEnv = hermetic.applyToProcess();
process.on("exit", () => {
	restoreProcessEnv();
	hermetic.cleanup();
});
const env = hermetic.env;
const home = hermetic.home;
const globalHooks = join(home, ".grok", "hooks", "heli-harness.json");
const installer = join(root, ".heli-harness", "adapters", "grok-plugin", "install-user-hooks.mjs");

function pluginHooksFixtures() {
	// One real plugin install: hooks/hooks.json inside an installed-plugins repo.
	// Detection requires both hook scripts (the same predicate the installer uses).
	const repoDir = join(home, ".grok", "installed-plugins", "grok-plugin-fix1");
	mkdirSync(join(repoDir, "hooks"), { recursive: true });
	writeFileSync(join(repoDir, "hooks", "hooks.json"), JSON.stringify({
		hooks: {
			SessionStart: [{ hooks: [{ type: "command", command: 'node "${GROK_PLUGIN_ROOT}/hooks/heli-session-start.mjs"', timeout: 5 }] }],
			PreToolUse: [{ matcher: ".*", hooks: [{ type: "command", command: 'node "${GROK_PLUGIN_ROOT}/hooks/heli-pre-tool-use.mjs"', timeout: 30 }] }],
		},
	}, null, 2), "utf8");
	writeFileSync(join(repoDir, "hooks", "heli-pre-tool-use.mjs"), "// fixture\n", "utf8");
	writeFileSync(join(repoDir, "hooks", "heli-session-start.mjs"), "// fixture\n", "utf8");
}

// 1. Plugin present -> installer skips the global file.
pluginHooksFixtures();
const skip = spawnSync(process.execPath, [installer], { env, encoding: "utf8" });
assert.equal(skip.status, 0, skip.stderr || skip.stdout);
assert.match(skip.stdout, /Global user hooks not installed \(duplicate\)/);
assert.equal(existsSync(globalHooks), false, "installer must not write the global hooks file when the plugin is registered");
console.log("duplicate-hook skip with plugin present ok");

// 2. No plugin -> fallback installs the global file.
rmSync(join(home, ".grok", "installed-plugins"), { recursive: true, force: true });
const fallback = spawnSync(process.execPath, [installer], { env, encoding: "utf8" });
assert.equal(fallback.status, 0, fallback.stderr || fallback.stdout);
assert.equal(existsSync(globalHooks), true, "without a plugin the installer must write the global hooks file");
const written = JSON.parse(readFileSync(globalHooks, "utf8"));
assert.ok(written.hooks.PreToolUse[0].hooks[0].command.includes("heli-pre-tool-use.mjs"));
console.log("fallback install without plugin ok");

// 3. Duplicate state -> repair keeps the plugin copy, removes the global file.
pluginHooksFixtures();
assert.equal(inspectHost(root, "grok", { env }).hookTopology.duplicate, true, "duplicate must be reported");
const repair = repairHost(root, "grok", { env });
assert.equal(repair.ok, true, JSON.stringify(repair.steps || repair.reason || ""));
const after = inspectHost(root, "grok", { env });
assert.equal(after.hookTopology.duplicate, false, `expected one hook source, saw ${JSON.stringify(after.hookTopology.sources)}`);
assert.equal(after.hookTopology.sources[0].source, "plugin", "the plugin copy is the kept source");
assert.equal(existsSync(globalHooks), false, "the duplicate global hooks file is removed");
console.log("repair canonicalizes to the plugin source ok");

// 4. Global-only state -> repair re-installs without deleting the fallback.
rmSync(join(home, ".grok", "installed-plugins"), { recursive: true, force: true });
const onlyGlobal = spawnSync(process.execPath, [installer], { env, encoding: "utf8" });
assert.equal(onlyGlobal.status, 0);
assert.equal(existsSync(globalHooks), true);
const repairGlobalOnly = repairHost(root, "grok", { env });
assert.equal(repairGlobalOnly.ok, true, JSON.stringify(repairGlobalOnly.steps || ""));
const afterGlobal = inspectHost(root, "grok", { env });
assert.equal(afterGlobal.hookTopology.sources.length, 1, "repair must leave exactly one hook source");
assert.equal(afterGlobal.installed, true);
console.log("repair keeps a global-only install working ok");

console.log("grok duplicate-hook lifecycle smoke ok");
