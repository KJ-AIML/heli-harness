#!/usr/bin/env node
/** Prove a 0.7.3-compatible installed fixture upgrades without losing overlays or runtime state. */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { install } from "../lib/cli/install.mjs";
import { update } from "../lib/cli/update.mjs";

const sourceRoot = process.cwd();
const expectedVersion = JSON.parse(readFileSync(join(sourceRoot, "package.json"), "utf8")).version;
const expectedCommandRulesVersion = JSON.parse(
	readFileSync(join(sourceRoot, ".heli-harness", "safety", "command-rules.json"), "utf8"),
).defaultsVersion;
const parent = mkdtempSync(join(tmpdir(), "heli-upgrade-0-7-3-"));

function write(path, value) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, value, "utf8");
}

function read(path) {
	return readFileSync(path, "utf8");
}

try {
	install(join(sourceRoot, ".heli-harness"), parent);
	const harness = join(parent, ".heli-harness");

	// Downgrade only the installed distribution metadata and remove vNext assets
	// to make this an explicit 0.7.3-compatible fixture, not a same-version copy.
	const oldManifest = JSON.parse(read(join(harness, "manifest.json")));
	oldManifest.version = "0.7.3";
	write(join(harness, "manifest.json"), `${JSON.stringify(oldManifest, null, 2)}\n`);
	rmSync(join(harness, "cli", "diagnosis.mjs"), { force: true });
	rmSync(join(harness, "adapters", "shared", "concurrency", "diagnosis.mjs"), { force: true });
	rmSync(join(harness, "skills", "evidence-gates"), { recursive: true, force: true });
	rmSync(join(harness, "safety", "expensive-actions.json"), { force: true });
	write(
		join(harness, "safety", "command-rules.json"),
		`${JSON.stringify({ version: 1, rules: [{ id: "local-custom", match: "local-custom", tier: "T6", reason: "local overlay" }] }, null, 2)}\n`,
	);

	const preserved = {
		profile: "# Legacy App\n\nLocal profile must survive a 0.7.3 upgrade.\n",
		index: `${JSON.stringify({ schemaVersion: 1, repos: [{ name: "legacy-app", path: "legacy-app" }] }, null, 2)}\n`,
		target: `${JSON.stringify({ schemaVersion: 1, targetRepo: "legacy-app", reason: "local target" }, null, 2)}\n`,
		policy: "# Local policy\n\nPreserve this policy.\n",
		state: "# Legacy current task\n\nPreserve this runtime state.\n",
		task: "# Legacy task\n\nCurrent status: active\n",
		session: `${JSON.stringify({ sessionId: "legacy-session", status: "active" }, null, 2)}\n`,
		binding: `${JSON.stringify({ binding: "legacy-binding" }, null, 2)}\n`,
		lock: `${JSON.stringify({ lease: "legacy-lock" }, null, 2)}\n`,
	};
	write(join(harness, "profiles", "legacy-app.md"), preserved.profile);
	write(join(harness, "workspace", "index.json"), preserved.index);
	write(join(harness, "workspace", "target.json"), preserved.target);
	write(join(harness, "policies", "engineering.md"), preserved.policy);
	write(join(harness, "state", "current-task.md"), preserved.state);
	write(join(harness, "tasks", "legacy-task", "current-task.md"), preserved.task);
	write(join(harness, "sessions", "legacy-session.json"), preserved.session);
	write(join(harness, "bindings", "worktrees", "legacy-binding.json"), preserved.binding);
	write(join(harness, "locks", "tasks", "legacy-task.write.lock", "lease.json"), preserved.lock);

	update(join(sourceRoot, ".heli-harness"), parent);

	const upgradedManifest = JSON.parse(read(join(harness, "manifest.json")));
	assert.equal(upgradedManifest.version, expectedVersion);
	assert.ok(existsSync(join(harness, "cli", "diagnosis.mjs")));
	assert.ok(existsSync(join(harness, "adapters", "shared", "concurrency", "diagnosis.mjs")));
	assert.ok(existsSync(join(harness, "skills", "evidence-gates", "SKILL.md")));
	assert.ok(existsSync(join(harness, "safety", "expensive-actions.json")));

	const commandRules = JSON.parse(read(join(harness, "safety", "command-rules.json")));
	assert.equal(commandRules.defaultsVersion, expectedCommandRulesVersion);
	assert.ok(commandRules.rules.some((rule) => rule.id === "local-custom"));
	assert.ok(commandRules.rules.some((rule) => rule.id === "heli-cloud-push"));
	const expensiveActions = JSON.parse(read(join(harness, "safety", "expensive-actions.json")));
	assert.ok(expensiveActions.actions.some((action) => action.id === "provider-backed-generation"));

	assert.equal(read(join(harness, "profiles", "legacy-app.md")), preserved.profile);
	assert.equal(read(join(harness, "workspace", "index.json")), preserved.index);
	assert.equal(read(join(harness, "workspace", "target.json")), preserved.target);
	assert.equal(read(join(harness, "policies", "engineering.md")), preserved.policy);
	assert.equal(read(join(harness, "state", "current-task.md")), preserved.state);
	assert.equal(read(join(harness, "tasks", "legacy-task", "current-task.md")), preserved.task);
	assert.equal(read(join(harness, "sessions", "legacy-session.json")), preserved.session);
	assert.equal(read(join(harness, "bindings", "worktrees", "legacy-binding.json")), preserved.binding);
	assert.equal(read(join(harness, "locks", "tasks", "legacy-task.write.lock", "lease.json")), preserved.lock);

	console.log("smoke-vnext-upgrade-0.7.3: upgrade, overlay preservation, and safety migration passed");
} finally {
	rmSync(parent, { recursive: true, force: true });
}
