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

const adapterDir = join(root, ".heli-harness", "adapters", "antigravity");
const entry = join(adapterDir, "ANTIGRAVITY.md");
const manifest = json(join(root, ".heli-harness", "adapters", "adapters.json"));
const matrix = read(join(root, "docs", "ADAPTER_SUPPORT_MATRIX.md"));

assert.ok(existsSync(adapterDir), "Antigravity adapter folder should exist");
assert.ok(existsSync(entry), "ANTIGRAVITY.md should exist");

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
	assertContains(text, required, "ANTIGRAVITY.md");
}

const ag = manifest.adapters.find((adapter) => adapter.id === "antigravity");
assert.ok(ag, "Antigravity adapter should be present in adapters.json");
assert.equal(ag.status, "verified-plugin-wired");
assert.ok(ag.evidence.includes("scripts/smoke-antigravity-adapter.mjs"));
for (const evidencePath of ag.evidence) {
	assert.ok(existsSync(join(root, evidencePath)), `Antigravity evidence should exist: ${evidencePath}`);
}

assertContains(matrix, "Antigravity", "support matrix");

console.log("smoke-antigravity-adapter: ok");
