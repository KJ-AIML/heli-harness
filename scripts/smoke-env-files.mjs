#!/usr/bin/env node
/**
 * Which files the `.env` write gate guards: files that may hold secrets, not the templates that are committed on purpose.
 *
 * The gate matched any `.env.<anything>`, so updating `.env.example` (the usual place to document a new setting) needed
 * `heli grant issue --action env.write` like writing real secrets, while direnv's `.envrc`, which commonly exports them,
 * was not guarded at all. Now `.env`, `.env.<stage>` and `.envrc` are guarded, and `.env.example`, `.env.sample`,
 * `.env.template` and `.env.dist` (also after a stage: `.env.local.example`) are not. A `.env.d/` folder is guarded as
 * before, and copying a real `.env` anywhere (its name is the source of the copy) still is.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluatePreToolUse, namesSecretEnvFile } from "../.heli-harness/adapters/shared/hook-core.mjs";
import { scrubHeliProcessEnv } from "./lib/hermetic-env.mjs";

scrubHeliProcessEnv();
const root = process.cwd();
const scratch = mkdtempSync(join(tmpdir(), "heli-env-files-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
const env = { ...process.env, HELI_CONFIG_DIR: join(scratch, "config"), HELI_DATA_DIR: join(scratch, "data") };

// ------------------------------------------------------------------ the names
for (const [path, guarded] of [
	[".env", true],
	[".ENV", true],
	["apps/api/.env", true],
	[".env.local", true],
	[".env.production", true],
	[".env.test", true],
	["C:\\proj\\.env.local", true],
	[".envrc", true],
	["sub/.envrc", true],
	[".env.example.local", true], // ends in a stage, not a template
	[".env.example.bak", true],
	[".env.d/secrets", true], // a `.env.d/` folder, as before
	[".env.example", false],
	[".env.sample", false],
	[".env.template", false],
	[".env.dist", false],
	[".env.local.example", false],
	["apps/web/.env.EXAMPLE", false],
	[".environment", false],
	["env.ts", false],
	[".env/config", false], // a folder named `.env` was not guarded before either
	["docs/dotenv.md", false],
]) {
	assert.equal(namesSecretEnvFile(path), guarded, path);
}

// ------------------------------------------------------------------ through the hook
function workspace(name) {
	const dir = join(scratch, name);
	mkdirSync(join(dir, ".heli-harness", "state"), { recursive: true });
	mkdirSync(join(dir, ".heli-harness", "safety"), { recursive: true });
	writeFileSync(join(dir, ".heli-harness", "HARNESS.md"), "# Heli\n");
	writeFileSync(join(dir, ".heli-harness", "state", "current-task.md"), "# Current Task\n\nTarget repo: demo\n\nCurrent status: in progress\n\nFailed attempts count: 0\n");
	writeFileSync(join(dir, ".heli-harness", "safety", "command-rules.json"), readFileSync(join(root, ".heli-harness", "safety", "command-rules.json"), "utf8"));
	return dir;
}
const dir = workspace("ws");
const run = (toolName, toolInput, extraEnv = {}) => evaluatePreToolUse({ cwd: dir, host: "test", env: { ...env, ...extraEnv }, toolName, toolInput });
const verdictOf = (result) => (result.deny ? result.code : "allow");

for (const [toolName, toolInput, expected] of [
	["Write", { file_path: ".env" }, "ENV_WRITE_DENIED"],
	["Write", { file_path: ".env.local" }, "ENV_WRITE_DENIED"],
	["Edit", { file_path: "config/.env.production" }, "ENV_WRITE_DENIED"],
	["Write", { file_path: ".envrc" }, "ENV_WRITE_DENIED"],
	["Write", { file_path: ".env.example" }, "allow"],
	["Edit", { file_path: "apps/api/.env.sample" }, "allow"],
	["Write", { file_path: ".env.template" }, "allow"],
	["Write", { file_path: ".env.local.example" }, "allow"],
	["Bash", { command: "echo NEW_SETTING= >> .env.example" }, "allow"],
	["Bash", { command: "cp .env.example .env" }, "ENV_WRITE_DENIED"],
	["Bash", { command: "cp .env .env.example" }, "ENV_WRITE_DENIED"], // copying the real one out is still guarded
	["Bash", { command: "echo 'export TOKEN=x' >> .envrc" }, "ENV_WRITE_DENIED"],
	["mcp__fs__write_file", { path: ".env.example", content: "X=" }, "allow"],
	["mcp__fs__write_file", { path: ".envrc", content: "export X=1" }, "ENV_WRITE_DENIED"],
	["mcp__fs__read_file", { path: ".env.example" }, "allow"],
]) {
	assert.equal(verdictOf(run(toolName, toolInput)), expected, `${toolName} ${JSON.stringify(toolInput)}`);
}
// The approvals are unchanged: YOLO and the env.write switch still lift the gate for the files it guards.
assert.equal(verdictOf(run("Write", { file_path: ".envrc" }, { HELI_ALLOW_ENV_WRITE: "1" })), "allow");
assert.equal(verdictOf(run("Write", { file_path: ".env" }, { HELI_YOLO: "1" })), "allow");

console.log("env files smoke ok");
