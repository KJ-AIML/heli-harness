#!/usr/bin/env node
import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import {
	continuationForWorktree,
	listActiveSessions,
	readResourceLeaseForWorktree,
} from "../lib/concurrency/index.mjs";
import { linkProject } from "../lib/cli/link.mjs";

const root = process.cwd();
const scratch = mkdtempSync(join(tmpdir(), "heli-opencode-lifecycle-"));
const workspace = join(scratch, "workspace");
const repoDir = join(workspace, "repos", "app");
const home = join(scratch, "home");
const config = join(scratch, "config");
const data = join(scratch, "data");
const prior = {
	HOME: process.env.HOME,
	USERPROFILE: process.env.USERPROFILE,
	HELI_CONFIG_DIR: process.env.HELI_CONFIG_DIR,
	HELI_DATA_DIR: process.env.HELI_DATA_DIR,
};

Object.assign(process.env, {
	HOME: home,
	USERPROFILE: home,
	HELI_CONFIG_DIR: config,
	HELI_DATA_DIR: data,
});

function git(args, cwd = repoDir) {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" });
	assert.equal(result.status, 0, result.stderr || result.stdout);
	return result.stdout.trim();
}

try {
	mkdirSync(repoDir, { recursive: true });
	mkdirSync(home, { recursive: true });
	git(["init", "-q"]);
	writeFileSync(join(repoDir, "notes.txt"), "baseline\n");
	git(["add", "."]);
	git(["-c", "user.name=Heli Test", "-c", "user.email=heli@example.invalid", "commit", "-qm", "baseline"]);

	const parent = linkProject(root, workspace);
	const nested = linkProject(root, repoDir);
	assert.equal(nested.workspaceId, parent.workspaceId);
	assert.equal(nested.nestedRepositoryRegistered, true);

	const pluginPath = join(root, ".heli-harness", "adapters", "opencode-plugin", "heli-harness.js");
	const mod = await import(pathToFileURL(pluginPath).href);
	const hooks = await mod.HeliHarness({ directory: repoDir });

	assert.equal(typeof hooks.event, "function");
	assert.equal(typeof hooks["experimental.chat.system.transform"], "function");
	assert.equal(typeof hooks["tool.execute.before"], "function");

	// First model-visible context is a valid lifecycle boundary even if the
	// OpenCode event bus did not emit session.created to this plugin instance.
	const firstSystem = { system: [] };
	await hooks["experimental.chat.system.transform"]({ sessionID: "oc-session-1" }, firstSystem);
	assert.ok(firstSystem.system.some((value) => /Heli Linked Session/.test(value)));

	let sessions = listActiveSessions(workspace);
	assert.equal(sessions.length, 1);
	assert.equal(sessions[0].host, "opencode");
	assert.equal(sessions[0].externalHostSessionId, "oc-session-1");
	assert.equal(sessions[0].runtimeAttestation?.observedCapabilities?.session_start?.observed, true);
	assert.equal(
		sessions[0].runtimeAttestation?.observedCapabilities?.session_start?.source,
		"experimental.chat.system.transform",
	);

	// A normal write must be allowed for this live OpenCode session. The old
	// deny-only smoke could not catch NO_SESSION here.
	await hooks["tool.execute.before"](
		{ tool: "write", sessionID: "oc-session-1" },
		{ args: { filePath: "notes.txt", content: "from opencode\n" } },
	);
	writeFileSync(join(repoDir, "notes.txt"), "from opencode\n");

	sessions = listActiveSessions(workspace);
	assert.equal(sessions[0].runtimeAttestation?.observedCapabilities?.pre_tool?.observed, true);
	const authority = readResourceLeaseForWorktree(workspace, repoDir);
	assert.equal(authority.sessionId, sessions[0].sessionId);
	const continuation = continuationForWorktree(workspace, repoDir);
	assert.ok(continuation);
	assert.equal(continuation.provenance.lastHost, "opencode");

	// Host deletion closes the exact OpenCode session and releases its writer.
	await hooks.event({
		event: {
			type: "session.deleted",
			properties: { info: { id: "oc-session-1" } },
		},
	});
	assert.equal(readResourceLeaseForWorktree(workspace, repoDir), null);
	assert.equal(listActiveSessions(workspace).length, 0);

	// A second real host session gets a fresh Heli session while seeing durable
	// unfinished context from the prior one.
	await hooks.event({
		event: {
			type: "session.created",
			properties: { info: { id: "oc-session-2" } },
		},
	});
	const secondSystem = { system: [] };
	await hooks["experimental.chat.system.transform"]({ sessionID: "oc-session-2" }, secondSystem);
	assert.ok(secondSystem.system.some((value) => /Durable continuation available/.test(value)));
	assert.ok(secondSystem.system.some((value) => /Previous host: opencode/.test(value)));

	const second = listActiveSessions(workspace);
	assert.equal(second.length, 1);
	assert.equal(second[0].externalHostSessionId, "oc-session-2");
	assert.notEqual(second[0].sessionId, sessions[0].sessionId);

	console.log("smoke-opencode-session-lifecycle: real write session + continuation lifecycle passed");
} finally {
	for (const [key, value] of Object.entries(prior)) {
		if (value == null) delete process.env[key];
		else process.env[key] = value;
	}
	rmSync(scratch, { recursive: true, force: true });
}
