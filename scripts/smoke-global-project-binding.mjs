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
import {
	findWorkspaceRoot,
	pathsFor,
} from "../lib/concurrency/index.mjs";

const root = mkdtempSync(join(tmpdir(), "heli-linked-"));
const project = join(root, "project");
const config = join(root, "config");
const data = join(root, "data");
const heli = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "heli.mjs");
mkdirSync(join(project, "src"), { recursive: true });
const env = { ...process.env, HELI_CONFIG_DIR: config, HELI_DATA_DIR: data };
const oldConfig = process.env.HELI_CONFIG_DIR;
const oldData = process.env.HELI_DATA_DIR;
process.env.HELI_CONFIG_DIR = config;
process.env.HELI_DATA_DIR = data;

function run(args, status = 0) {
	const result = spawnSync(process.execPath, [heli, ...args], { encoding: "utf8", env });
	assert.equal(result.status, status, `${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
	return result;
}

try {
	const setup = run(["setup", "--json"]);
	const setupJson = JSON.parse(setup.stdout);
	assert.equal(setupJson.ok, true);
	assert.match(setupJson.data.machineId, /^heli-machine-/);

	const linked = run(["link", project, "--json"]);
	const linkedJson = JSON.parse(linked.stdout);
	assert.equal(linkedJson.ok, true);
	assert.match(linkedJson.data.workspaceId, /^heli-ws-/);
	assert.match(linkedJson.data.executionId, /^heli-exec-/);
	assert.ok(existsSync(join(project, ".heli", "workspace.json")));
	assert.ok(existsSync(join(project, ".heli", "heli.lock")));
	assert.equal(findWorkspaceRoot(join(project, "src")), project.replaceAll("\\", "/"));

	const firstPaths = pathsFor(project);
	assert.equal(firstPaths.linked, true);
	assert.ok(firstPaths.operationalRoot.startsWith(data));
	assert.ok(existsSync(firstPaths.schemaPath));
	assert.ok(existsSync(firstPaths.indexPath));

	// The global registry is a rebuildable locator only. Deleting it must not
	// alter linked state resolution or authority identity.
	rmSync(join(data, "registry", "workspaces.json"), { force: true });
	const afterRegistryDelete = pathsFor(project);
	assert.equal(afterRegistryDelete.operationalRoot, firstPaths.operationalRoot);

	// Committed project identity copied to another checkout must not copy local
	// operational authority. A second machine identity yields another execution.
	const clone = join(root, "clone");
	mkdirSync(clone, { recursive: true });
	mkdirSync(join(clone, ".heli"), { recursive: true });
	writeFileSync(
		join(clone, ".heli", "workspace.json"),
		readFileSync(join(project, ".heli", "workspace.json")),
	);
	writeFileSync(
		join(clone, ".heli", "heli.lock"),
		readFileSync(join(project, ".heli", "heli.lock")),
	);
	const config2 = join(root, "config2");
	const data2 = join(root, "data2");
	const env2 = { ...process.env, HELI_CONFIG_DIR: config2, HELI_DATA_DIR: data2 };
	const setup2 = spawnSync(process.execPath, [heli, "setup", "--json"], { encoding: "utf8", env: env2 });
	assert.equal(setup2.status, 0, setup2.stderr);
	const link2 = spawnSync(process.execPath, [heli, "link", clone, "--json"], { encoding: "utf8", env: env2 });
	assert.equal(link2.status, 0, link2.stderr);
	const cloneLinked = JSON.parse(link2.stdout);
	assert.equal(cloneLinked.data.workspaceId, linkedJson.data.workspaceId);
	assert.notEqual(cloneLinked.data.executionId, linkedJson.data.executionId);
	assert.notEqual(cloneLinked.data.operationalRoot, linkedJson.data.operationalRoot);

	// First cutover from embedded mode is fail-closed while a live lease exists.
	const legacy = join(root, "legacy");
	mkdirSync(join(legacy, ".heli-harness", "locks", "tasks", "t1.write.lock"), { recursive: true });
	writeFileSync(
		join(legacy, ".heli-harness", "manifest.json"),
		JSON.stringify({ version: "test", supportsLinkedWorkspace: true }),
	);
	writeFileSync(join(legacy, ".heli-harness", "HARNESS.md"), "# Heli\n");
	writeFileSync(
		join(legacy, ".heli-harness", "locks", "tasks", "t1.write.lock", "lease.json"),
		JSON.stringify({
			taskId: "t1",
			sessionId: "s1",
			leaseId: "l1",
			expiresAt: new Date(Date.now() + 60000).toISOString(),
		}),
	);
	const refused = run(["link", legacy, "--json"], 1);
	const refusedJson = JSON.parse(refused.stdout);
	assert.equal(refusedJson.errors[0].code, "LINK_ACTIVE_AUTHORITY");

	console.log("global project binding smoke ok");
} finally {
	if (oldConfig == null) delete process.env.HELI_CONFIG_DIR;
	else process.env.HELI_CONFIG_DIR = oldConfig;
	if (oldData == null) delete process.env.HELI_DATA_DIR;
	else process.env.HELI_DATA_DIR = oldData;
	rmSync(root, { recursive: true, force: true });
}
