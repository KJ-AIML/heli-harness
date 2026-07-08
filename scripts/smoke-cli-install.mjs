#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { install } from "../lib/cli/install.mjs";

const root = process.cwd();
const sourceHarnessDir = join(root, ".heli-harness");

// Fresh install into an empty directory copies .heli-harness/ and creates pointer files
{
	const parentDir = mkdtempSync(join(tmpdir(), "heli-cli-install-"));
	try {
		const result = install(sourceHarnessDir, parentDir);
		assert.ok(existsSync(join(parentDir, ".heli-harness", "HARNESS.md")), "HARNESS.md should be copied");
		assert.ok(existsSync(join(parentDir, ".heli-harness", "manifest.json")), "manifest.json should be copied");
		assert.ok(existsSync(join(parentDir, ".heli-harness", "skills")), "skills/ should be copied");
		assert.ok(existsSync(join(parentDir, ".heli-harness", "adapters")), "adapters/ should be copied");
		assert.ok(existsSync(join(parentDir, "AGENTS.md")), "AGENTS.md should be created");
		assert.ok(existsSync(join(parentDir, "CLAUDE.md")), "CLAUDE.md should be created");
		assert.match(readFileSync(join(parentDir, "AGENTS.md"), "utf8"), /codex\/AGENTS\.md/);
		assert.equal(result.messages.length, 0, "no pre-existing pointer files means no messages");
		assert.equal(result.target, join(parentDir, ".heli-harness"));
	} finally {
		rmSync(parentDir, { recursive: true, force: true });
	}
}

// Existing AGENTS.md/CLAUDE.md are never overwritten
{
	const parentDir = mkdtempSync(join(tmpdir(), "heli-cli-install-"));
	try {
		const agentsPath = join(parentDir, "AGENTS.md");
		const originalContent = "# My custom AGENTS.md\n";
		writeFileSync(agentsPath, originalContent);
		const result = install(sourceHarnessDir, parentDir);
		assert.equal(readFileSync(agentsPath, "utf8"), originalContent, "existing AGENTS.md must not be overwritten");
		assert.equal(result.messages.length, 1, "one message for the pre-existing AGENTS.md");
	} finally {
		rmSync(parentDir, { recursive: true, force: true });
	}
}

// Missing parent directory throws
{
	const missingDir = join(tmpdir(), "heli-cli-does-not-exist-xyz");
	assert.throws(() => install(sourceHarnessDir, missingDir), /does not exist/);
}

console.log("cli install smoke ok");
