#!/usr/bin/env node
/**
 * An agent cannot change the rules it runs under.
 *
 * A linked project's governance files are committed project state that the hooks read on every call: `.heli/safety/`
 * (command rules), `.heli/policies/`, and the binding (`.heli/workspace.json`, `.heli/heli.lock`). They were ordinary
 * files, so an agent could delete a project T5/T6 rule, or the binding itself, in the middle of a session and the next
 * call ran without it. Writes to them, and moving or removing `.heli/`, are now refused for every tool (YOLO does not
 * lift it); reading them is not. Profiles and skills under `.heli/` stay agent-writable (profiles are kept by agents).
 * An embedded workspace (the Heli source checkout dogfoods one) is unchanged. `heli governance set`, which switches the
 * conflict gate off with `observe`, is human-only like `heli grant issue`.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGovernance } from "../lib/cli/governance.mjs";
import { linkProject } from "../lib/cli/link.mjs";
import { setupHeli } from "../lib/cli/setup.mjs";
import { readGovernanceProfile } from "../lib/concurrency/flow-governance.mjs";
import { evaluatePreToolUse } from "../.heli-harness/adapters/shared/hook-core.mjs";
import { scrubHeliProcessEnv } from "./lib/hermetic-env.mjs";

scrubHeliProcessEnv();
const startedIn = process.cwd();
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "heli-policy-protection-")));
const project = join(scratch, "project");
const env = { ...process.env, HELI_CONFIG_DIR: join(scratch, "config"), HELI_DATA_DIR: join(scratch, "data") };
process.env.HELI_CONFIG_DIR = env.HELI_CONFIG_DIR;
process.env.HELI_DATA_DIR = env.HELI_DATA_DIR;
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));

mkdirSync(project, { recursive: true });
setupHeli({ env });
linkProject(startedIn, project, { env });

const run = (toolName, toolInput, extraEnv = {}, cwd = project) =>
	evaluatePreToolUse({ cwd, host: "test", env: { ...env, ...extraEnv }, toolName, toolInput });
const verdictOf = (result) => (result.deny ? result.code : "allow");

// 1. Linked project: writes to the governance files are refused, for every tool.
for (const [toolName, toolInput] of [
	["Write", { file_path: ".heli/safety/command-rules.json", content: "{\"version\":1,\"rules\":[]}" }],
	["Edit", { file_path: join(project, ".heli", "safety", "command-rules.json"), old_string: "git push", new_string: "x" }],
	["Write", { file_path: ".heli/policies/engineering.md", content: "anything goes" }],
	["Write", { file_path: ".heli/policies/policy.json", content: "{}" }],
	["Write", { file_path: ".heli/workspace.json", content: "{}" }],
	["Write", { file_path: ".heli/heli.lock", content: "{}" }],
	["Bash", { command: "echo '{\"version\":1,\"rules\":[]}' > .heli/safety/command-rules.json" }],
	["Bash", { command: "rm .heli/safety/command-rules.json" }],
	["Bash", { command: "rm -r .heli/policies" }],
	["Bash", { command: "rm -r .heli" }],
	["Bash", { command: "mv .heli .heli-old" }],
	["Bash", { command: "sed -i '' s/T5/T0/ .heli/safety/command-rules.json" }],
	["mcp__fs__write_file", { path: ".heli/safety/command-rules.json", content: "{}" }],
]) {
	const result = run(toolName, toolInput);
	assert.equal(verdictOf(result), "HELI_POLICY_PROTECTED", `${toolName} ${JSON.stringify(toolInput).slice(0, 90)}`);
	assert.equal(result.hardDeny, true);
	assert.match(result.reason, /may not change the rules it runs under/);
}
// ...under YOLO too.
assert.equal(verdictOf(run("Write", { file_path: ".heli/safety/command-rules.json", content: "{}" }, { HELI_YOLO: "1" })), "HELI_POLICY_PROTECTED");

// 2. Reading them is fine, and so is writing the parts of `.heli/` agents keep.
for (const [toolName, toolInput] of [
	["Bash", { command: "cat .heli/safety/command-rules.json" }],
	["mcp__fs__read_file", { path: ".heli/safety/command-rules.json" }],
	["Write", { file_path: ".heli/profiles/app.md", content: "# Repo Profile\n" }],
	["Write", { file_path: ".heli/skills/local/SKILL.md", content: "# local\n" }],
	["Bash", { command: "mkdir -p .heli/profiles && cp README.md .heli/profiles/notes.md" }],
]) {
	assert.equal(verdictOf(run(toolName, toolInput)), "allow", `${toolName} ${JSON.stringify(toolInput)}`);
}

// 3. An embedded workspace is unchanged: its safety files are the package defaults a maintainer edits.
{
	const embedded = join(scratch, "embedded");
	mkdirSync(join(embedded, ".heli-harness", "state"), { recursive: true });
	mkdirSync(join(embedded, ".heli-harness", "safety"), { recursive: true });
	writeFileSync(join(embedded, ".heli-harness", "HARNESS.md"), "# Heli\n");
	writeFileSync(join(embedded, ".heli-harness", "state", "current-task.md"), "# Current Task\n\nTarget repo: demo\n\nCurrent status: in progress\n\nFailed attempts count: 0\n");
	writeFileSync(join(embedded, ".heli-harness", "safety", "command-rules.json"), readFileSync(join(startedIn, ".heli-harness", "safety", "command-rules.json"), "utf8"));
	assert.equal(verdictOf(run("Write", { file_path: ".heli-harness/safety/command-rules.json", content: "{}" }, {}, embedded)), "allow");
}

// 4. `heli governance set` is human-only: the hook refuses it, and the CLI needs a terminal.
assert.equal(verdictOf(run("Bash", { command: "heli governance set observe" })), "TIER_BLOCKED");
assert.equal(verdictOf(run("Bash", { command: "heli governance show" })), "allow");
const quiet = (fn) => {
	const log = console.log;
	console.log = () => {};
	try {
		return fn();
	} finally {
		console.log = log;
	}
};
assert.throws(() => quiet(() => runGovernance(["set", "observe", project], { terminal: { stdin: false, stdout: false } })), (error) => error.code === "HUMAN_TERMINAL_REQUIRED");
assert.equal(readGovernanceProfile(project, { env }), "flow", "a refused set changes nothing");
quiet(() => runGovernance(["set", "strict", project], { terminal: { stdin: true, stdout: true } }));
assert.equal(readGovernanceProfile(project, { env }), "strict");
quiet(() => runGovernance(["show", project], { terminal: { stdin: false, stdout: false } })); // show needs no terminal

console.log("policy protection smoke ok");
