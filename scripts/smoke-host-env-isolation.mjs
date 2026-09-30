#!/usr/bin/env node
/**
 * Every host CLI spawned by lib/cli/host.mjs must receive the caller's env.
 * Runs entirely against fake host CLIs: this process's own PATH/HOME are also
 * pointed at the hermetic environment, so a dropped `env` still cannot reach a
 * real CLI — it only loses the fake-log variable, which the assertions detect.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHermeticEnv } from "./lib/hermetic-env.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const hermetic = createHermeticEnv({ prefix: "heli-host-env-isolation-" });
const restoreProcessEnv = hermetic.applyToProcess();

function calls() {
	return hermetic.readLog().map((entry) => [entry.host, ...entry.args].join(" "));
}

try {
	for (const host of ["claude", "codex", "grok", "pi", "kimi"]) hermetic.assertFakeResolution(host);
	const { inspectHost, installHost, removeHost } = await import("../lib/cli/host.mjs");
	const env = hermetic.env;

	// inspectHost: plugin-list probes must use the caller's env.
	inspectHost(packageRoot, "claude", { env });
	inspectHost(packageRoot, "codex", { env });
	inspectHost(packageRoot, "pi", { env });
	for (const expected of ["claude plugin list --json", "codex plugin list", "pi list"]) {
		assert.ok(calls().includes(expected), `inspectHost must run "${expected}" with the caller env; saw:\n${calls().join("\n")}`);
	}

	// installHost -> runPlan -> step: installer + host CLI steps use the caller's env.
	const grokInstall = installHost(packageRoot, "grok", { env, force: true });
	assert.equal(grokInstall.ok, true, JSON.stringify(grokInstall.steps, null, 2));
	const grokHook = join(hermetic.home, ".grok", "hooks", "heli-harness.json");
	assert.ok(existsSync(grokHook), "grok installer must write into the hermetic HELI_HOST_HOME");
	assert.ok(calls().some((line) => line.startsWith("grok plugin install ")), `grok install step missing:\n${calls().join("\n")}`);

	// removeHost -> step: the uninstall must hit the fake grok, never the real one.
	mkdirSync(dirname(grokHook), { recursive: true });
	writeFileSync(grokHook, "{}\n", "utf8");
	const grokRemove = removeHost(packageRoot, "grok", { env });
	assert.equal(grokRemove.ok, true, JSON.stringify(grokRemove.steps, null, 2));
	assert.equal(existsSync(grokHook), false);
	assert.ok(calls().includes("grok plugin uninstall heli-harness"), `fake grok must receive the uninstall:\n${calls().join("\n")}`);

	console.log("host env isolation smoke ok");
} finally {
	restoreProcessEnv();
	hermetic.cleanup();
}
