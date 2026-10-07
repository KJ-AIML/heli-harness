#!/usr/bin/env node
/**
 * Real OpenCode lifecycle acceptance for taskless Heli continuity.
 *
 * Copies the working-tree OpenCode plugin into an isolated workspace, then
 * drives a real `opencode run` harmless write. After the host exits, Heli must
 * have closed the session, released writer authority, and preserved continuation.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	continuationForWorktree,
	listActiveSessions,
	listSessions,
	readResourceLeaseForWorktree,
} from "../lib/concurrency/index.mjs";
import { linkProject } from "../lib/cli/link.mjs";

const root = process.cwd();
const version = spawnSync("opencode", ["--version"], { encoding: "utf8" });
if (version.error?.code === "ENOENT") {
	console.log("skip: opencode CLI not installed");
	process.exit(0);
}

const scratch = mkdtempSync(join(tmpdir(), "heli-live-opencode-lifecycle-"));
const workspace = join(scratch, "workspace");
const repoDir = join(workspace, "repos", "app");
const config = join(scratch, "heli-config");
const data = join(scratch, "heli-data");
const prior = {
	HELI_CONFIG_DIR: process.env.HELI_CONFIG_DIR,
	HELI_DATA_DIR: process.env.HELI_DATA_DIR,
	HELI_SESSION_ID: process.env.HELI_SESSION_ID,
	HELI_YOLO: process.env.HELI_YOLO,
	HELI_GUARDS: process.env.HELI_GUARDS,
	PWD: process.env.PWD,
	OLDPWD: process.env.OLDPWD,
};

Object.assign(process.env, {
	HELI_CONFIG_DIR: config,
	HELI_DATA_DIR: data,
	HELI_YOLO: "0",
	HELI_GUARDS: "on",
});
delete process.env.HELI_SESSION_ID;

function git(args) {
	const result = spawnSync("git", args, { cwd: repoDir, encoding: "utf8" });
	assert.equal(result.status, 0, result.stderr || result.stdout);
}

try {
	mkdirSync(repoDir, { recursive: true });
	git(["init", "-q"]);
	writeFileSync(join(repoDir, "notes.txt"), "baseline\n");
	git(["add", "."]);
	git(["-c", "user.name=Heli Test", "-c", "user.email=heli@example.invalid", "commit", "-qm", "baseline"]);

	const parent = linkProject(root, workspace);
	const nested = linkProject(root, repoDir);
	assert.equal(nested.workspaceId, parent.workspaceId);
	assert.equal(nested.nestedRepositoryRegistered, true);

	const pluginSrc = join(root, ".heli-harness", "adapters", "opencode-plugin");
	cpSync(pluginSrc, join(repoDir, ".opencode", "plugins"), { recursive: true });

	const env = {
		...process.env,
		HELI_CONFIG_DIR: config,
		HELI_DATA_DIR: data,
		HELI_YOLO: "0",
		HELI_GUARDS: "on",
		PWD: repoDir,
		OLDPWD: repoDir,
	};
	delete env.HELI_SESSION_ID;

	const prompt = [
		"This is a harmless lifecycle acceptance fixture.",
		"Use the edit or write tool to change notes.txt so its only text is: from real opencode",
		"Do not run bash, git, network, or package-manager commands.",
		"After the file write succeeds, reply exactly OPENCODE_WRITE_DONE.",
	].join(" ");

	const run = spawnSync("opencode", ["run", prompt], {
		cwd: repoDir,
		env,
		encoding: "utf8",
		timeout: 180_000,
	});
	const output = `${run.stdout || ""}\n${run.stderr || ""}`;
	assert.equal(run.signal, null, `opencode lifecycle acceptance was terminated: ${run.signal}\n${output}`);
	assert.equal(run.status, 0, `opencode lifecycle acceptance failed (exit=${run.status})\n${output}`);
	assert.equal(readFileSync(join(repoDir, "notes.txt"), "utf8").trim(), "from real opencode");

	const hostSessions = listSessions(workspace).filter((session) => session.host === "opencode");
	assert.ok(hostSessions.length >= 1, `expected a persisted OpenCode Heli session\n${output}`);
	const latest = [...hostSessions].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).at(-1);
	assert.equal(latest.status, "closed", "real OpenCode exit must close the Heli session");
	assert.equal(latest.taskId, null, "real taskless OpenCode work must not invent a task");
	assert.equal(
		listActiveSessions(workspace).filter((session) => session.host === "opencode").length,
		0,
		"no OpenCode Heli session may remain active after opencode run exits",
	);
	assert.equal(readResourceLeaseForWorktree(workspace, repoDir), null, "OpenCode exit must release writer authority");
	const continuation = continuationForWorktree(workspace, repoDir);
	assert.ok(continuation, "real OpenCode write must leave durable continuation");
	assert.equal(continuation.provenance?.lastHost, "opencode");
	assert.equal(continuation.leaseId, undefined);

	console.log("opencode live lifecycle verify:");
	console.log(`  opencode=${String(version.stdout || "").trim()}`);
	console.log(`  heliSession=${latest.sessionId}`);
	console.log(`  continuation=${continuation.continuationId} lastHost=${continuation.provenance?.lastHost}`);
	console.log("  normal harmless write: PASS");
	console.log("  session close + writer release: PASS");
	console.log("opencode live lifecycle verify ok");
} finally {
	for (const [key, value] of Object.entries(prior)) {
		if (value == null) delete process.env[key];
		else process.env[key] = value;
	}
	rmSync(scratch, { recursive: true, force: true });
}
