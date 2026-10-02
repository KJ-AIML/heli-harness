#!/usr/bin/env node
/**
 * Protocol v1 machine-output smoke through the real package CLI and the
 * workspace-embedded offline CLI. This is intentionally black-box: adapters
 * must be able to depend on the JSON envelope without parsing human prose.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { install } from "../lib/cli/install.mjs";

const root = process.cwd();
const workspace = mkdtempSync(join(tmpdir(), "heli-machine-cli-"));
const packageCli = join(root, "bin", "heli.mjs");

function invoke(cli, args, { env = {}, expectStatus = 0 } = {}) {
	const result = spawnSync("node", [cli, ...args], {
		encoding: "utf8",
		env: { ...process.env, ...env },
	});
	assert.equal(
		result.status,
		expectStatus,
		`heli ${args.join(" ")} exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
	);
	let parsed;
	try {
		parsed = JSON.parse(result.stdout);
	} catch (error) {
		assert.fail(`expected JSON stdout for heli ${args.join(" ")}: ${error.message}\n${result.stdout}`);
	}
	assert.equal(parsed.protocolVersion, 1);
	assert.equal(Array.isArray(parsed.warnings), true);
	assert.equal(Array.isArray(parsed.errors), true);
	return parsed;
}

try {
	install(join(root, ".heli-harness"), workspace);
	const harness = join(workspace, ".heli-harness");
	mkdirSync(join(workspace, "repos", "demo"), { recursive: true });
	writeFileSync(
		join(harness, "workspace", "index.json"),
		JSON.stringify(
			{
				schemaVersion: 1,
				workspaceRoot: ".",
				repos: [{ name: "demo", path: "repos/demo", gitRoot: "repos/demo", profile: "", defaultTarget: true }],
			},
			null,
			2,
		),
	);

	const target = invoke(packageCli, ["target", "show", "--json", workspace]);
	assert.equal(target.command, "target.show");
	assert.equal(target.ok, true);

	const created = invoke(packageCli, ["task", "create", "machine-smoke", "--repo", "demo", "--json", workspace]);
	assert.equal(created.command, "task.create");
	assert.equal(created.ok, true);
	assert.equal(created.data.task.taskId, "machine-smoke");
	assert.equal(created.data.reused, false, "new task creation must not be reported as reuse");

	const reusableCreated = invoke(packageCli, ["task", "create", "machine-reuse", "--repo", "demo", "--reuse", "--json", workspace]);
	assert.equal(reusableCreated.data.reused, false, "--reuse permits reuse but must not claim it happened on first creation");
	const reusableExisting = invoke(packageCli, ["task", "create", "machine-reuse", "--repo", "demo", "--reuse", "--json", workspace]);
	assert.equal(reusableExisting.data.reused, true, "existing task returned under --reuse must be reported as reused");

	const listed = invoke(packageCli, ["task", "list", "--json", workspace]);
	assert.equal(listed.command, "task.list");
	assert.equal(listed.data.tasks.some((task) => task.taskId === "machine-smoke"), true);

	const shown = invoke(packageCli, ["task", "show", "machine-smoke", "--json", workspace]);
	assert.equal(shown.command, "task.show");
	assert.equal(shown.data.task.taskId, "machine-smoke");
	assert.equal(shown.data.task.status, "active");
	assert.equal(shown.data.task.coordinationState, "ready");
	assert.deepEqual(shown.data.task.dependencies, []);
	assert.deepEqual(shown.data.task.blockedOn, []);

	// Layer 2 CLI surfaces: dependency declaration is idempotent and machine
	// inspection exposes coordination independently of execution status.
	const producer = invoke(packageCli, ["task", "create", "machine-producer", "--repo", "demo", "--json", workspace]);
	assert.equal(producer.ok, true);
	const dependency = invoke(packageCli, ["task", "depends", "machine-smoke", "--on", "machine-producer", "--artifact", "machine-contract", "--json", workspace]);
	assert.equal(dependency.command, "task.depends");
	assert.equal(dependency.data.created, true);
	assert.equal(dependency.data.coordination.coordinationState, "blocked");
	const duplicateDependency = invoke(packageCli, ["task", "depends", "machine-smoke", "--on", "machine-producer", "--artifact", "machine-contract", "--json", workspace]);
	assert.equal(duplicateDependency.data.created, false);
	const blocked = invoke(packageCli, ["task", "show", "machine-smoke", "--json", workspace]);
	assert.equal(blocked.data.task.status, "active", "dependency readiness must not alter execution status");
	assert.equal(blocked.data.task.coordinationState, "blocked");
	assert.deepEqual(blocked.data.task.blockedOn, ["machine-producer/machine-contract"]);
	const published = invoke(packageCli, ["handoff", "publish", "--task", "machine-producer", "--name", "machine-contract", "--ref", "abc1234", "--path", "docs/contract.md", "--json", workspace]);
	assert.equal(published.command, "handoff.publish");
	assert.equal(published.data.created, true);
	const replayedPublish = invoke(packageCli, ["handoff", "publish", "--task", "machine-producer", "--name", "machine-contract", "--ref", "abc1234", "--path", "docs/contract.md", "--json", workspace]);
	assert.equal(replayedPublish.data.created, false);
	const ready = invoke(packageCli, ["task", "show", "machine-smoke", "--json", workspace]);
	assert.equal(ready.data.task.status, "active");
	assert.equal(ready.data.task.coordinationState, "ready");
	assert.equal(ready.data.task.dependencies[0].state, "satisfied");
	assert.equal(ready.data.task.dependencies[0].ref, "abc1234");
	assert.equal(ready.data.task.dependencies[0].path, "docs/contract.md");
	const handoffShown = invoke(packageCli, ["handoff", "show", "machine-producer/machine-contract", "--json", workspace]);
	assert.equal(handoffShown.command, "handoff.show");
	assert.equal(handoffShown.data.publication.ref, "abc1234");
	const handoffListed = invoke(packageCli, ["handoff", "list", "--json", workspace]);
	assert.equal(handoffListed.data.handoffs.length, 1);

	// Machine lifecycle uses the same canonical transitions as human CLI.
	// Takeover may mint/attach a session exactly like the human surface.
	const takeover = invoke(packageCli, ["task", "takeover", "machine-smoke", "--confirm", "--json", workspace]);
	assert.equal(takeover.command, "task.takeover");
	assert.equal(takeover.data.session.taskId, "machine-smoke");
	assert.equal(takeover.data.lease.sessionId, takeover.data.sessionId);
	const completed = invoke(
		packageCli,
		["task", "complete", "machine-smoke", "--session", takeover.data.sessionId, "--json", workspace],
	);
	assert.equal(completed.command, "task.complete");
	assert.equal(completed.data.task.status, "complete");
	assert.ok(completed.data.releasedLease, "completion by writer should release the active lease");

	const diagnosis = invoke(packageCli, ["diagnosis", "show", "machine-smoke", "--json", workspace]);
	assert.equal(diagnosis.command, "diagnosis.show");
	assert.equal(diagnosis.data.taskId, "machine-smoke");

	const conflicts = invoke(packageCli, ["conflicts", "--json", workspace]);
	assert.equal(conflicts.command, "conflicts");
	assert.equal(Array.isArray(conflicts.data.conflicts), true);

	// Existing diagnosis payload syntax remains human/legacy compatible: a JSON
	// object immediately after --json is input, not a request for protocol mode.
	const legacyPayload = {
		symptom: "machine CLI compatibility fixture failed",
		closestProvenBoundary: "legacy --json payload reached diagnosis init",
		responsibleSubsystem: "cli",
		riskTier: "S1",
	};
	const legacy = spawnSync(
		"node",
		[packageCli, "diagnosis", "init", "machine-smoke", "--json", JSON.stringify(legacyPayload), workspace],
		{ encoding: "utf8" },
	);
	assert.equal(legacy.status, 0, `legacy diagnosis payload broke:\n${legacy.stdout}\n${legacy.stderr}`);
	assert.doesNotThrow(() => JSON.parse(legacy.stdout), "legacy diagnosis command should still print its diagnosis object");

	// The installed workspace CLI must expose the same protocol without network
	// access or the package root being on PATH.
	const embeddedCli = join(harness, "heli.mjs");
	const embedded = invoke(embeddedCli, ["task", "show", "machine-smoke", "--json", workspace]);
	assert.equal(embedded.command, "task.show");
	assert.equal(embedded.data.task.taskId, "machine-smoke");

	// Sanity-check that the authoritative task file agrees with the projection.
	const task = JSON.parse(readFileSync(join(harness, "tasks", "machine-smoke", "task.json"), "utf8"));
	assert.equal(task.taskId, "machine-smoke");
	assert.equal(task.status, "complete", "the earlier explicit completion remains the execution state");
	assert.equal(task.coordinationState, undefined, "coordination must not be persisted over execution lifecycle status");

	console.log("machine cli smoke ok");
} finally {
	rmSync(workspace, { recursive: true, force: true });
}
