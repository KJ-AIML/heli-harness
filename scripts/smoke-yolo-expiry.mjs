#!/usr/bin/env node
/**
 * YOLO ends on its own, and a session knows it is on.
 *
 * `heli yolo on` without `--hours` stayed on for good, and nothing told the agent or the user afterwards that the session
 * ran unguarded (a linked workspace was found with YOLO on and no expiry, the push and `.env` blocks its owner relies on
 * silently off). Now `heli yolo on` expires after DEFAULT_YOLO_HOURS unless `--hours N` or `--no-expiry` says otherwise,
 * and SessionStart says when YOLO is on: what it lifts, what it never lifts, and until when.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { linkProject } from "../lib/cli/link.mjs";
import { setupHeli } from "../lib/cli/setup.mjs";
import { DEFAULT_YOLO_HOURS, runYolo } from "../lib/cli/yolo.mjs";
import { pathsFor } from "../lib/concurrency/paths.mjs";
import { buildConcurrentSessionContext, resolveExecutionContext } from "../.heli-harness/adapters/shared/concurrency/resolve.mjs";
import { resolveYolo } from "../.heli-harness/adapters/shared/concurrency/yolo-scope.mjs";
import { scrubHeliProcessEnv } from "./lib/hermetic-env.mjs";

scrubHeliProcessEnv();
const startedIn = process.cwd();
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "heli-yolo-expiry-")));
const project = join(scratch, "project");
const env = { ...process.env, HELI_CONFIG_DIR: join(scratch, "config"), HELI_DATA_DIR: join(scratch, "data") };
process.env.HELI_CONFIG_DIR = env.HELI_CONFIG_DIR;
process.env.HELI_DATA_DIR = env.HELI_DATA_DIR;
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
const human = { terminal: { stdin: true, stdout: true } };
const quiet = (fn) => {
	const log = console.log;
	console.log = () => {};
	try {
		return fn();
	} finally {
		console.log = log;
	}
};

mkdirSync(project, { recursive: true });
setupHeli({ env });
linkProject(startedIn, project, { env });
const yoloFile = pathsFor(project, { env }).legacyYoloPath;
const readFile = () => JSON.parse(readFileSync(yoloFile, "utf8"));
const hoursLeft = () => (Date.parse(readFile().expiresAt) - Date.now()) / 3600_000;
const sessionContext = (extraEnv = {}) =>
	buildConcurrentSessionContext(resolveExecutionContext({ cwd: project, environment: { ...env, ...extraEnv }, host: "test" }), { env: { ...env, ...extraEnv } });

// 1. The expiry.
assert.equal(DEFAULT_YOLO_HOURS, 8);
quiet(() => runYolo(["on", project], human));
assert.ok(Math.abs(hoursLeft() - DEFAULT_YOLO_HOURS) < 0.05, `default expiry: ${readFile().expiresAt}`);
quiet(() => runYolo(["on", project, "--hours", "2"], human));
assert.ok(Math.abs(hoursLeft() - 2) < 0.05, `--hours 2: ${readFile().expiresAt}`);
quiet(() => runYolo(["on", project, "--no-expiry"], human));
assert.equal(readFile().expiresAt, undefined, "--no-expiry keeps it on until heli yolo off");
assert.match(readFile().note, /T5 approvals/, "the note says what YOLO lifts");

// 2. SessionStart says it is on, and until when.
quiet(() => runYolo(["on", project, "--hours", "3"], human));
let context = sessionContext();
assert.match(context, /WARNING: Heli YOLO is ON \(until \d{4}-\d\d-\d\dT/);
assert.match(context, /push gate, \.env writes, T5 approvals/);
assert.match(context, /T6 hard denies, Heli's self-protection/);
quiet(() => runYolo(["on", project, "--no-expiry"], human));
assert.match(sessionContext(), /WARNING: Heli YOLO is ON \(with NO expiry\)/);
quiet(() => runYolo(["off", project], human));
assert.doesNotMatch(sessionContext(), /YOLO is ON/);
assert.match(sessionContext({ HELI_YOLO: "1" }), /WARNING: Heli YOLO is ON \(from env:HELI_YOLO\)/);

// 3. An expired switch is off, and says nothing.
writeFileSync(yoloFile, `${JSON.stringify({ enabled: true, enabledAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-01T08:00:00.000Z" })}\n`);
assert.equal(resolveYolo({ workspaceRoot: project, cwd: project, env }).active, false);
assert.doesNotMatch(sessionContext(), /YOLO is ON/);

console.log("yolo expiry smoke ok");
