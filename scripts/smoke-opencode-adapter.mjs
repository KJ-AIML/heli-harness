#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(path) {
	return readFileSync(path, "utf8");
}

function json(path) {
	return JSON.parse(read(path));
}

function assertContains(text, expected, label) {
	assert.ok(text.includes(expected), `${label} should include ${expected}`);
}

const adapterDir = join(root, ".heli-harness", "adapters", "opencode");
const entry = join(adapterDir, "OPENCODE.md");
const manifest = json(join(root, ".heli-harness", "adapters", "adapters.json"));
const matrix = read(join(root, "docs", "ADAPTER_SUPPORT_MATRIX.md"));

assert.ok(existsSync(adapterDir), "OpenCode adapter folder should exist");
assert.ok(existsSync(entry), "OPENCODE.md should exist");

const text = read(entry);
for (const required of [
	"Heli-Harness identity",
	"Read first",
	"Target repo discipline",
	"Write boundaries",
	"Safety rules",
	"Command tiers",
	"Claims require evidence",
	"Validation before completion",
	"Final reports",
	"Limitations",
	"Enforcement self-check",
]) {
	assertContains(text, required, "OPENCODE.md");
}

const opencode = manifest.adapters.find((adapter) => adapter.id === "opencode");
assert.ok(opencode, "OpenCode adapter should be present in adapters.json");
assert.equal(opencode.status, "enforced");
assert.ok(opencode.evidence.includes("scripts/smoke-opencode-adapter.mjs"));
for (const evidencePath of opencode.evidence) {
	assert.ok(existsSync(join(root, evidencePath)), `OpenCode evidence should exist: ${evidencePath}`);
}

assertContains(matrix, "OpenCode", "support matrix");
assert.notEqual(opencode.status, "planned", "OpenCode must no longer be planned");

console.log("smoke-opencode-adapter: ok");
