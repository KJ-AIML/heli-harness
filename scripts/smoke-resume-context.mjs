#!/usr/bin/env node
/**
 * Read-only continuation smoke for `heli resume`.
 *
 * Covers: no active task, ready/blocked/satisfied coordination, multiple active
 * tasks without scheduling, clean/dirty Git, writer held/absent, runtime
 * observations, human/JSON CLI output, and a no-mutation assertion.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupHeli } from "../lib/cli/setup.mjs";
import { linkProject } from "../lib/cli/link.mjs";
import { buildResumeContext } from "../lib/cli/resume.mjs";
import { createTask, readTask } from "../lib/concurrency/task.mjs";
import { declareDependency, publishHandoff } from "../lib/concurrency/handoff.mjs";
import { createSession, readSession } from "../lib/concurrency/session.mjs";
import { observeRuntimeCapability } from "../lib/concurrency/attestation.mjs";
import {
	acquireResourceWriteAuthority,
	readResourceLeaseForWorktree,
} from "../lib/concurrency/resource-authority.mjs";
import { gitRevParse } from "../lib/concurrency/paths.mjs";
import { projectWorkspaceKey } from "../lib/concurrency/project-binding.mjs";
import {
	removeFixtureOwnedPath,
	removeFixtureWorkspaceState,
} from "./lib/fixture-state-safety.mjs";

const root = mkdtempSync(join(tmpdir(), "heli-resume-smoke-"));
const repo = join(root, "repo");
const fixtureDataRoot = join(root, "fixture-data");
const configRoot = join(root, "fixture-config");
const previousConfig = process.env.HELI_CONFIG_DIR;
const previousData = process.env.HELI_DATA_DIR;
const env = {
	...process.env,
	HELI_CONFIG_DIR: configRoot,
	HELI_DATA_DIR: fixtureDataRoot,
};
process.env.HELI_CONFIG_DIR = configRoot;
process.env.HELI_DATA_DIR = fixtureDataRoot;

let fixtureWorkspaceId = null;

function git(...args) {
	const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
	assert.equal(result.status, 0, result.stderr || `git ${args.join(" ")} failed`);
	return String(result.stdout || "").trim();
}

function runCli(args, { expectJson = false } = {}) {
	const result = spawnSync(
		"node",
		[join(process.cwd(), "bin", "heli.mjs"), ...args],
		{ encoding: "utf8", env },
	);
	assert.equal(
		result.status,
		0,
		`heli ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
	);
	if (!expectJson) return result.stdout;
	const parsed = JSON.parse(result.stdout);
	assert.equal(parsed.protocolVersion, 1);
	assert.equal(parsed.command, "resume");
	assert.equal(parsed.ok, true);
	return parsed;
}

try {
	mkdirSync(repo, { recursive: true });
	git("init", "-q");
	git("config", "user.email", "heli@test.local");
	git("config", "user.name", "heli");
	writeFileSync(join(repo, "README.md"), "resume fixture\n");
	git("add", "README.md");
	git("commit", "-q", "-m", "seed");

	setupHeli({ env });
	linkProject(process.cwd(), repo, { env });
	fixtureWorkspaceId = projectWorkspaceKey(repo, { env });
	assert.ok(fixtureWorkspaceId, "fixture workspace id required for exact cleanup");

	// A linked workspace's committed binding is part of the clean baseline.
	git("add", ".heli");
	git("commit", "-q", "-m", "link heli");

	// 1. No active task: still useful as workspace/Git/authority context.
	const empty = buildResumeContext(repo, { env });
	assert.equal(empty.workspace.workspaceId, fixtureWorkspaceId);
	assert.equal(empty.tasks.length, 0);
	assert.equal(empty.git.available, true);
	assert.equal(empty.git.dirty, false);
	assert.equal(empty.authority.state, "available");
	assert.match(empty.guidance.join("\n"), /No active durable task/);

	// 2. Two active tasks: resume exposes both and does not choose one.
	createTask(repo, { taskId: "epic-auth", title: "Auth", env });
	createTask(repo, { taskId: "epic-billing", title: "Billing", env });
	let multi = buildResumeContext(repo, { env });
	assert.deepEqual(multi.tasks.map((task) => task.taskId), ["epic-auth", "epic-billing"]);
	assert.match(multi.guidance.join("\n"), /Multiple active tasks/);

	// 3. Billing is blocked independently of its active lifecycle status.
	declareDependency(repo, {
		consumerTaskId: "epic-billing",
		producerTaskId: "epic-auth",
		artifactName: "auth-user-contract",
		env,
	});
	let blocked = buildResumeContext(repo, { env });
	let billing = blocked.tasks.find((task) => task.taskId === "epic-billing");
	assert.equal(billing.status, "active");
	assert.equal(billing.coordinationState, "blocked");
	assert.deepEqual(billing.blockedOn, ["epic-auth/auth-user-contract"]);

	// 4. Published Git snapshot satisfies the dependency without changing task status.
	const ref = gitRevParse(repo);
	publishHandoff(repo, {
		producerTaskId: "epic-auth",
		artifactName: "auth-user-contract",
		ref,
		path: "README.md",
		env,
	});
	const ready = buildResumeContext(repo, { env });
	billing = ready.tasks.find((task) => task.taskId === "epic-billing");
	assert.equal(billing.status, "active");
	assert.equal(billing.coordinationState, "ready");
	assert.equal(billing.dependencies[0].state, "satisfied");
	assert.equal(billing.dependencies[0].ref, ref);
	assert.equal(billing.dependencies[0].path, "README.md");

	// 5. A current writer is reported, never transferred.
	const session = createSession(repo, {
		externalHostSessionId: "codex-resume-smoke",
		host: "codex",
		taskId: "epic-billing",
		mode: "write",
		worktreePath: repo,
	});
	acquireResourceWriteAuthority(repo, {
		taskId: "epic-billing",
		sessionId: session.sessionId,
		worktreePath: repo,
	});
	observeRuntimeCapability(repo, session.sessionId, {
		host: "codex",
		capability: "session_start",
		source: "resume-smoke",
	});
	const held = buildResumeContext(repo, { env });
	assert.equal(held.authority.state, "held");
	assert.equal(held.authority.writerSessionId, session.sessionId);
	assert.equal(held.sessions.some((value) => value.sessionId === session.sessionId), true);
	assert.equal(
		held.observations.some(
			(value) => value.sessionId === session.sessionId && value.capability === "session_start",
		),
		true,
	);
	assert.match(held.guidance.join("\n"), /must not assume or inherit/);

	// 6. Dirty Git is surfaced explicitly.
	writeFileSync(join(repo, "WIP.txt"), "unfinished work\n");
	const dirty = buildResumeContext(repo, { env });
	assert.equal(dirty.git.dirty, true);
	assert.equal(dirty.git.changes.some((change) => change.path === "WIP.txt"), true);

	// 7. Resume is read-only: snapshot durable state, call repeatedly, compare.
	const before = {
		auth: readTask(repo, "epic-auth", { env }),
		billing: readTask(repo, "epic-billing", { env }),
		session: readSession(repo, session.sessionId),
		authority: readResourceLeaseForWorktree(repo, repo),
		head: gitRevParse(repo),
		status: git("status", "--porcelain=v1"),
	};
	const repeated = buildResumeContext(repo, { env });
	assert.equal(repeated.authority.writerSessionId, session.sessionId);
	const after = {
		auth: readTask(repo, "epic-auth", { env }),
		billing: readTask(repo, "epic-billing", { env }),
		session: readSession(repo, session.sessionId),
		authority: readResourceLeaseForWorktree(repo, repo),
		head: gitRevParse(repo),
		status: git("status", "--porcelain=v1"),
	};
	assert.deepEqual(after, before, "building resume context must not mutate durable or Git state");

	// 8. Real package CLI: stable JSON envelope and useful human packet.
	const machine = runCli(["resume", "--json", repo], { expectJson: true });
	assert.equal(machine.data.workspace.workspaceId, fixtureWorkspaceId);
	assert.equal(machine.data.tasks.length, 2);
	assert.equal(machine.data.authority.writerSessionId, session.sessionId);
	assert.equal(machine.data.git.dirty, true);

	const human = runCli(["resume", repo]);
	assert.match(human, /Heli resume/);
	assert.match(human, /Active tasks: 2/);
	assert.match(human, /epic-billing: status=active coordination=ready/);
	assert.match(human, /Writer: held/);
	assert.match(human, /WIP\.txt/);
	assert.match(human, /Continuation:/);

	console.log("resume context smoke ok");
} finally {
	if (fixtureWorkspaceId) {
		removeFixtureWorkspaceState(fixtureDataRoot, fixtureWorkspaceId);
	}
	if (previousConfig == null) delete process.env.HELI_CONFIG_DIR;
	else process.env.HELI_CONFIG_DIR = previousConfig;
	if (previousData == null) delete process.env.HELI_DATA_DIR;
	else process.env.HELI_DATA_DIR = previousData;
	removeFixtureOwnedPath(root, tmpdir());
}
