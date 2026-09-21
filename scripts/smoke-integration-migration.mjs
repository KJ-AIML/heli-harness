#!/usr/bin/env node
import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { install as installEmbedded } from "../lib/cli/install.mjs";
import {
	inspectHost,
	installHost,
	updateHost,
	removeHost,
} from "../lib/cli/host.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = mkdtempSync(join(tmpdir(), "heli-integration-migration-"));
const project = join(root, "linked-project");
const legacyProject = join(root, "legacy-project");
const config = join(root, "config");
const data = join(root, "data");
const hostHome = join(root, "home");
const heli = join(packageRoot, "bin", "heli.mjs");
const env = {
	...process.env,
	HELI_CONFIG_DIR: config,
	HELI_DATA_DIR: data,
	HELI_HOST_HOME: hostHome,
};

function runCli(args) {
	const result = spawnSync(process.execPath, [heli, ...args], { encoding: "utf8", env });
	assert.equal(result.status, 0, `${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
	return result;
}

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

try {
	mkdirSync(project, { recursive: true });
	mkdirSync(legacyProject, { recursive: true });

	// Fresh global-linked project: global setup -> lightweight .heli/ binding.
	runCli(["setup", "--json"]);
	runCli(["link", project, "--json"]);
	assert.ok(existsSync(join(project, ".heli", "workspace.json")));
	assert.ok(existsSync(join(project, ".heli", "heli.lock")));
	assert.equal(existsSync(join(project, ".heli-harness")), false, "normal linked project must not receive .heli-harness/");

	// Pi regression: modern /heli-install must link, while embedded install is explicit legacy.
	const piSource = readFileSync(join(packageRoot, "extensions", "pi-extension.js"), "utf8");
	assert.match(piSource, /registerCommand\("heli-install", \{ description: "Link current project to the globally installed Heli runtime"/);
	assert.match(piSource, /registerCommand\("heli-legacy-install", \{ description: "Compatibility only: install a local \.heli-harness\/ tree"/);
	assert.match(piSource, /linkProject\(getPackageRoot\(\), cwd\)/);
	assert.doesNotMatch(piSource, /Install Heli-Harness workspace harness into current folder\?/);
	assert.doesNotMatch(piSource, /This will create \.heli-harness\/ and adapter pointer files/);

	// Explicit compatibility mode remains available and visibly creates the legacy tree.
	installEmbedded(join(packageRoot, ".heli-harness"), legacyProject);
	assert.ok(existsSync(join(legacyProject, ".heli-harness", "HARNESS.md")));
	assert.equal(existsSync(join(legacyProject, ".heli", "workspace.json")), false);

	// Cursor: install is repeatable; stale version is detected/upgraded; remove is Heli-scoped.
	const cursorParent = join(hostHome, ".cursor", "plugins", "local");
	mkdirSync(cursorParent, { recursive: true });
	const cursorUnrelated = join(cursorParent, "unrelated-user-plugin.txt");
	writeFileSync(cursorUnrelated, "keep me\n", "utf8");

	const cursorFirst = installHost(packageRoot, "cursor", { env });
	assert.equal(cursorFirst.ok, true);
	const cursorSecond = installHost(packageRoot, "cursor", { env });
	assert.equal(cursorSecond.ok, true);
	assert.equal(cursorSecond.already, true, "second install should be idempotent");

	const cursorManifest = join(cursorParent, "heli-harness", ".cursor-plugin", "plugin.json");
	const staleCursor = readJson(cursorManifest);
	staleCursor.version = "0.8.3";
	writeFileSync(cursorManifest, JSON.stringify(staleCursor, null, 2) + "\n", "utf8");
	assert.equal(inspectHost(packageRoot, "cursor", { env }).stale, true);
	assert.equal(updateHost(packageRoot, "cursor", { env }).ok, true);
	assert.equal(inspectHost(packageRoot, "cursor", { env }).lifecycleState, "current");

	const cursorRemove = removeHost(packageRoot, "cursor", { env });
	assert.equal(cursorRemove.ok, true);
	assert.ok(existsSync(cursorUnrelated), "Cursor removal must preserve unrelated user plugin files");
	assert.ok(existsSync(join(project, ".heli", "workspace.json")), "host removal must preserve project binding");

	// OpenCode: Heli uses a namespaced bundle/wrapper and preserves other plugins.
	const openCodeRoot = join(hostHome, ".config", "opencode", "plugins");
	mkdirSync(openCodeRoot, { recursive: true });
	const otherPlugin = join(openCodeRoot, "other-user-plugin.js");
	writeFileSync(otherPlugin, "export default {};\n", "utf8");
	assert.equal(installHost(packageRoot, "opencode", { env }).ok, true);
	assert.ok(existsSync(join(openCodeRoot, "heli-harness.js")));
	assert.ok(existsSync(join(openCodeRoot, "heli-harness-bundle", "shared")));
	assert.ok(existsSync(otherPlugin));
	assert.equal(removeHost(packageRoot, "opencode", { env }).ok, true);
	assert.ok(existsSync(otherPlugin), "OpenCode removal must preserve unrelated plugins");

	// Grok user hook is isolated to the Heli-owned hook file and removable without a host binary.
	const grokInstall = spawnSync(process.execPath, [
		join(packageRoot, ".heli-harness", "adapters", "grok-plugin", "install-user-hooks.mjs"),
	], { encoding: "utf8", env });
	assert.equal(grokInstall.status, 0, grokInstall.stderr || grokInstall.stdout);
	const grokHook = join(hostHome, ".grok", "hooks", "heli-harness.json");
	assert.ok(existsSync(grokHook));
	assert.equal(removeHost(packageRoot, "grok", { env }).ok, true);
	assert.equal(existsSync(grokHook), false);

	// Kimi hook block is delimited, repeatable, and removal keeps unrelated config.
	const kimiHome = join(hostHome, ".kimi-code");
	mkdirSync(kimiHome, { recursive: true });
	const kimiConfig = join(kimiHome, "config.toml");
	writeFileSync(kimiConfig, "model = \"user-choice\"\n", "utf8");
	const kimiInstaller = join(packageRoot, ".heli-harness", "adapters", "kimi-plugin", "install-user-hooks.mjs");
	const kimiFirst = spawnSync(process.execPath, [kimiInstaller], { encoding: "utf8", env });
	assert.equal(kimiFirst.status, 0, kimiFirst.stderr || kimiFirst.stdout);
	const kimiSecond = spawnSync(process.execPath, [kimiInstaller], { encoding: "utf8", env });
	assert.equal(kimiSecond.status, 0, kimiSecond.stderr || kimiSecond.stdout);
	const kimiInstalled = readFileSync(kimiConfig, "utf8");
	assert.equal((kimiInstalled.match(/# --- heli-harness hooks ---/g) || []).length, 1);
	assert.match(kimiInstalled, /# --- end heli-harness hooks ---/);
	assert.equal(removeHost(packageRoot, "kimi", { env }).ok, true);
	const kimiAfter = readFileSync(kimiConfig, "utf8");
	assert.match(kimiAfter, /model = "user-choice"/);
	assert.doesNotMatch(kimiAfter, /heli-harness hooks/);

	// Antigravity conditional lifecycle owns a child directory, never the configured parent.
	const antiParent = join(root, "antigravity-plugins");
	const antiEnv = { ...env, HELI_ANTIGRAVITY_PLUGIN_DIR: antiParent };
	mkdirSync(antiParent, { recursive: true });
	const antiUnrelated = join(antiParent, "other-plugin.txt");
	writeFileSync(antiUnrelated, "keep\n", "utf8");
	assert.equal(installHost(packageRoot, "antigravity", { env: antiEnv }).ok, true);
	assert.ok(existsSync(join(antiParent, "heli-harness", "plugin.json")));
	assert.equal(removeHost(packageRoot, "antigravity", { env: antiEnv }).ok, true);
	assert.ok(existsSync(antiUnrelated), "Antigravity removal must preserve sibling plugins");

	console.log("integration migration smoke ok");
} finally {
	rmSync(root, { recursive: true, force: true });
}
