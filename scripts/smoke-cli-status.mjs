#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { status } from "../lib/cli/status.mjs";

{
	const cwd = mkdtempSync(join(tmpdir(), "heli-cli-status-"));
	try {
		const result = status(cwd);
		assert.equal(result.installed, false);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
}

{
	const cwd = mkdtempSync(join(tmpdir(), "heli-cli-status-"));
	try {
		const heliDir = join(cwd, ".heli-harness");
		mkdirSync(join(heliDir, "workspace"), { recursive: true });
		mkdirSync(join(heliDir, "state"), { recursive: true });
		writeFileSync(join(heliDir, "manifest.json"), JSON.stringify({ version: "9.9.9" }));
		writeFileSync(join(heliDir, "workspace", "target.json"), JSON.stringify({ targetRepo: "demo" }));
		writeFileSync(join(heliDir, "workspace", "index.json"), JSON.stringify({ repos: [{ name: "demo" }, { name: "other" }] }));
		writeFileSync(join(heliDir, "state", "current-task.md"), "# Current Task\n\nCurrent status: in progress\n\nFailed attempts count: 1\n");

		const result = status(cwd);
		assert.equal(result.installed, true);
		assert.equal(result.version, "9.9.9");
		assert.equal(result.targetRepo, "demo");
		assert.equal(result.repoCount, 2);
		assert.equal(result.indexConfigured, true);
		assert.equal(result.taskStatus, "in progress");
		assert.equal(result.failedAttempts, "1");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
}

console.log("cli status smoke ok");
