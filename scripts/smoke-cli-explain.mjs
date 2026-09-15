#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const heli = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "heli.mjs");
const parent = mkdtempSync(join(tmpdir(), "heli-explain-"));
function run(args, status = 0) {
	const result = spawnSync(process.execPath, [heli, ...args], { encoding: "utf8" });
	assert.equal(result.status, status, `${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
	return result.stdout;
}
try {
	run(["install", parent]);
	const authority = JSON.parse(run(["explain", "authority", parent, "--json"]));
	assert.equal(authority.protocolVersion, 1);
	assert.equal(authority.command, "explain.authority");
	assert.equal(authority.ok, true);
	assert.equal(authority.data.workspaceMode, "concurrent");
	assert.equal(authority.data.writable, false);
	const capabilities = JSON.parse(run(["explain", "capabilities", parent, "--json"]));
	assert.equal(capabilities.ok, true);
	assert.ok(Array.isArray(capabilities.data.adapters));
	console.log("cli explain smoke ok");
} finally {
	rmSync(parent, { recursive: true, force: true });
}
