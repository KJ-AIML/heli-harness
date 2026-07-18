#!/usr/bin/env node
/**
 * live-verify-codex-plugin-install.mjs — Real Codex marketplace/install/trust proof.
 *
 * Drives the real `codex` CLI (isolated CODEX_HOME, nothing touches the real
 * Codex config) through `plugin marketplace add` and `plugin add` against:
 *   1. Repo-root marketplace (Ponytail-style path used by KJ-AIML/heli-harness)
 *   2. Nested workspace-local dogfood path (./.heli-harness/adapters/codex-plugin)
 *
 * Confirms `plugin list` reports the plugin installed and enabled for both.
 * Does not prove a model turn / PreToolUse fire — see
 * scripts/live-verify-codex-plugin-hook.mjs for that.
 *
 * Not part of `npm run check`. Skips (exit 0) if the `codex` CLI is not installed.
 *
 * Usage: node scripts/live-verify-codex-plugin-install.mjs
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const nestedPlugin = join(root, ".heli-harness", "adapters", "codex-plugin");

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

function assertInstall(label, marketplaceSource, env) {
	const marketplaceAdd = codex(["plugin", "marketplace", "add", marketplaceSource], { env });
	assert.equal(
		marketplaceAdd.status,
		0,
		`${label}: marketplace add failed\n${marketplaceAdd.stderr || marketplaceAdd.stdout}`,
	);

	const pluginAdd = codex(["plugin", "add", "heli-harness@heli-harness"], { env });
	assert.equal(
		pluginAdd.status,
		0,
		`${label}: plugin add failed\n${pluginAdd.stderr || pluginAdd.stdout}`,
	);

	const list = codex(["plugin", "list"], { env });
	assert.equal(list.status, 0, `${label}: plugin list failed\n${list.stderr || list.stdout}`);
	assert.match(
		list.stdout,
		/heli-harness@heli-harness\s+installed, enabled/,
		`${label}: expected heli-harness installed and enabled, got:\n${list.stdout}`,
	);
}

// 1) Repo-root marketplace (same layout KJ-AIML/heli-harness exposes over Git)
{
	const codexHome = mkdtempSync(join(tmpdir(), "heli-live-codex-root-"));
	const env = { ...process.env, CODEX_HOME: codexHome };
	try {
		assertInstall("repo-root marketplace", root, env);
		console.log("codex live plugin install verify ok: repo-root marketplace add + plugin add succeeded");
	} finally {
		rmSync(codexHome, { recursive: true, force: true });
	}
}

// 2) Nested local dogfood path (must use absolute / ./ form; bare .heli-… is invalid)
{
	const codexHome = mkdtempSync(join(tmpdir(), "heli-live-codex-nested-"));
	const env = { ...process.env, CODEX_HOME: codexHome };
	try {
		assertInstall("nested dogfood marketplace", nestedPlugin, env);
		console.log("codex live plugin install verify ok: nested marketplace add + plugin add succeeded");
	} finally {
		rmSync(codexHome, { recursive: true, force: true });
	}
}

// 3) Negative: bare relative path without ./ must remain rejected by Codex
{
	const codexHome = mkdtempSync(join(tmpdir(), "heli-live-codex-bare-"));
	const env = { ...process.env, CODEX_HOME: codexHome };
	try {
		const bare = codex(["plugin", "marketplace", "add", ".heli-harness/adapters/codex-plugin"], {
			env,
			cwd: root,
		});
		assert.notEqual(bare.status, 0, "bare .heli-harness/… marketplace source must fail");
		assert.match(
			`${bare.stderr}\n${bare.stdout}`,
			/invalid marketplace source format/i,
			`expected invalid marketplace source format, got:\n${bare.stderr}\n${bare.stdout}`,
		);
		console.log("codex live plugin install verify ok: bare relative path correctly rejected");
	} finally {
		rmSync(codexHome, { recursive: true, force: true });
	}
}

console.log("codex live plugin install verify ok: marketplace add + plugin add + trust succeeded against the real Codex CLI");
