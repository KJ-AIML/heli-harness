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

const adapterDir = join(root, ".heli-harness", "adapters", "grok");
const entry = join(adapterDir, "GROK.md");
const manifest = json(join(root, ".heli-harness", "adapters", "adapters.json"));
const matrix = read(join(root, "docs", "ADAPTER_SUPPORT_MATRIX.md"));

assert.ok(existsSync(adapterDir), "Grok adapter folder should exist");
assert.ok(existsSync(entry), "GROK.md should exist");

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
	assertContains(text, required, "GROK.md");
}
assertContains(text, ".heli-harness/HARNESS.md", "GROK.md");

const grok = manifest.adapters.find((adapter) => adapter.id === "grok");
assert.ok(grok, "Grok adapter should be present in adapters.json");
assert.equal(grok.status, "enforced", "Grok should be enforced until live-verify ships");
assert.ok(grok.evidence.includes("scripts/smoke-grok-adapter.mjs"), "Grok evidence should include adapter smoke");
for (const evidencePath of grok.evidence) {
	assert.ok(existsSync(join(root, evidencePath)), `Grok evidence should exist: ${evidencePath}`);
}

assertContains(matrix, "Grok", "support matrix");
assertContains(matrix, "enforced", "support matrix status language");

console.log("smoke-grok-adapter: ok");
