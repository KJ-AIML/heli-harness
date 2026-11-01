#!/usr/bin/env node
/**
 * The protocol tells the agent to keep going, once, and in a size it can afford to read.
 *
 * HARNESS.md was 15.7 KB of mostly embedded-only bookkeeping (`.heli-harness/state/current-task.md`, plan evidence, a
 * resume card) that a linked project never uses, said "stop" without saying whether that meant ending the turn, defined
 * the two-strike rule five different ways across it and the skills, and every linked SessionStart told the agent to read a
 * `.heli-harness/HARNESS.md` the project does not have. Pinned here:
 *  - HARNESS.md is linked-first and small, says what a deny's recovery class asks of the agent, when to end the turn, and
 *    one two-strike rule; the embedded-only rules live in HARNESS-embedded.md (shipped and seeded with it);
 *  - a linked SessionStart carries those rules inline and the real path of the packaged HARNESS.md; an embedded one still
 *    points at its own `.heli-harness/HARNESS.md`;
 *  - skills are read once per session, and the skills' two-strike and recovery wording continue the work.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { linkProject } from "../lib/cli/link.mjs";
import { DISTRIBUTION_ENTRIES } from "../lib/cli/seed-workspace.mjs";
import { setupHeli } from "../lib/cli/setup.mjs";
import { buildSkillUsageBootstrap } from "../.heli-harness/adapters/shared/hook-core.mjs";
import { buildConcurrentSessionContext, resolveExecutionContext } from "../.heli-harness/adapters/shared/concurrency/resolve.mjs";
import { scrubHeliProcessEnv } from "./lib/hermetic-env.mjs";

scrubHeliProcessEnv();
const root = process.cwd();
const read = (rel) => readFileSync(join(root, rel), "utf8");

// 1. HARNESS.md: small, linked-first, and explicit about denies, ending the turn and two strikes.
const harness = read(".heli-harness/HARNESS.md");
// Counted with LF line endings: a Windows checkout has CRLF (.gitattributes), one more byte on every line.
const harnessBytes = Buffer.byteLength(harness.replace(/\r\n/g, "\n"));
assert.ok(harnessBytes < 7000, `HARNESS.md is ${harnessBytes} bytes; keep the protocol readable in one go`);
for (const required of [
	/`SELF_RECOVERABLE`: take the next action and continue\. Do not stop to ask\./,
	/`HUMAN_REQUIRED`: do not work around it\. Ask the user once, and keep working/,
	/`HARD_DENY`: do not retry it or work around it/,
	/End your turn when the work is done, or when every remaining step needs the user/,
	/\*\*Two strikes:\*\* when the same check fails twice after real fixes and you have no new information/,
	/command friction, not strikes/,
	/never revert, overwrite, move or delete changes you did not make/,
	/`S3`: one-way door .* Explicit user approval first/,
	/never run `heli auth login`, `heli ws create\|link`, `heli push`, `heli pull`, `heli sync` or `heli init` unless the user asked/,
	/only the user decides on `--allow-secrets`/,
	/Read each skill once per session/,
	/HARNESS-embedded\.md/,
]) {
	assert.match(harness, required);
}
assert.doesNotMatch(harness, /state\/current-task\.md|plan\.md|[Rr]esume card/, "embedded-only bookkeeping lives in HARNESS-embedded.md");

const embedded = read(".heli-harness/HARNESS-embedded.md");
for (const required of [/current-task\.md/, /plan\.md/, /Evidence purity/, /[Rr]esume card/, /`TASK_GATE`/, /workspace\/target\.json/]) {
	assert.match(embedded, required);
}
assert.doesNotMatch(embedded, /v\d+\.\d+\.\d+/, "no release version: release-version.mjs rewrites only the files it lists");
const pkg = JSON.parse(read("package.json"));
assert.ok(pkg.files.includes(".heli-harness/HARNESS-embedded.md"), "packed");
assert.ok(DISTRIBUTION_ENTRIES.includes("HARNESS-embedded.md"), "seeded into embedded workspaces");

// 2. SessionStart: linked sessions get the rules inline and the packaged HARNESS.md; embedded ones their own.
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "heli-protocol-text-")));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
const env = { ...process.env, HELI_CONFIG_DIR: join(scratch, "config"), HELI_DATA_DIR: join(scratch, "data") };
process.env.HELI_CONFIG_DIR = env.HELI_CONFIG_DIR;
process.env.HELI_DATA_DIR = env.HELI_DATA_DIR;
const linked = join(scratch, "linked");
mkdirSync(linked, { recursive: true });
setupHeli({ env });
linkProject(root, linked, { env });
const linkedContext = buildConcurrentSessionContext(resolveExecutionContext({ cwd: linked, environment: env, host: "test" }), { env });
assert.match(linkedContext, /^Heli-Harness plugin context:\nHeli rules: A deny ends with `Heli recovery:`/);
assert.match(linkedContext, /clear a SELF_RECOVERABLE block yourself and continue/);
assert.match(linkedContext, /End your turn only when the work is done or every remaining step needs the user/);
assert.doesNotMatch(linkedContext, /Read \.heli-harness\/HARNESS\.md/, "a linked project has no .heli-harness/HARNESS.md");
const protocolPath = /Full protocol: (.+HARNESS\.md)\./.exec(linkedContext)?.[1];
assert.ok(protocolPath && existsSync(protocolPath), `the packaged HARNESS.md: ${protocolPath}`);

const workspace = join(scratch, "embedded");
mkdirSync(join(workspace, ".heli-harness", "workspace"), { recursive: true });
writeFileSync(join(workspace, ".heli-harness", "HARNESS.md"), "# Heli\n");
writeFileSync(join(workspace, ".heli-harness", "workspace", "schema.json"), JSON.stringify({ schemaVersion: 1, mode: "concurrent" }));
const embeddedContext = buildConcurrentSessionContext(resolveExecutionContext({ cwd: workspace, environment: env, host: "test" }), { env });
assert.match(embeddedContext, /Read \.heli-harness\/HARNESS\.md before substantive work\./);

// 3. Skills: read once per session; two strikes and recovery classes continue the work.
const bootstrap = buildSkillUsageBootstrap();
assert.match(bootstrap, /mandatory workflow resources/);
assert.match(bootstrap, /once per session/);
assert.match(read(".heli-harness/skills/using-heli-skills/SKILL.md"), /once per session/);
assert.doesNotMatch(read(".heli-harness/skills/engineering/SKILL.md"), /Stop after two failed fix attempts and write diagnosis\./);
assert.match(read(".heli-harness/skills/engineering/SKILL.md"), /continue with it\. End the turn only when the next step needs the user\./);
assert.doesNotMatch(read(".heli-harness/skills/fix-loop/SKILL.md"), /Continue or stop with diagnosis/);
assert.match(read(".heli-harness/skills/debug/SKILL.md"), /not a reason to end the turn/);
assert.match(read(".heli-harness/skills/heli-assistant/SKILL.md"), /`HUMAN_REQUIRED`: .*keep working on the parts of the task that do not need it/);
for (const adapter of ["claude/CLAUDE.md", "codex/AGENTS.md", "grok/GROK.md", "kimi/KIMI.md", "opencode/OPENCODE.md", "antigravity/ANTIGRAVITY.md"]) {
	assert.doesNotMatch(read(`.heli-harness/adapters/${adapter}`), /ask or report as policy requires/, `${adapter}: T3/T4 are guidance`);
}

console.log(`protocol text smoke ok (HARNESS.md ${harnessBytes} bytes)`);
