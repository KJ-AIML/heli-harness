#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, cpSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { install } from "../lib/cli/install.mjs";
import { update } from "../lib/cli/update.mjs";

const root = process.cwd();
const sourceHarnessDir = join(root, ".heli-harness");

// Preserves profiles/ and state/ by default while picking up shipped-default changes
{
	const parentDir = mkdtempSync(join(tmpdir(), "heli-cli-update-"));
	try {
		install(sourceHarnessDir, parentDir);
		const profileDir = join(parentDir, ".heli-harness", "profiles");
		mkdirSync(profileDir, { recursive: true });
		writeFileSync(join(profileDir, "my-repo.md"), "# My Repo\nlocal content\n");
		const stateDir = join(parentDir, ".heli-harness", "state");
		mkdirSync(stateDir, { recursive: true });
		writeFileSync(join(stateDir, "current-task.md"), "# Current Task\n\nTask: my real task\n");
		const tasksDir = join(parentDir, ".heli-harness", "tasks", "demo-task");
		mkdirSync(tasksDir, { recursive: true });
		writeFileSync(join(tasksDir, "task.json"), JSON.stringify({ taskId: "demo-task" }) + "\n");

		const result = update(sourceHarnessDir, parentDir);

		assert.equal(readFileSync(join(profileDir, "my-repo.md"), "utf8"), "# My Repo\nlocal content\n", "profiles/ must survive update");
		assert.match(readFileSync(join(stateDir, "current-task.md"), "utf8"), /my real task/, "state/ must survive update by default");
		assert.ok(existsSync(join(parentDir, ".heli-harness", "HARNESS.md")), "shipped HARNESS.md must still be present");
		assert.match(readFileSync(join(tasksDir, "task.json"), "utf8"), /demo-task/, "tasks/ must survive update by default");
		assert.deepEqual(result.preserveDirs, [
			"profiles",
			"workspace",
			"policies",
			"safety",
			"state",
			"tasks",
			"sessions",
			"bindings",
			"locks",
		]);
	} finally {
		rmSync(parentDir, { recursive: true, force: true });
	}
}

// --reset-state reseeds clean operational state (never package dogfood)
{
	const parentDir = mkdtempSync(join(tmpdir(), "heli-cli-update-"));
	try {
		install(sourceHarnessDir, parentDir);
		const stateDir = join(parentDir, ".heli-harness", "state");
		mkdirSync(stateDir, { recursive: true });
		writeFileSync(join(stateDir, "current-task.md"), "# Current Task\n\nTask: stale local task\n");
		const tasksDir = join(parentDir, ".heli-harness", "tasks", "stale-task");
		mkdirSync(tasksDir, { recursive: true });
		writeFileSync(join(tasksDir, "task.json"), JSON.stringify({ taskId: "stale-task" }) + "\n");

		const result = update(sourceHarnessDir, parentDir, { resetState: true });

		const updatedTaskText = existsSync(join(stateDir, "current-task.md"))
			? readFileSync(join(stateDir, "current-task.md"), "utf8")
			: "";
		assert.ok(!updatedTaskText.includes("stale local task"), "resetState must drop user task text");
		assert.match(updatedTaskText, /idle/i, "resetState must reseed idle current-task");
		assert.ok(!existsSync(join(parentDir, ".heli-harness", "tasks", "stale-task")), "resetState must drop tasks");
		assert.deepEqual(result.preserveDirs, ["profiles", "workspace", "policies", "safety"]);
	} finally {
		rmSync(parentDir, { recursive: true, force: true });
	}
}

// update must not import package operational pollution when destination lacked those dirs
{
	const parentDir = mkdtempSync(join(tmpdir(), "heli-cli-update-pollute-"));
	const pollutedPkg = mkdtempSync(join(tmpdir(), "heli-polluted-src-"));
	try {
		install(sourceHarnessDir, parentDir);
		// Build a polluted source harness (distribution + fake sessions)
		cpSync(sourceHarnessDir, join(pollutedPkg, ".heli-harness"), { recursive: true });
		const pol = join(pollutedPkg, ".heli-harness");
		mkdirSync(join(pol, "sessions"), { recursive: true });
		writeFileSync(
			join(pol, "sessions", "heli-ses-update-pollution.json"),
			JSON.stringify({ sessionId: "heli-ses-update-pollution", status: "active" }),
		);
		mkdirSync(join(pol, "tasks", "docs-overhaul"), { recursive: true });
		writeFileSync(join(pol, "tasks", "docs-overhaul", "task.json"), JSON.stringify({ taskId: "docs-overhaul" }));
		writeFileSync(join(pol, "state", "current-task.md"), "# Current Task\n\nTask: docs-overhaul pollution\n");

		update(pol, parentDir, { resetState: false });

		assert.ok(
			!existsSync(join(parentDir, ".heli-harness", "sessions", "heli-ses-update-pollution.json")),
			"update must not copy package sessions into dest that had none",
		);
		assert.ok(
			!existsSync(join(parentDir, ".heli-harness", "tasks", "docs-overhaul")),
			"update must not copy package tasks into dest",
		);
		const taskAfter = readFileSync(join(parentDir, ".heli-harness", "state", "current-task.md"), "utf8");
		assert.ok(!taskAfter.includes("docs-overhaul pollution"), "update must preserve dest state, not source dogfood");
	} finally {
		rmSync(parentDir, { recursive: true, force: true });
		rmSync(pollutedPkg, { recursive: true, force: true });
	}
}

// Update without a prior install throws
{
	const parentDir = mkdtempSync(join(tmpdir(), "heli-cli-update-"));
	try {
		assert.throws(() => update(sourceHarnessDir, parentDir), /does not exist/);
	} finally {
		rmSync(parentDir, { recursive: true, force: true });
	}
}

console.log("cli update smoke ok");
