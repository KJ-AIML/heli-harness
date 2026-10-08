#!/usr/bin/env node
import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { canonicalizePath } from "../lib/concurrency/index.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const heli = join(repoRoot, "bin", "heli.mjs");
const currentVersion = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).version;
const root = mkdtempSync(join(tmpdir(), "heli-migrate-"));
const devRoot = join(root, "Developer");
const wsA = join(devRoot, "workspace-a");
const wsB = join(devRoot, "nested", "workspace-b");
const outside = join(root, "outside-workspace");
const missing = join(devRoot, "missing-workspace");
const config = join(root, "config");
const data = join(root, "data");
const env = { ...process.env, HELI_CONFIG_DIR: config, HELI_DATA_DIR: data };

for (const dir of [wsA, wsB, outside]) mkdirSync(dir, { recursive: true });

function run(args, status = 0) {
	const result = spawnSync(process.execPath, [heli, ...args], {
		encoding: "utf8",
		env,
		cwd: repoRoot,
	});
	assert.equal(result.status, status, `heli ${args.join(" ")} expected ${status}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
	return result;
}

function json(args, status = 0) {
	return JSON.parse(run([...args, "--json"], status).stdout).data;
}

function lockPath(workspace) {
	return join(workspace, ".heli", "heli.lock");
}

function setLockVersion(workspace, version) {
	const lock = JSON.parse(readFileSync(lockPath(workspace), "utf8"));
	lock.runtime.version = version;
	writeFileSync(lockPath(workspace), JSON.stringify(lock, null, 2) + "\n");
}

function getLockVersion(workspace) {
	return JSON.parse(readFileSync(lockPath(workspace), "utf8")).runtime.version;
}

try {
	run(["setup", "--json"]);
	const a = json(["link", wsA]);
	const b = json(["link", wsB]);
	json(["link", outside]);

	setLockVersion(wsA, "0.10.0");
	setLockVersion(wsB, "0.10.0");
	setLockVersion(outside, "0.10.0");

	// Authority/runtime state is execution-local and must survive migration.
	const sentinel = join(a.operationalRoot, "sessions", "authority-sentinel.json");
	mkdirSync(dirname(sentinel), { recursive: true });
	writeFileSync(sentinel, JSON.stringify({ sessionId: "sentinel", status: "active" }) + "\n");

	const preview = json(["migrate", "--root", devRoot, "--dry-run"]);
	assert.equal(preview.dryRun, true);
	assert.equal(preview.results.length, 2);
	assert.ok(preview.results.every((item) => item.status === "would-migrate"));
	assert.equal(getLockVersion(wsA), "0.10.0");
	assert.equal(getLockVersion(wsB), "0.10.0");
	assert.equal(getLockVersion(outside), "0.10.0");
	assert.ok(existsSync(sentinel), "dry-run must not touch authority state");

	const migrated = json(["migrate", "--root", devRoot]);
	assert.equal(migrated.summary.migrated, 2);
	assert.equal(migrated.summary.failed, 0);
	assert.equal(getLockVersion(wsA), currentVersion);
	assert.equal(getLockVersion(wsB), currentVersion);
	assert.equal(getLockVersion(outside), "0.10.0", "--root must not migrate workspaces outside the selected tree");
	assert.ok(existsSync(sentinel), "migration must preserve execution-local authority state");

	// A missing/malformed lock is recoverable from the installed global runtime.
	writeFileSync(lockPath(wsB), "{\n  \"broken\": true\n}\n");
	const repaired = json(["migrate", wsB]);
	assert.equal(repaired.results[0].status, "migrated");
	assert.equal(getLockVersion(wsB), currentVersion);

	// Registry is only a locator. If it is lost, --discover rebuilds location
	// knowledge from committed .heli/workspace.json bindings under a chosen root.
	const registryPath = join(data, "registry", "workspaces.json");
	writeFileSync(registryPath, JSON.stringify({
		schemaVersion: 1,
		workspaces: [{ workspaceId: "stale", path: missing, executionId: "none" }],
	}, null, 2) + "\n");
	setLockVersion(wsA, "0.10.0");

	const discovered = json(["migrate", "--root", devRoot, "--discover", "--depth", "3"]);
	assert.ok(discovered.results.some((item) => item.path === canonicalizePath(wsA) && item.status === "migrated"));
	assert.ok(discovered.results.some((item) => item.path === canonicalizePath(wsB)));
	assert.ok(discovered.results.some((item) => item.path === canonicalizePath(missing) && item.status === "missing"));
	assert.equal(getLockVersion(wsA), currentVersion);
	assert.ok(existsSync(sentinel), "discovery migration must preserve authority state");

	const registry = JSON.parse(readFileSync(registryPath, "utf8"));
	assert.ok(registry.workspaces.some((item) => item.workspaceId === a.workspaceId && item.path === canonicalizePath(wsA)));
	assert.ok(registry.workspaces.some((item) => item.workspaceId === b.workspaceId && item.path === canonicalizePath(wsB)));

	console.log("smoke-migrate-workspaces: ok");
} finally {
	rmSync(root, { recursive: true, force: true });
}
