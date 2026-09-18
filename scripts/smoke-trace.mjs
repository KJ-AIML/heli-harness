#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const heli = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "heli.mjs");
const parent = mkdtempSync(join(tmpdir(), "heli-trace-"));
function run(args, status = 0) {
	const result = spawnSync(process.execPath, [heli, ...args], { encoding: "utf8" });
	assert.equal(result.status, status, `${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
	return result.stdout;
}
try {
	run(["install", parent]);
	const taskDir = join(parent, ".heli-harness", "tasks", "trace-t1");
	mkdirSync(taskDir, { recursive: true });
	writeFileSync(join(taskDir, "events.jsonl"), `${JSON.stringify({ eventId: "evt_test", type: "task.created", taskId: "trace-t1", at: "2026-09-15T00:00:00.000Z" })}\n`);
	const trace = JSON.parse(run(["trace", "show", "--task", "trace-t1", parent, "--json"]));
	assert.equal(trace.protocolVersion, 1);
	assert.equal(trace.command, "trace.show");
	assert.equal(trace.data.taskId, "trace-t1");
	assert.equal(trace.data.events.length, 1);
	assert.equal(trace.data.events[0].eventSchemaVersion, 1);
	assert.equal(trace.data.completeness.guardDecisionPersistence, "denials-only");
	assert.equal(trace.data.completeness.allowsPersisted, false);
	console.log("trace smoke ok");
} finally {
	rmSync(parent, { recursive: true, force: true });
}
