#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { linkProject } from "../lib/cli/link.mjs";
import { setupHeli } from "../lib/cli/setup.mjs";
import { createTask } from "../lib/concurrency/task.mjs";
import { createSession } from "../lib/concurrency/session.mjs";
import {
	acquireWriteLease,
	isLeaseExpired,
	readLease,
	releaseWriteLease,
	sessionHoldsWriteLease,
	takeoverWriteLease,
} from "../lib/concurrency/lease.mjs";
import {
	listResourceLeases,
	resourceIdForWorktree,
} from "../lib/concurrency/resource-authority.mjs";
import { pathsFor } from "../lib/concurrency/paths.mjs";
import { buildSessionContext, evaluatePreToolUse } from "../.heli-harness/adapters/shared/hook-core.mjs";

const root = mkdtempSync(join(tmpdir(), "heli-resource-authority-"));
const project = join(root, "project");
const tasklessProject = join(root, "taskless-project");
const wt2 = join(root, "worktree-2");
const config = join(root, "config");
const data = join(root, "data");
const env = { ...process.env, HELI_CONFIG_DIR: config, HELI_DATA_DIR: data };
const packageRoot = process.cwd();
mkdirSync(project, { recursive: true });
mkdirSync(tasklessProject, { recursive: true });
mkdirSync(wt2, { recursive: true });

const oldConfig = process.env.HELI_CONFIG_DIR;
const oldData = process.env.HELI_DATA_DIR;
process.env.HELI_CONFIG_DIR = config;
process.env.HELI_DATA_DIR = data;

try {
	setupHeli({ env });
	linkProject(packageRoot, project, { env });
	linkProject(packageRoot, tasklessProject, { env });

	// Fresh linked work with no named task must use resource authority, never
	// the embedded CONCURRENT_BOOTSTRAP exception.
	buildSessionContext(tasklessProject, { host: "test-host", env });
	const freshWrite = evaluatePreToolUse({
		cwd: tasklessProject,
		host: "test-host",
		env,
		toolName: "Write",
		toolInput: { file_path: join(tasklessProject, "fresh.txt") },
	});
	assert.equal(freshWrite.deny, false, freshWrite.reason || "fresh linked write should acquire resource authority");
	assert.notEqual(freshWrite.code, "CONCURRENT_BOOTSTRAP");
	const freshAuthorities = listResourceLeases(tasklessProject);
	assert.equal(freshAuthorities.length, 1);
	assert.equal(freshAuthorities[0].taskId, null);
	const paths = pathsFor(project);
	assert.equal(paths.linked, true);

	createTask(project, {
		taskId: "a",
		repositoryId: "demo",
		worktreePath: project,
		allowDuplicate: true,
	});
	createTask(project, {
		taskId: "b",
		repositoryId: "demo",
		worktreePath: project,
		allowDuplicate: true,
	});
	createTask(project, {
		taskId: "c",
		repositoryId: "demo",
		worktreePath: wt2,
		allowDuplicate: true,
	});

	const a = createSession(project, { sessionId: "a-session", taskId: "a", mode: "write", worktreePath: project });
	const b = createSession(project, { sessionId: "b-session", taskId: "b", mode: "write", worktreePath: project });
	const c = createSession(project, { sessionId: "c-session", taskId: "c", mode: "write", worktreePath: wt2 });

	const first = acquireWriteLease(project, {
		taskId: "a",
		sessionId: a.sessionId,
		worktreePath: project,
	});
	assert.equal(first.resource.type, "worktree");
	assert.equal(first.resource.id, resourceIdForWorktree(project));
	assert.equal(first.generation, 1);
	assert.equal(sessionHoldsWriteLease(project, "a", a.sessionId), true);

	assert.throws(
		() => acquireWriteLease(project, {
			taskId: "b",
			sessionId: b.sessionId,
			worktreePath: project,
		}),
		(error) => error.code === "WORKTREE_WRITER_HELD",
		"same resource must not admit a second task writer",
	);

	const independent = acquireWriteLease(project, {
		taskId: "c",
		sessionId: c.sessionId,
		worktreePath: wt2,
	});
	assert.equal(independent.resource.id, resourceIdForWorktree(wt2));
	assert.equal(listResourceLeases(project).filter((lease) => !lease.invalid).length, 2);
	assert.equal(paths.resourceLocksDir.includes("locks"), true);

	releaseWriteLease(project, "a", { sessionId: a.sessionId });
	const taken = takeoverWriteLease(project, {
		taskId: "b",
		sessionId: b.sessionId,
		worktreePath: project,
		confirm: true,
	});
	assert.equal(taken.taskId, "b");
	assert.equal(taken.generation, 1);
	assert.equal(readLease(project, "a"), null);
	assert.equal(readLease(project, "b").resource.id, resourceIdForWorktree(project));

	releaseWriteLease(project, "b", { sessionId: b.sessionId });
	releaseWriteLease(project, "c", { sessionId: c.sessionId });
	assert.equal(listResourceLeases(project).length, 0);

	console.log("resource authority smoke ok");
} finally {
	if (oldConfig == null) delete process.env.HELI_CONFIG_DIR;
	else process.env.HELI_CONFIG_DIR = oldConfig;
	if (oldData == null) delete process.env.HELI_DATA_DIR;
	else process.env.HELI_DATA_DIR = oldData;
	rmSync(root, { recursive: true, force: true });
}
