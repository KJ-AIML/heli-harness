#!/usr/bin/env node
import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { canonicalizePath, findWorkspaceRoot } from "../lib/concurrency/index.mjs";

const root = mkdtempSync(join(tmpdir(), "heli-multirepo-"));
const workspace = join(root, "workspace");
const app = join(workspace, "repos", "app");
const api = join(workspace, "repos", "api");
const external = join(root, "external");
const config = join(root, "config");
const data = join(root, "data");
const heli = join(process.cwd(), "bin", "heli.mjs");
const env = {
	...process.env,
	HELI_CONFIG_DIR: config,
	HELI_DATA_DIR: data,
	HOME: join(root, "home"),
	USERPROFILE: join(root, "home"),
};

function run(args, { cwd = workspace, status = 0 } = {}) {
	const result = spawnSync(process.execPath, [heli, ...args], {
		cwd,
		env,
		encoding: "utf8",
	});
	assert.equal(
		result.status,
		status,
		`heli ${args.join(" ")} expected ${status}, got ${result.status}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
	);
	return result;
}

function gitInit(dir) {
	mkdirSync(dir, { recursive: true });
	const result = spawnSync("git", ["init", "-q", dir], { encoding: "utf8" });
	assert.equal(result.status, 0, result.stderr);
}

try {
	mkdirSync(join(workspace, "docs"), { recursive: true });
	gitInit(app);
	gitInit(api);
	gitInit(external);
	mkdirSync(env.HOME, { recursive: true });

	// A heli-harness source checkout carries .heli-harness as package content.
	// Inside a linked parent that package tree must not shadow the parent binding.
	mkdirSync(join(app, ".heli-harness"), { recursive: true });
	mkdirSync(join(app, "bin"), { recursive: true });
	writeFileSync(join(app, ".heli-harness", "HARNESS.md"), "# packaged harness\n");
	writeFileSync(join(app, "package.json"), JSON.stringify({ name: "heli-harness", version: "0.0.0-test" }) + "\n");
	writeFileSync(join(app, "bin", "heli.mjs"), "#!/usr/bin/env node\n");

	run(["setup", "--json"]);
	const parentLink = JSON.parse(run(["link", workspace, "--json"]).stdout);
	assert.equal(parentLink.ok, true);
	const parentWorkspaceId = parentLink.data.workspaceId;
	assert.ok(parentWorkspaceId);
	assert.ok(existsSync(join(workspace, ".heli", "workspace.json")));

	// Linking from a nested Git repository must register it into the parent,
	// never create a second Heli workspace.
	const nested = JSON.parse(run(["link", app, "--json"], { cwd: app }).stdout);
	assert.equal(nested.ok, true);
	assert.equal(nested.data.workspaceId, parentWorkspaceId);
	assert.equal(nested.data.workspaceRoot, canonicalizePath(workspace));
	assert.equal(nested.data.nestedRepositoryRegistered, true);
	assert.equal(nested.data.repository.path, "repos/app");
	assert.equal(existsSync(join(app, ".heli")), false);
	assert.equal(findWorkspaceRoot(join(app, "src")), canonicalizePath(workspace));

	// Ordinary embedded workspaces still keep nearest-workspace precedence.
	const legacy = join(workspace, "repos", "legacy");
	mkdirSync(join(legacy, ".heli-harness"), { recursive: true });
	writeFileSync(join(legacy, ".heli-harness", "HARNESS.md"), "# embedded workspace\n");
	assert.equal(findWorkspaceRoot(join(legacy, "src")), canonicalizePath(legacy));

	// A standalone Heli source checkout still falls back to its packaged
	// embedded workspace when no linked parent exists.
	const standaloneSource = join(root, "standalone-heli-source");
	mkdirSync(join(standaloneSource, ".heli-harness"), { recursive: true });
	mkdirSync(join(standaloneSource, "bin"), { recursive: true });
	writeFileSync(join(standaloneSource, ".heli-harness", "HARNESS.md"), "# packaged harness\n");
	writeFileSync(join(standaloneSource, "package.json"), JSON.stringify({ name: "heli-harness", version: "0.0.0-test" }) + "\n");
	writeFileSync(join(standaloneSource, "bin", "heli.mjs"), "#!/usr/bin/env node\n");
	assert.equal(findWorkspaceRoot(join(standaloneSource, "src")), canonicalizePath(standaloneSource));

	const listed = JSON.parse(run(["repo", "list", workspace, "--json"]).stdout);
	assert.equal(listed.ok, true);
	assert.ok(listed.data.repos.some((repo) => repo.path === "repos/app"));

	const status = JSON.parse(run(["status", app, "--json"], { cwd: app }).stdout);
	assert.equal(status.ok, true);
	assert.equal(status.data.workspaceRoot, canonicalizePath(workspace));
	assert.equal(status.data.workspaceId, parentWorkspaceId);

	// Discovery registers another nested Git repo without creating a workspace.
	const discovered = JSON.parse(
		run(["repo", "discover", join(workspace, "repos"), "--depth", "2", "--json"]).stdout,
	);
	assert.equal(discovered.ok, true);
	assert.ok(discovered.data.repos.some((repo) => repo.path === "repos/api"));
	assert.equal(existsSync(join(api, ".heli")), false);

	// An already-independent nested workspace is a conflict, not something Heli
	// silently absorbs or deletes.
	const independent = JSON.parse(run(["link", external, "--json"], { cwd: external }).stdout);
	assert.equal(independent.ok, true);
	assert.notEqual(independent.data.workspaceId, parentWorkspaceId);
	const moved = join(workspace, "repos", "independent");
	renameSync(external, moved);
	const conflict = run(["link", moved, "--json"], { cwd: moved, status: 1 });
	const conflictJson = JSON.parse(conflict.stdout);
	assert.equal(conflictJson.ok, false);
	assert.equal(conflictJson.errors[0].code, "NESTED_WORKSPACE_CONFLICT");
	assert.ok(existsSync(join(moved, ".heli", "workspace.json")));

	console.log("smoke-multirepo-workspace: ok");
} finally {
	rmSync(root, { recursive: true, force: true });
}
