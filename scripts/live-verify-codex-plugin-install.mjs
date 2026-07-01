#!/usr/bin/env node
/**
 * live-verify-codex-plugin-install.mjs — Real Codex marketplace/install/trust proof.
 *
 * Drives the real `codex` CLI (isolated CODEX_HOME, nothing touches the real
 * Codex config) through `plugin marketplace add` and `plugin add` against the
 * shipped codex-plugin directory, then confirms `plugin list` reports it
 * installed and enabled.
 *
 * This proves install/trust wiring only. It does not trigger a model turn, so
 * it cannot prove the PreToolUse hook fires live — see
 * scripts/live-verify-codex-plugin-hook.mjs for that (requires Codex usage
 * quota). Not part of `npm run check`. Skips (exit 0) if the `codex` CLI is
 * not installed.
 *
 * Usage: node scripts/live-verify-codex-plugin-install.mjs
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const plugin = ".heli-harness/adapters/codex-plugin";
const pluginRoot = join(root, plugin);

// On Windows, `codex` resolves to codex.cmd; Node only auto-resolves .cmd/.bat
// shims when shell: true is set (spawn no longer does this implicitly). Quote
// args ourselves and pass a single command string to avoid Node's unescaped
// shell-array deprecation warning.
function quote(arg) {
	return /[\s"]/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg;
}
function codex(args, opts = {}) {
	if (process.platform === "win32") {
		const command = ["codex", ...args].map(quote).join(" ");
		return spawnSync(command, { encoding: "utf8", shell: true, ...opts });
	}
	return spawnSync("codex", args, { encoding: "utf8", ...opts });
}

const version = codex(["--version"]);
if (version.error && version.error.code === "ENOENT") {
	console.log("skip: codex CLI not installed");
	process.exit(0);
}

const codexHome = mkdtempSync(join(tmpdir(), "heli-live-codex-home-"));
const env = { ...process.env, CODEX_HOME: codexHome };

try {
	const marketplaceAdd = codex(["plugin", "marketplace", "add", pluginRoot], { env });
	assert.equal(marketplaceAdd.status, 0, marketplaceAdd.stderr || marketplaceAdd.stdout);

	const pluginAdd = codex(["plugin", "add", "heli-harness@heli-harness"], { env });
	assert.equal(pluginAdd.status, 0, pluginAdd.stderr || pluginAdd.stdout);

	const list = codex(["plugin", "list"], { env });
	assert.equal(list.status, 0, list.stderr || list.stdout);
	assert.match(list.stdout, /heli-harness@heli-harness\s+installed, enabled/, `expected heli-harness installed and enabled, got:\n${list.stdout}`);

	console.log("codex live plugin install verify ok: marketplace add + plugin add + trust succeeded against the real Codex CLI");
} finally {
	rmSync(codexHome, { recursive: true, force: true });
}
