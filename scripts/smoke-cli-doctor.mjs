#!/usr/bin/env node
/**
 * Workspace health smoke through the real CLI entry:
 * healthy fresh install exits 0 → malformed schema.json fails closed (exit 1)
 * → missing registered repo path warns without failing → expired write lease on
 * a claimed task is reported as a warning with the self-renew hint.
 *
 * Every assertion runs against a mkdtemp workspace created by `heli install`
 * so nothing here can touch this repo's own dogfooded .heli-harness state.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const heli = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "heli.mjs");
const parent = mkdtempSync(join(tmpdir(), "heli-cli-doctor-"));
const harness = join(parent, ".heli-harness");
const schemaPath = join(harness, "workspace", "schema.json");
const indexPath = join(harness, "workspace", "index.json");

function run(args, { env = {}, expectStatus = 0 } = {}) {
	const result = spawnSync(process.execPath, [heli, ...args], {
		encoding: "utf8",
		env: { ...process.env, ...env },
	});
	const out = `${result.stdout}\n${result.stderr}`;
	assert.equal(
		result.status,
		expectStatus,
		`heli ${args.join(" ")} exited ${result.status}, expected ${expectStatus}:\n${out}`,
	);
	return { stdout: result.stdout, out };
}

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

try {
	run(["install", parent]);

	// (a) A fresh install is healthy: no failures, summary line printed.
	const healthy = run(["doctor", parent]);
	assert.match(
		healthy.stdout,
		/^doctor: \d+ ok, \d+ warnings, 0 failures$/m,
		"fresh install doctor should print a zero-failure summary line",
	);
	assert.match(healthy.stdout, /workspace mode: concurrent/, "fresh install should report concurrent mode");
	assert.match(healthy.stdout, /embedded CLI present/, "fresh install ships the embedded CLI");
	assert.match(healthy.stdout, /cloud sync: local-only/, "fresh install is local-only");
	assert.match(
		healthy.stdout,
		/no target selected/,
		"fresh install has no target and doctor should warn (not fail) about it",
	);
	assert.match(
		healthy.stdout,
		/not verifiable from files/,
		"doctor must not claim host plugin activation it cannot see",
	);

	// (b) Malformed schema.json is a FAIL: enforcement fails closed to concurrent.
	const goodSchema = readFileSync(schemaPath, "utf8");
	writeFileSync(schemaPath, "{ this is not json", "utf8");
	const broken = run(["doctor", parent], { expectStatus: 1 });
	assert.match(broken.stdout, /schema\.json malformed/, "malformed schema should be flagged by name");
	assert.match(broken.stdout, /fails closed to concurrent/, "malformed schema must explain fail-closed behavior");
	assert.match(broken.stdout, /^doctor: \d+ ok, \d+ warnings, [1-9]\d* failures$/m, "failures must be counted");
	writeFileSync(schemaPath, goodSchema, "utf8");
	run(["doctor", parent]);

	// (c) A registered repo whose path is gone warns, but does not fail the run.
	mkdirSync(join(parent, "repos", "demo"), { recursive: true });
	writeFileSync(
		indexPath,
		`${JSON.stringify(
			{
				schemaVersion: 1,
				workspaceRoot: ".",
				repos: [
					{ name: "demo", path: "repos/demo", gitRoot: "repos/demo", profile: "", defaultTarget: true },
					{ name: "ghost", path: "repos/ghost", gitRoot: "repos/ghost", profile: "" },
				],
			},
			null,
			2,
		)}\n`,
		"utf8",
	);
	const ghost = run(["doctor", parent]);
	assert.match(ghost.stdout, /registered repo path missing on disk: ghost/, "missing repo path should warn by name");
	assert.match(ghost.stdout, /registered repos: 2/, "index repos should be counted");
	assert.match(ghost.stdout, /^doctor: \d+ ok, [1-9]\d* warnings, 0 failures$/m, "missing repo path must not fail");

	// (d) Expired write lease on a claimed task → warning with the self-renew hint.
	run(["task", "create", "doc-t1", "--work-item", "doc-w1", "--repo", "demo", parent]);
	const claim = run(["task", "claim", "doc-t1", "--mode", "write", parent]);
	const sessionId = /^\s*session:\s*(\S+)$/m.exec(claim.stdout)?.[1];
	assert.ok(sessionId, `claim output should print the session id:\n${claim.stdout}`);

	const leasePath = join(harness, "locks", "tasks", "doc-t1.write.lock", "lease.json");
	assert.ok(existsSync(leasePath), "write lease should exist after claim");
	const active = run(["doctor", parent], { env: { HELI_SESSION_ID: sessionId } });
	assert.match(active.stdout, /task doc-t1: active write lease/, "live lease should read as active");

	const lease = readJson(leasePath);
	lease.expiresAt = new Date(Date.now() - 60_000).toISOString();
	writeFileSync(leasePath, `${JSON.stringify(lease, null, 2)}\n`, "utf8");

	const stale = run(["doctor", parent], { env: { HELI_SESSION_ID: sessionId } });
	assert.match(stale.stdout, /task doc-t1: write lease expired/, "expired lease should be reported");
	assert.match(stale.stdout, /own session self-renews on claim/, "expired lease warning must carry the renew hint");
	assert.match(stale.stdout, /^doctor: \d+ ok, [1-9]\d* warnings, 0 failures$/m, "a stale lease warns, never fails");

	// Orphan lease: the session record disappears but the lease survives.
	rmSync(join(harness, "sessions", `${sessionId}.json`), { force: true });
	const orphan = run(["doctor", parent]);
	assert.match(orphan.stdout, /task doc-t1: orphan lease/, "lease pointing at a vanished session is an orphan");

	// The embedded workspace CLI must expose doctor too (offline, no npx).
	const embedded = spawnSync(process.execPath, [join(harness, "heli.mjs"), "doctor", parent], { encoding: "utf8" });
	assert.match(embedded.stdout, /^doctor: \d+ ok, /m, "embedded CLI should run doctor offline");

	console.log("cli doctor smoke ok");
} finally {
	rmSync(parent, { recursive: true, force: true });
}
