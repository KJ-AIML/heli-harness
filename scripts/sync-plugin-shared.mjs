#!/usr/bin/env node
/**
 * Keep plugin-local `shared/` copies identical to adapters/shared.
 *
 * Host plugin caches (Codex marketplace, Claude --plugin-dir copies) only ship
 * the plugin directory. Hooks import `../shared/...` so each plugin must embed
 * a full copy of the shared hook-core + concurrency modules.
 *
 * Canonical source of truth: .heli-harness/adapters/shared
 * Run: node scripts/sync-plugin-shared.mjs
 * Check mode: node scripts/sync-plugin-shared.mjs --check
 */
import assert from "node:assert/strict";
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const src = join(root, ".heli-harness", "adapters", "shared");
const plugins = [
	"claude-plugin",
	"codex-plugin",
	"grok-plugin",
	"kimi-plugin",
	"antigravity-plugin",
	"opencode-plugin",
];

function listFiles(dir, acc = [], base = dir) {
	if (!existsSync(dir)) return acc;
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) listFiles(p, acc, base);
		else acc.push(relative(base, p).replaceAll("\\", "/"));
	}
	return acc.sort();
}

const check = process.argv.includes("--check");
assert.ok(existsSync(src), "adapters/shared missing");

for (const plugin of plugins) {
	const dest = join(root, ".heli-harness", "adapters", plugin, "shared");
	if (check) {
		assert.ok(existsSync(dest), `${plugin}/shared missing — run: node scripts/sync-plugin-shared.mjs`);
		const srcFiles = listFiles(src);
		const destFiles = listFiles(dest);
		assert.deepEqual(destFiles, srcFiles, `${plugin}/shared file list differs from adapters/shared`);
		for (const rel of srcFiles) {
			const a = readFileSync(join(src, rel));
			const b = readFileSync(join(dest, rel));
			assert.ok(a.equals(b), `${plugin}/shared/${rel} differs from adapters/shared — run sync-plugin-shared.mjs`);
		}
		console.log(`ok: ${plugin}/shared matches adapters/shared`);
	} else {
		if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
		cpSync(src, dest, { recursive: true });
		console.log(`synced ${plugin}/shared`);
	}
}

if (check) console.log("sync-plugin-shared --check: ok");
else console.log("sync-plugin-shared: done");
