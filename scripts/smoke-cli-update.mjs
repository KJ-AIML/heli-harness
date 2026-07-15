#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
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

// --reset-state replaces state/ from the source checkout
{
	const parentDir = mkdtempSync(join(tmpdir(), "heli-cli-update-"));
	try {
		install(sourceHarnessDir, parentDir);
		const stateDir = join(parentDir, ".heli-harness", "state");
		mkdirSync(stateDir, { recursive: true });
		writeFileSync(join(stateDir, "current-task.md"), "# Current Task\n\nTask: stale local task\n");

		const result = update(sourceHarnessDir, parentDir, { resetState: true });

		const updatedTaskText = existsSync(join(stateDir, "current-task.md"))
			? readFileSync(join(stateDir, "current-task.md"), "utf8")
			: "";
		assert.ok(!updatedTaskText.includes("stale local task"), "resetState must replace state/ from source");
		assert.deepEqual(result.preserveDirs, ["profiles", "workspace", "policies", "safety"]);
	} finally {
		rmSync(parentDir, { recursive: true, force: true });
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
