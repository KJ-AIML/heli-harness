#!/usr/bin/env node
/**
 * The grant a deny message asks for is the grant the hook looks for, in a workspace that holds other git repositories.
 *
 * A push from `repos/app` (its own git repository inside a linked project that is not one) is checked against the
 * worktree of `repos/app`, but `heli grant issue` bound its grant to the worktree of the project root, so the user ran the
 * command the deny message gave them and the agent was still refused. Now:
 *  - the deny message names the resource the hook checks (`--resource <path>`) when it is not the project root;
 *  - `--resource` takes a path (any folder inside the workspace) as well as `workspace` or a resource id, and with no
 *    workspace path given the workspace is found from it, so the command works from any terminal;
 *  - with no `--resource`, the grant is for the worktree of the folder the command names or runs in.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGrant } from "../lib/cli/grant.mjs";
import { linkProject } from "../lib/cli/link.mjs";
import { setupHeli } from "../lib/cli/setup.mjs";
import { evaluatePreToolUse } from "../.heli-harness/adapters/shared/hook-core.mjs";
import { scrubHeliProcessEnv } from "./lib/hermetic-env.mjs";

scrubHeliProcessEnv();
const startedIn = process.cwd();
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "heli-grant-resource-")));
const project = join(scratch, "project");
const app = join(project, "repos", "app");
const outside = join(scratch, "elsewhere");
const env = { ...process.env, HELI_CONFIG_DIR: join(scratch, "config"), HELI_DATA_DIR: join(scratch, "data") };
process.env.HELI_CONFIG_DIR = env.HELI_CONFIG_DIR;
process.env.HELI_DATA_DIR = env.HELI_DATA_DIR;
process.on("exit", () => {
	process.chdir(startedIn);
	rmSync(scratch, { recursive: true, force: true });
});
const terminal = { stdin: true, stdout: true };
const quiet = (fn) => {
	const log = console.log;
	console.log = () => {};
	try {
		return fn();
	} finally {
		console.log = log;
	}
};
const grant = (args) => quiet(() => runGrant(["issue", ...args], { terminal })).grant;

mkdirSync(app, { recursive: true });
mkdirSync(outside, { recursive: true });
assert.equal(spawnSync("git", ["init", "-q", app], { encoding: "utf8" }).status, 0, "git init");
setupHeli({ env });
linkProject(startedIn, project, { env });

const push = (cwd) => evaluatePreToolUse({ cwd, host: "test", env, toolName: "Bash", toolInput: { command: "git push origin feat/x" } });

// 1. The deny message from the nested repository names its resource; from the project root it needs none.
const denied = push(app);
assert.equal(denied.code, "REMOTE_PUSH_DENIED");
const suggested = /`(heli grant issue [^`]+)`/.exec(denied.reason)?.[1];
assert.ok(suggested, denied.reason);
assert.match(suggested, /--resource /, suggested);
assert.ok(suggested.includes(app), suggested);
assert.doesNotMatch(/`(heli grant issue [^`]+)`/.exec(push(project).reason)[1], /--resource/);

// 2. That exact command, run from a terminal somewhere else, makes the push pass.
process.chdir(outside);
const words = suggested.split(" ").slice(3); // after `heli grant issue`
const issued = grant(words);
assert.equal(issued.resource.type, "worktree");
assert.equal(push(app).deny, false, "the suggested grant is the one the hook uses");
assert.equal(push(app).code, "REMOTE_PUSH_DENIED", "a once grant is used up");

// 3. With no --resource, the folder the command runs in decides.
process.chdir(app);
grant(["--action", "git.push"]);
assert.equal(push(app).deny, false, "run from the nested repository: its worktree");
process.chdir(project);
grant(["--action", "git.push"]);
assert.equal(push(app).deny, true, "run from the project root: the root's worktree, not the nested one");
assert.equal(push(project).deny, false);
process.chdir(outside);
grant(["--action", "git.push", app]);
assert.equal(push(app).deny, false, "a workspace path given on the command line decides too");

// 4. `workspace` and resource ids still work; a path outside the workspace is refused.
grant(["--action", "git.push", "--resource", "workspace", project]);
assert.equal(push(app).deny, false);
grant(["--action", "git.push", "--resource", issued.resource.id, project]);
assert.equal(push(app).deny, false);
assert.throws(() => grant(["--action", "git.push", "--resource", outside, project]), (error) => error.code === "RESOURCE_OUTSIDE_WORKSPACE");

console.log("grant resource smoke ok");
