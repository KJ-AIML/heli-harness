#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	planHostInstall,
	planHostRemove,
	inspectHost,
	inspectHosts,
	installHost,
	claudePluginState,
	renderOperation,
} from "../lib/cli/host.mjs";
import { createHermeticEnv } from "./lib/hermetic-env.mjs";

const root = process.cwd();
// Host inspection spawns host CLIs: run against fakes only, never the real ones.
const hermetic = createHermeticEnv({ prefix: "heli-host-manager-" });
const restoreProcessEnv = hermetic.applyToProcess();
process.on("exit", () => {
	restoreProcessEnv();
	hermetic.cleanup();
});
const env = {
	...hermetic.env,
	HELI_ANTIGRAVITY_PLUGIN_DIR: join(hermetic.root, "antigravity-plugins"),
};

for (const id of ["codex", "pi", "claude", "grok", "opencode", "kimi", "cursor", "axga", "antigravity"]) {
	const installPlan = planHostInstall(root, id, { env });
	assert.ok(Array.isArray(installPlan) && installPlan.length > 0, `${id} must have a managed install plan`);
	const removePlan = planHostRemove(root, id, { env });
	assert.ok(Array.isArray(removePlan) && removePlan.length > 0, `${id} must have a managed remove plan`);
}

assert.deepEqual(planHostInstall(root, "codex", { env })[0].slice(0, 4), ["codex", "plugin", "marketplace", "add"]);
assert.match(planHostInstall(root, "pi", { env })[0][2], /heli-harness@v0\.10\./);
// `claude plugin install` resolves marketplace ids only; a directory path fails with
// "not found in any configured marketplace".
assert.deepEqual(planHostInstall(root, "claude", { env }), [
	["claude", "plugin", "marketplace", "add", join(root, ".heli-harness")],
	["claude", "plugin", "install", "heli-harness@heli-harness"],
	["claude", "plugin", "update", "heli-harness@heli-harness"],
]);
assert.deepEqual(planHostRemove(root, "claude", { env }), [
	["claude", "plugin", "uninstall", "heli-harness@heli-harness"],
	["claude", "plugin", "marketplace", "remove", "heli-harness"],
]);
// The registered marketplace must resolve heli-harness@heli-harness to the hook-bearing plugin.
const claudeMarketplace = JSON.parse(readFileSync(join(root, ".heli-harness", ".claude-plugin", "marketplace.json"), "utf8"));
assert.equal(claudeMarketplace.name, "heli-harness");
const claudeEntry = claudeMarketplace.plugins.find((plugin) => plugin.name === "heli-harness");
assert.ok(claudeEntry, "Claude marketplace must list heli-harness");
const claudePluginRoot = join(root, ".heli-harness", claudeEntry.source);
assert.equal(JSON.parse(readFileSync(join(claudePluginRoot, ".claude-plugin", "plugin.json"), "utf8")).name, "heli-harness");
assert.ok(existsSync(join(claudePluginRoot, "hooks", "hooks.json")), "Claude marketplace source must be the hook-bearing plugin");

// Status counts only the managed user-scope plugin. A bare /heli-harness/ search used to
// match an old, disabled, project-scoped heli-local install and report it as installed.
const legacyProjectInstall = {
	id: "heli-harness@heli-local",
	version: "0.8.3",
	scope: "project",
	enabled: false,
	installPath: "C:\\Users\\dev\\.claude\\plugins\\cache\\heli-local\\heli-harness\\0.8.3",
	installedAt: "2026-09-03T16:28:01.389Z",
	lastUpdated: "2026-09-03T16:28:01.389Z",
	projectPath: "D:\\Work\\legacy-workspace",
};
const managedInstall = {
	id: "heli-harness@heli-harness",
	version: "0.10.3",
	scope: "user",
	enabled: true,
	installPath: "C:\\Users\\dev\\.claude\\plugins\\cache\\heli-harness\\heli-harness\\0.10.3",
	installedAt: "2026-09-29T16:49:43.707Z",
	lastUpdated: "2026-09-29T16:49:43.707Z",
};
const claudeList = (...plugins) => JSON.stringify(plugins, null, 2);
assert.deepEqual(claudePluginState(claudeList(legacyProjectInstall)), { state: "absent", version: null });
assert.deepEqual(claudePluginState(claudeList({ ...managedInstall, scope: "project", projectPath: "D:\\Work\\app" })), { state: "absent", version: null });
assert.deepEqual(claudePluginState(claudeList(legacyProjectInstall, managedInstall)), { state: "enabled", version: "0.10.3" });
assert.deepEqual(claudePluginState(claudeList({ ...managedInstall, enabled: false })), { state: "disabled", version: "0.10.3" });
assert.deepEqual(claudePluginState("Error: plugin list unavailable"), { state: "absent", version: null });

