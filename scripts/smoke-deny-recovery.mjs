#!/usr/bin/env node
/**
 * Every deny says who can lift it, what to do next, and what to do meanwhile.
 *
 * Only ownership denies said whether the agent could recover on its own, and they told it to STOP; every other deny was a
 * bare reason, so an agent could not tell a block it can clear itself (a command over the analysis budget, a diagnosis
 * record) from one only the user can lift (a grant) or one nobody should work around (T6), and it stopped to ask about
 * all of them. Now each deny carries `recoverability` (SELF_RECOVERABLE / HUMAN_REQUIRED / HARD_DENY), `nextAction` and
 * `retryable: false`, and its reason ends with them and with what the agent does meanwhile: clear it and continue; ask
 * once and keep working on what does not need it; or continue another way.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { linkProject } from "../lib/cli/link.mjs";
import { setupHeli } from "../lib/cli/setup.mjs";
import { evaluatePreToolUse } from "../.heli-harness/adapters/shared/hook-core.mjs";
import { scrubHeliProcessEnv } from "./lib/hermetic-env.mjs";

scrubHeliProcessEnv();
const root = process.cwd();
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "heli-deny-recovery-")));
const env = { ...process.env, HELI_CONFIG_DIR: join(scratch, "config"), HELI_DATA_DIR: join(scratch, "data") };
process.env.HELI_CONFIG_DIR = env.HELI_CONFIG_DIR;
process.env.HELI_DATA_DIR = env.HELI_DATA_DIR;
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));

function embedded(name, { rules = true, failedAttempts = 0 } = {}) {
	const dir = join(scratch, name);
	mkdirSync(join(dir, ".heli-harness", "state"), { recursive: true });
	mkdirSync(join(dir, ".heli-harness", "safety"), { recursive: true });
	writeFileSync(join(dir, ".heli-harness", "HARNESS.md"), "# Heli\n");
	writeFileSync(join(dir, ".heli-harness", "state", "current-task.md"), `# Current Task\n\nTarget repo: demo\n\nCurrent status: in progress\n\nFailed attempts count: ${failedAttempts}\n`);
	if (rules) writeFileSync(join(dir, ".heli-harness", "safety", "command-rules.json"), readFileSync(join(root, ".heli-harness", "safety", "command-rules.json"), "utf8"));
	return dir;
}
const ws = embedded("ws");
const linked = join(scratch, "linked");
mkdirSync(linked, { recursive: true });
setupHeli({ env });
linkProject(root, linked, { env });

const CONDUCT = {
	SELF_RECOVERABLE: /You can clear this yourself: take the next action, then continue the task\. There is no need to stop or ask the user\.$/,
	HUMAN_REQUIRED: /Ask the user once for this decision, and until they answer keep working on the parts of the task that do not need it\.$/,
	HARD_DENY: /Do not retry this or work around it; continue the task another way\./,
};
function expectRecovery(label, result, code, recoverability, nextAction) {
	assert.equal(result.deny, true, label);
	assert.equal(result.code, code, `${label}: ${result.reason}`);
	assert.equal(result.recoverability, recoverability, label);
	assert.equal(result.retryable, false, label);
	assert.ok(result.nextAction, label);
	if (nextAction) assert.match(result.nextAction, nextAction, label);
	assert.match(result.reason, new RegExp(`\\nHeli recovery: ${recoverability}\\.\\nNext action: `), label);
	assert.match(result.reason, CONDUCT[recoverability], label);
	assert.doesNotMatch(result.reason, /\bSTOP\b/, `${label}: no blanket STOP`);
}
const run = (cwd, toolName, toolInput) => evaluatePreToolUse({ cwd, host: "test", env, toolName, toolInput });
const bash = (cwd, command) => run(cwd, "Bash", { command });

expectRecovery("T6", bash(ws, "rm -rf build"), "TIER_BLOCKED", "HARD_DENY");
expectRecovery("push", bash(ws, "git push origin main"), "REMOTE_PUSH_DENIED", "HUMAN_REQUIRED", /heli grant issue/);
expectRecovery("env", run(ws, "Write", { file_path: ".env", content: "X=1" }), "ENV_WRITE_DENIED", "HUMAN_REQUIRED", /heli grant issue/);
expectRecovery("T5", bash(ws, "npm publish"), "TIER_APPROVAL_REQUIRED", "HUMAN_REQUIRED", /heli grant issue/);
expectRecovery("too complex", bash(ws, `git add ${Array.from({ length: 300 }, (_, i) => `f${i}.ts`).join(" ")}`), "COMMAND_TOO_COMPLEX", "SELF_RECOVERABLE", /Split the command/);
expectRecovery("Heli state", run(ws, "Write", { file_path: join(env.HELI_DATA_DIR, "grants", "x.json"), content: "{}" }), "HELI_STATE_PROTECTED", "HARD_DENY");
expectRecovery("policy files", run(linked, "Write", { file_path: ".heli/safety/command-rules.json", content: "{}" }), "HELI_POLICY_PROTECTED", "HUMAN_REQUIRED");
expectRecovery("rules missing", bash(embedded("no-rules", { rules: false }), "ls"), "COMMAND_RULES_UNAVAILABLE", "HUMAN_REQUIRED", /heli update/);
expectRecovery("task gate (embedded)", run(embedded("stuck", { failedAttempts: 2 }), "Write", { file_path: "notes.txt", content: "x" }), "TASK_GATE", "SELF_RECOVERABLE");

// An allowed call carries no recovery, and a deny reason keeps its own text first.
assert.equal(bash(ws, "npm test").recoverability, undefined);
assert.match(bash(ws, "git push origin main").reason, /^Heli-Harness blocks git push without scoped authority/);

// The hook wrapper's fail-closed deny (an evaluation that throws) says it too.
const hook = spawnSync(process.execPath, [join(root, ".heli-harness", "adapters", "claude-plugin", "hooks", "heli-pre-tool-use.mjs")], {
	cwd: ws,
	input: "{not json",
	encoding: "utf8",
	env,
});
const failClosed = JSON.parse(hook.stdout).hookSpecificOutput.permissionDecisionReason;
assert.match(failClosed, /denying \(fail-closed\)\. Run `heli doctor`\.\nHeli recovery: HUMAN_REQUIRED\.\nNext action: Ask the user to run `heli doctor`/);

console.log("deny recovery smoke ok");
