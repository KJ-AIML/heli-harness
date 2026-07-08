#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { install } from "../lib/cli/install.mjs";
import { uninstall } from "../lib/cli/uninstall.mjs";

const root = process.cwd();
const sourceHarnessDir = join(root, ".heli-harness");

// Removes an installed harness
{
	const parentDir = mkdtempSync(join(tmpdir(), "heli-cli-uninstall-"));
	try {
		install(sourceHarnessDir, parentDir);
		assert.ok(existsSync(join(parentDir, ".heli-harness")));
		const result = uninstall(parentDir);
		assert.equal(result.removed, true);
		assert.ok(!existsSync(join(parentDir, ".heli-harness")), ".heli-harness should be gone");
	} finally {
		rmSync(parentDir, { recursive: true, force: true });
	}
}

// No-op (not an error) when nothing is installed
{
	const parentDir = mkdtempSync(join(tmpdir(), "heli-cli-uninstall-"));
	try {
		const result = uninstall(parentDir);
		assert.equal(result.removed, false);
	} finally {
		rmSync(parentDir, { recursive: true, force: true });
	}
}

console.log("cli uninstall smoke ok");
