#!/usr/bin/env node
/**
 * Atomic writes must survive transient Windows sharing violations without ever
 * deleting the target first (the old delete-then-rename fallback could lose
 * state if the second rename also failed).
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renameWithRetry, writeJsonAtomic } from "../lib/concurrency/fs-atomic.mjs";

const dir = mkdtempSync(join(tmpdir(), "heli-fs-atomic-"));

function sharingViolation(code) {
	const error = new Error(`${code}: simulated sharing violation`);
	error.code = code;
	return error;
}

try {
	const target = join(dir, "state.json");

	// Transient EPERM/EBUSY/EACCES are retried; the target stays intact meanwhile.
	for (const code of ["EPERM", "EBUSY", "EACCES"]) {
		writeFileSync(target, "old\n");
		const tmp = join(dir, `.${code}.tmp`);
		writeFileSync(tmp, "new\n");
		let calls = 0;
		renameWithRetry(tmp, target, {
			rename(from, to) {
				calls += 1;
				assert.equal(readFileSync(to, "utf8"), "old\n", "target must stay intact until the rename lands");
				if (calls < 3) throw sharingViolation(code);
				renameSync(from, to);
			},
		});
		assert.equal(calls, 3, `${code} must be retried`);
		assert.equal(readFileSync(target, "utf8"), "new\n");
	}

	// Persistent failure: bounded attempts, error rethrown, old content kept, temp removed.
	writeFileSync(target, "old\n");
	const stuckTmp = join(dir, ".stuck.tmp");
	writeFileSync(stuckTmp, "new\n");
	let attempts = 0;
	assert.throws(
		() => renameWithRetry(stuckTmp, target, {
			attempts: 4,
			rename() {
				attempts += 1;
				throw sharingViolation("EBUSY");
			},
		}),
		(error) => error.code === "EBUSY",
	);
	assert.equal(attempts, 4);
	assert.equal(readFileSync(target, "utf8"), "old\n", "a failed write must never lose the previous content");
	assert.equal(existsSync(stuckTmp), false, "temp file is cleaned up after the final failure");

	// Non-transient errors are not retried.
	const otherTmp = join(dir, ".other.tmp");
	writeFileSync(otherTmp, "x");
	let otherCalls = 0;
	assert.throws(
		() => renameWithRetry(otherTmp, target, {
			rename() {
				otherCalls += 1;
				throw sharingViolation("EXDEV");
			},
		}),
		(error) => error.code === "EXDEV",
	);
	assert.equal(otherCalls, 1);

	// Real writes over an existing file still work and leave no temp files behind.
	writeJsonAtomic(target, { ok: 1 });
	writeJsonAtomic(target, { ok: 2 });
	assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), { ok: 2 });
	assert.deepEqual(readdirSync(dir).filter((name) => name.endsWith(".tmp")), []);
	console.log("fs-atomic smoke ok");
} finally {
	rmSync(dir, { recursive: true, force: true });
}
