#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const heliPath = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "heli.mjs");

// Install -> status round trip through the real bin/heli.mjs subprocess (not the
// exported lib/cli/*.mjs functions called in-process — this proves argv dispatch
// and self-location in the actual compiled binary).
{
	const cwd = mkdtempSync(join(tmpdir(), "heli-cli-entry-"));
	try {
		const installResult = spawnSync(process.execPath, [heliPath, "install", cwd], { encoding: "utf8" });
		assert.equal(installResult.status, 0, installResult.stderr);
		assert.ok(
			installResult.stdout.includes("Heli workspace governance installed:") ||
				installResult.stdout.includes("Heli-Harness installed to:"),
			"install should report workspace governance install",
		);
		assert.ok(installResult.stdout.includes(cwd));
		assert.ok(
			installResult.stdout.includes("Host-native skills require host plugin activation"),
			"install must explain host plugin activation is separate",
		);
		assert.ok(installResult.stdout.includes("codex plugin marketplace add"));
		assert.ok(
			installResult.stdout.includes("KJ-AIML/heli-harness") ||
				installResult.stdout.includes("./.heli-harness/adapters/codex-plugin"),
			"install should mention Git marketplace and/or local dogfood Codex path",
		);

		const updateResult = spawnSync(process.execPath, [heliPath, "update", cwd], { encoding: "utf8" });
		assert.equal(updateResult.status, 0, updateResult.stderr);
		assert.ok(updateResult.stdout.includes("Updated Heli-Harness at"), "update should report target");
		assert.ok(
			updateResult.stdout.includes("codex plugin marketplace upgrade heli-harness"),
			"update must tell users how to refresh the Codex Git marketplace",
		);
		assert.ok(
			updateResult.stdout.includes("Host plugin refresh"),
			"update must separate workspace update from host plugin refresh",
		);

		// This repo's own .heli-harness/ is real, self-dogfooding operational state
		// (workspace/target.json, workspace/index.json, state/current-task.md all
		// change as normal work continues here) — so only assert on label/structure
		// presence, never on today's specific field values. Exact field-extraction
		// behavior is already covered by smoke-cli-status.mjs's synthetic fixture;
		// this test's job is proving the entry point's plumbing, not re-verifying
		// status()'s parsing logic.
		const statusResult = spawnSync(process.execPath, [heliPath, "status", cwd], { encoding: "utf8" });
		assert.equal(statusResult.status, 0, statusResult.stderr);
		assert.ok(statusResult.stdout.includes("Heli-Harness version:"));
		assert.ok(statusResult.stdout.includes("Target repo:"));
		assert.ok(
			statusResult.stdout.includes("Registered repos:") || statusResult.stdout.includes("Workspace index:"),
			"status should report either registered repos or an unconfigured workspace index",
		);
		assert.ok(
			statusResult.stdout.includes("Current task status:") || statusResult.stdout.includes("Current task:"),
			"status should report either a recorded task status or none recorded",
		);
		assert.ok(
			statusResult.stdout.includes("Skill packaging:") || statusResult.stdout.includes("Host skill activation:"),
			"status should report skill packaging / activation surface",
		);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
}

// No-args invocation prints usage and exits 1 before the switch is ever reached.
{
	const result = spawnSync(process.execPath, [heliPath], { encoding: "utf8" });
	assert.equal(result.status, 1);
	assert.ok(result.stderr.includes("Usage: heli"));
}

// Unknown command falls through the switch's default: branch — a distinct code
// path from the no-args case above.
{
	const result = spawnSync(process.execPath, [heliPath, "bogus-command"], { encoding: "utf8" });
	assert.equal(result.status, 1);
	assert.ok(result.stderr.includes("Usage: heli"));
}

console.log("cli entry smoke ok");
