#!/usr/bin/env node
/**
 * A host CLI that prints a lot is still read.
 *
 * `codex plugin list` now lists the whole remote plugin catalog (about 2 MB), past Node's 1 MiB default output buffer.
 * The overflowed call read as a failed one, so `heli host status` reported the installed Codex plugin as absent and
 * `heli host update` said "codex: FAILED — plugin not detected". Host CLI calls now take up to 64 MiB of output.
 */
import assert from "node:assert/strict";
import { inspectHost } from "../lib/cli/host.mjs";
import { createHermeticEnv } from "./lib/hermetic-env.mjs";

const root = process.cwd();
const hermetic = createHermeticEnv({ prefix: "heli-host-large-output-" });
const restoreProcessEnv = hermetic.applyToProcess();
process.on("exit", () => {
	restoreProcessEnv();
	hermetic.cleanup();
});

const catalogRow = (i) => `app-${String(i).padStart(40, "0")}@openai-curated-remote   not installed   1.0.0   plugin_asdk_app_${i}\n`;
const catalog = Array.from({ length: 24000 }, (_, i) => catalogRow(i)).join("");
// Any version: the release script rewrites the current one only in the files it lists.
const heliRow = "heli-harness@heli-harness  installed, enabled  9.9.9   /Users/x/.codex/.tmp/marketplaces/heli-harness/.heli-harness/adapters/codex-plugin\n";

for (const [label, stdout] of [["after", catalog + heliRow], ["before", heliRow + catalog]]) {
	hermetic.setResponse("codex plugin list", { stdout, status: 0 });
	assert.ok(stdout.length > 2 * 1024 * 1024, `the fake list is ${stdout.length} bytes, past the old 1 MiB limit`);
	const codex = inspectHost(root, "codex", { env: hermetic.env });
	assert.equal(codex.detail, "plugin installed and enabled", `heli row ${label} a ${stdout.length}-byte catalog: ${codex.detail}`);
}

console.log("host large output smoke ok");