// A failed install must say why; the real Claude error used to be hidden behind "FAILED".
function renderedInstall(items) {
	const lines = [];
	const log = console.log;
	console.log = (line) => lines.push(String(line));
	try {
		renderOperation(items, "installed/verified");
	} finally {
		console.log = log;
	}
	return lines.join("\n");
}
const failedClaudeStep = {
	ok: false,
	command: ["claude", "plugin", "install", "C:\\pkg\\claude-plugin"],
	output: 'Installing plugin "C:\\pkg\\claude-plugin"...\n\n✘ Failed to install plugin "C:\\pkg\\claude-plugin": Plugin "C:\\pkg\\claude-plugin" not found in any configured marketplace',
	code: 1,
	error: null,
};
assert.match(renderedInstall([{ id: "claude", ok: false, steps: [failedClaudeStep] }]), /claude: FAILED — .*not found in any configured marketplace/);
// Every step succeeded but the host still is not usable (e.g. plugin disabled): show its detail.
const disabledAfter = { id: "claude", installed: false, lifecycleState: "absent", detail: "heli-harness@heli-harness is disabled; enable it with: claude plugin enable heli-harness@heli-harness" };
assert.match(
	renderedInstall([{ id: "claude", ok: false, steps: [{ ok: true, command: ["claude", "plugin", "install", "heli-harness@heli-harness"], output: "already installed" }], after: disabledAfter }]),
	/claude: FAILED — heli-harness@heli-harness is disabled/,
);
assert.match(planHostInstall(root, "grok", { env })[0].join(" "), /install-user-hooks\.mjs/);
assert.match(planHostInstall(root, "kimi", { env })[0].join(" "), /install-user-hooks\.mjs/);
assert.equal(planHostInstall(root, "opencode", { env })[0][0], "opencode-install");
assert.equal(planHostInstall(root, "cursor", { env })[0][0], "copy-dir");
assert.match(planHostInstall(root, "antigravity", { env })[0][2], /heli-harness$/);

assert.deepEqual(planHostInstall(root, "generic", { env }), []);
assert.deepEqual(planHostRemove(root, "generic", { env }), []);

const hosts = inspectHosts(root, { env });
const fakeCalls = hermetic.readLog().map((entry) => [entry.host, ...entry.args].join(" "));
for (const expected of ["claude plugin list --json", "codex plugin list", "pi list", "axga list"]) {
	assert.ok(fakeCalls.includes(expected), `inventory must probe "${expected}" through the fake CLI; saw:\n${fakeCalls.join("\n")}`);
}
for (const id of ["codex", "pi", "claude", "grok", "opencode", "kimi", "cursor", "axga", "antigravity", "generic"]) {
	assert.ok(hosts.some((item) => item.id === id), `host inventory missing ${id}`);
}
assert.equal(hosts.find((item) => item.id === "antigravity").automatic, "conditional");
assert.equal(hosts.find((item) => item.id === "generic").lifecycleState, "manual");

const unavailableEnv = {
	...env,
	PATH: "",
	Path: "",
	HELI_HOST_HOME: join(hermetic.root, "unavailable-home"),
};
const kimiUnavailable = inspectHost(root, "kimi", { env: unavailableEnv });
assert.equal(kimiUnavailable.cliPresent, false);
assert.equal(kimiUnavailable.installed, false);
assert.equal(kimiUnavailable.lifecycleState, "host-unavailable");

const kimiInstall = installHost(root, "kimi", { env: unavailableEnv });
assert.equal(kimiInstall.skipped, true);
assert.equal(kimiInstall.reason, "Kimi Code CLI not found on PATH");

const openCodeWithoutCli = inspectHost(root, "opencode", { env: unavailableEnv });
assert.equal(openCodeWithoutCli.lifecycleState, "absent");

console.log("host manager smoke ok");
