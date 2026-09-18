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
import { join } from "node:path";
import { setupHeli } from "../lib/cli/setup.mjs";
import { linkProject } from "../lib/cli/link.mjs";
import { collectBundleFiles } from "../lib/cli/cloud-bundle.mjs";
import { createTask } from "../lib/concurrency/task.mjs";
import { createSession } from "../lib/concurrency/session.mjs";
import { acquireWriteLease } from "../lib/concurrency/lease.mjs";
import { issueGrant } from "../lib/concurrency/grant.mjs";
import { projectWorkspaceKey } from "../lib/concurrency/project-binding.mjs";
import { pathsFor } from "../lib/concurrency/paths.mjs";

const root = mkdtempSync(join(tmpdir(), "heli-linked-portability-"));
const config = join(root, "config");
const data = join(root, "data");
const env = { ...process.env, HELI_CONFIG_DIR: config, HELI_DATA_DIR: data };
const oldConfig = process.env.HELI_CONFIG_DIR;
const oldData = process.env.HELI_DATA_DIR;
process.env.HELI_CONFIG_DIR = config;
process.env.HELI_DATA_DIR = data;

try {
	const project = join(root, "project");
	mkdirSync(project, { recursive: true });
	setupHeli({ env });
	linkProject(process.cwd(), project, { env });

	createTask(project, {
		taskId: "portable-work",
		repositoryId: "demo",
		worktreePath: project,
		allowDuplicate: true,
	});
	const session = createSession(project, {
		sessionId: "portable-session",
		taskId: "portable-work",
		mode: "write",
		worktreePath: project,
	});
	acquireWriteLease(project, {
		taskId: "portable-work",
		sessionId: session.sessionId,
		worktreePath: project,
	});
	issueGrant(project, {
		action: "git.push",
		scope: "workspace",
		resource: { type: "workspace", id: projectWorkspaceKey(project, { env }) },
		env,
	});

	const files = collectBundleFiles(project);
	assert.ok(files["tasks/portable-work/task.json"], "work record should be portable");
	for (const rel of Object.keys(files)) {
		assert.equal(rel.startsWith("sessions/"), false);
		assert.equal(rel.startsWith("bindings/"), false);
		assert.equal(rel.startsWith("locks/"), false);
		assert.notEqual(rel, "state/yolo.json");
		assert.notEqual(rel, "state/sync.json");
	}
	assert.equal(
		JSON.stringify(files).includes("heli-grant-"),
		false,
		"grants must never enter portable evidence bundles",
	);

	// Embedded -> linked migration may copy work/evidence but must invalidate old
	// execution authority, even when the old lease is merely stale.
	const legacy = join(root, "legacy");
	const embedded = join(legacy, ".heli-harness");
	mkdirSync(join(embedded, "state"), { recursive: true });
	mkdirSync(join(embedded, "sessions"), { recursive: true });
	mkdirSync(join(embedded, "bindings", "worktrees"), { recursive: true });
	mkdirSync(join(embedded, "locks", "tasks", "old.write.lock"), { recursive: true });
	mkdirSync(join(embedded, "tasks", "old"), { recursive: true });
	mkdirSync(join(embedded, "workspace"), { recursive: true });
	writeFileSync(join(embedded, "HARNESS.md"), "# Heli\n");
	writeFileSync(
		join(embedded, "manifest.json"),
		JSON.stringify({ version: "test", supportsLinkedWorkspace: true }),
	);
	writeFileSync(join(embedded, "state", "current-task.md"), "# Current Task\nCurrent status: complete\n");
	writeFileSync(join(embedded, "state", "decisions.md"), "# Decisions\n");
	writeFileSync(join(embedded, "state", "yolo.json"), JSON.stringify({ enabled: true }));
	writeFileSync(join(embedded, "sessions", "old.json"), JSON.stringify({ sessionId: "old" }));
	writeFileSync(join(embedded, "bindings", "worktrees", "old.json"), JSON.stringify({ defaultSessionId: "old" }));
	writeFileSync(
		join(embedded, "locks", "tasks", "old.write.lock", "lease.json"),
		JSON.stringify({
			taskId: "old",
			sessionId: "old",
			leaseId: "old-lease",
			expiresAt: new Date(Date.now() - 60_000).toISOString(),
		}),
	);
	writeFileSync(
		join(embedded, "tasks", "old", "task.json"),
		JSON.stringify({ schemaVersion: 1, taskId: "old", status: "complete" }),
	);
	writeFileSync(
		join(embedded, "workspace", "schema.json"),
		JSON.stringify({ schemaVersion: 1, mode: "concurrent" }),
	);
	writeFileSync(
		join(embedded, "workspace", "index.json"),
		JSON.stringify({ schemaVersion: 1, workspaceRoot: ".", repos: [] }),
	);
	writeFileSync(
		join(embedded, "workspace", "target.json"),
		JSON.stringify({ schemaVersion: 1, targetRepo: "" }),
	);

	linkProject(process.cwd(), legacy, { env });
	const linked = pathsFor(legacy);
	assert.equal(linked.linked, true);
	assert.ok(existsSync(join(linked.tasksDir, "old", "task.json")), "work record should migrate");
	assert.equal(existsSync(linked.sessionsDir), false, "sessions must not migrate");
	assert.equal(existsSync(linked.bindingsDir), false, "bindings must not migrate");
	assert.equal(existsSync(join(linked.heliDir, "locks", "tasks")), false, "task authority locks must not migrate");
	assert.equal(existsSync(linked.legacyYoloPath), false, "YOLO authority must not migrate");

	console.log("linked portability smoke ok");
} finally {
	if (oldConfig == null) delete process.env.HELI_CONFIG_DIR;
	else process.env.HELI_CONFIG_DIR = oldConfig;
	if (oldData == null) delete process.env.HELI_DATA_DIR;
	else process.env.HELI_DATA_DIR = oldData;
	rmSync(root, { recursive: true, force: true });
}
