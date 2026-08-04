#!/usr/bin/env node
/**
 * Task lifecycle smoke through the real CLI entry:
 * zero-task bootstrap target set → create → --reuse idempotency →
 * duplicate rejected without flag → claim → complete (status + lease + md sync)
 * → unbound target set with tasks present still refused.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { install } from "../lib/cli/install.mjs";

const root = process.cwd();
const parent = mkdtempSync(join(tmpdir(), "heli-cli-task-"));
const heli = join(root, "bin", "heli.mjs");
const SESSION = "heli-ses-smoke-cli-task";

function run(args, { env = {}, expectFail = false } = {}) {
	const result = spawnSync("node", [heli, ...args, parent], {
		encoding: "utf8",
		env: { ...process.env, ...env },
	});
	const out = `${result.stdout}\n${result.stderr}`;
	if (expectFail) {
		assert.notEqual(result.status, 0, `expected failure: heli ${args.join(" ")}\n${out}`);
	} else {
		assert.equal(result.status, 0, `heli ${args.join(" ")} failed:\n${out}`);
	}
	return out;
}

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

try {
	install(join(root, ".heli-harness"), parent);
	const harness = join(parent, ".heli-harness");
	mkdirSync(join(parent, "repos", "demo"), { recursive: true });
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

	// Zero-task bootstrap: target set succeeds without a task binding
	const bootstrapOut = run(["target", "set", "demo"]);
	assert.match(bootstrapOut, /bootstrap/i, "zero-task target set should report bootstrap mode");
	assert.equal(readJson(join(harness, "workspace", "target.json")).targetRepo, "demo");

	// Create, then idempotent --reuse, then hard failure without it
	run(["task", "create", "t1", "--work-item", "w1", "--repo", "demo"]);
	const reuseOut = run(["task", "create", "t1", "--work-item", "w1", "--reuse"]);
	assert.match(reuseOut, /reusing/i, "--reuse should report existing task");
	run(["task", "create", "t1", "--work-item", "w1"], { expectFail: true });

	// With a task present, unbound target set is still refused
	run(["target", "set", "demo"], { expectFail: true });

	// Workspace-embedded CLI: a fresh install must be runnable offline
	const embedded = spawnSync("node", [join(harness, "heli.mjs"), "status", parent], { encoding: "utf8" });
	assert.equal(embedded.status, 0, `embedded CLI failed:\n${embedded.stdout}\n${embedded.stderr}`);
	assert.match(embedded.stdout, /Heli-Harness version/, "embedded CLI should print status");

	// Claim write, then complete: status flips, md syncs, lease releases
	run(["task", "claim", "t1", "--mode", "write"], { env: { HELI_SESSION_ID: SESSION } });
	const leaseDir = join(harness, "locks", "tasks", "t1.write.lock");
	assert.ok(existsSync(leaseDir), "write lease should exist after claim");

	// Own expired lease self-renews on re-claim (no takeover ceremony)
	const leasePath = join(leaseDir, "lease.json");
	const lease = readJson(leasePath);
	lease.expiresAt = new Date(Date.now() - 60_000).toISOString();
	writeFileSync(leasePath, JSON.stringify(lease, null, 2));
	const renewOut = run(["task", "claim", "t1", "--mode", "write"], { env: { HELI_SESSION_ID: SESSION } });
	assert.match(renewOut, /Claimed write lease/, "own stale lease should self-renew on claim");
	assert.ok(
		new Date(readJson(leasePath).expiresAt).getTime() > Date.now(),
		"lease expiry should be extended after self-renew",
	);

	// A different session must still be refused takeover-free
	run(["task", "claim", "t1", "--mode", "write"], { env: { HELI_SESSION_ID: "heli-ses-other" }, expectFail: true });

	// Provenance: timeline from events.jsonl
	const provOut = run(["task", "provenance", "t1"], { env: { HELI_SESSION_ID: SESSION } });
	assert.match(provOut, /task_created/, "provenance should list task_created event");
	assert.match(provOut, /lease:/, "provenance should report lease state");

	const completeOut = run(["task", "complete", "t1"], { env: { HELI_SESSION_ID: SESSION } });
	assert.match(completeOut, /marked complete/, "complete should confirm");
	assert.match(completeOut, /Released write lease/, "complete should release own lease");
	assert.equal(readJson(join(harness, "tasks", "t1", "task.json")).status, "complete");
	assert.match(
		readFileSync(join(harness, "tasks", "t1", "current-task.md"), "utf8"),
		/^Current status: complete$/m,
		"current-task.md status line should sync",
	);
	assert.ok(!existsSync(leaseDir), "lease dir should be gone after complete");

	console.log("cli task smoke ok");
} finally {
	rmSync(parent, { recursive: true, force: true });
}
