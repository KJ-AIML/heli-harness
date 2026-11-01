#!/usr/bin/env node
/**
 * The Stop hook keeps an agent working its approved run until it says done or blocked.
 *
 * An agent with an approved plan still ended its turn whenever it felt like asking something, and the work waited for the
 * user. Claude Code runs the plugin's Stop hook when the agent is about to stop: for the session an active approved run is
 * bound to, it answers `{"decision":"block","reason":...}` (the reason becomes the agent's next instruction: continue, end
 * with `heli run done`, or `heli run blocked "<what you need>"`). Any other session, a blocked, done, stopped or expired
 * run, keep-going off, or MAX_RUN_CONTINUATIONS used up lets the agent stop, and so does any error (it fails open).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { linkProject } from "../lib/cli/link.mjs";
import { runRun } from "../lib/cli/run.mjs";
import { setupHeli } from "../lib/cli/setup.mjs";
import { currentRun, MAX_RUN_CONTINUATIONS, runStoreDir } from "../lib/concurrency/runs.mjs";
import { resolveExecutionContext } from "../.heli-harness/adapters/shared/concurrency/resolve.mjs";
import { scrubHeliProcessEnv } from "./lib/hermetic-env.mjs";

scrubHeliProcessEnv();
const root = process.cwd();
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "heli-run-stop-hook-")));
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
linkProject(root, project, { env });
const sessionFor = (hostSessionId) => resolveExecutionContext({ cwd: project, environment: env, hookPayload: { session_id: hostSessionId }, host: "claude", createIfMissing: true }).sessionId;
sessionFor("claude-other-window");
const agent = sessionFor("claude-agent");
const plan = join(project, "plan.md");
writeFileSync(plan, "# Plan\n\n1. refactor\n2. test\n\n```heli-run\nkeep-going: yes\nhours: 2\n```\n");

const hookScript = join(root, ".heli-harness", "adapters", "claude-plugin", "hooks", "heli-stop.mjs");
const stopHook = (payload, input = JSON.stringify(payload)) => {
	const result = spawnSync(process.execPath, [hookScript], { cwd: project, input, encoding: "utf8", env });
	assert.equal(result.status, 0, `the Stop hook exits 0: ${result.stderr}`);
	return result.stdout.trim() ? JSON.parse(result.stdout) : null;
};
const stopping = (hostSessionId) => stopHook({ session_id: hostSessionId, cwd: project, hook_event_name: "Stop", stop_hook_active: false });

// No run: nobody is kept going.
assert.equal(stopping("claude-agent"), null);

// An active run keeps its own session going, and only it.
const { run } = quiet(() => runRun(["approve", plan, "--yes"], human));
assert.equal(run.sessionId, agent);
const kept = stopping("claude-agent");
assert.equal(kept.decision, "block");
assert.match(kept.reason, new RegExp(`approved run ${run.runId} is still active`));
assert.match(kept.reason, /continue with the next step of the plan/);
assert.match(kept.reason, /heli run done/);
assert.match(kept.reason, /heli run blocked "<what you need from them>"/);
assert.equal(currentRun(project, { env }).continuations, 1);
assert.equal(stopping("claude-other-window"), null, "another window of the same workspace stops normally");
assert.equal(stopHook({ session_id: "claude-agent", cwd: join(scratch, "elsewhere") }), null, "outside any workspace");

// The agent says it needs the user: it may stop; resumed, it is kept going again.
quiet(() => runRun(["blocked", "which database for staging?", project]));
assert.equal(stopping("claude-agent"), null);
quiet(() => runRun(["resume", project]));
assert.equal(stopping("claude-agent").decision, "block");

// A loop the agent cannot get out of ends: after MAX_RUN_CONTINUATIONS the hook lets it stop.
const recordPath = join(runStoreDir(project, { env }), `${run.runId}.json`);
writeFileSync(recordPath, JSON.stringify({ ...JSON.parse(readFileSync(recordPath, "utf8")), continuations: MAX_RUN_CONTINUATIONS }));
assert.equal(stopping("claude-agent"), null);
writeFileSync(recordPath, JSON.stringify({ ...JSON.parse(readFileSync(recordPath, "utf8")), continuations: 0 }));

// Done: it stops.
quiet(() => runRun(["done", project]));
assert.equal(stopping("claude-agent"), null);

// keep-going off approves the work but keeps nobody going.
quiet(() => runRun(["approve", plan, "--yes", "--no-keep-going"], human));
assert.equal(stopping("claude-agent"), null);
quiet(() => runRun(["stop", project]));

// It fails open: a payload it cannot read lets the agent stop.
assert.equal(stopHook(null, "{not json"), null);
assert.equal(stopHook(null, ""), null);

// Claude's plugin registers it.
const hooks = JSON.parse(readFileSync(join(root, ".heli-harness", "adapters", "claude-plugin", "hooks", "hooks.json"), "utf8"));
assert.match(hooks.hooks.Stop[0].hooks[0].command, /heli-stop\.mjs/);

console.log("run stop hook smoke ok");
