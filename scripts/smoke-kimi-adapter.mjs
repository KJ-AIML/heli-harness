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

const adapterDir = join(root, ".heli-harness", "adapters", "kimi");
const entry = join(adapterDir, "KIMI.md");
const manifest = json(join(root, ".heli-harness", "adapters", "adapters.json"));
const matrix = read(join(root, "docs", "ADAPTER_SUPPORT_MATRIX.md"));

assert.ok(existsSync(adapterDir), "Kimi adapter folder should exist");
assert.ok(existsSync(entry), "KIMI.md should exist");

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
	assertContains(text, required, "KIMI.md");
}

const kimi = manifest.adapters.find((adapter) => adapter.id === "kimi");
assert.ok(kimi, "Kimi adapter should be present in adapters.json");
assert.equal(kimi.status, "enforced");
assert.ok(kimi.evidence.includes("scripts/smoke-kimi-adapter.mjs"));
for (const evidencePath of kimi.evidence) {
	assert.ok(existsSync(join(root, evidencePath)), `Kimi evidence should exist: ${evidencePath}`);
}

assertContains(matrix, "Kimi", "support matrix");

console.log("smoke-kimi-adapter: ok");
