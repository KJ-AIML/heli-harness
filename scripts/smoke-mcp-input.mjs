#!/usr/bin/env node
/**
 * What Heli reads from the input of an MCP tool. The input is server-defined, so any string
 * that looks like a path is checked against Heli's protected state, but a READ of a `.env`
 * file (or a fetch of a URL that ends in one) is not a `.env` write; a directory field
 * (`cwd`, `root`, ...) says where relative paths and command targets land; the denial says
 * that MCP tools may not read Heli state either; and no input can cost the hook its 30 seconds.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluatePreToolUse } from "../.heli-harness/adapters/shared/hook-core.mjs";
import { scrubHeliProcessEnv } from "./lib/hermetic-env.mjs";

scrubHeliProcessEnv();
const root = process.cwd();
const shippedRules = readFileSync(join(root, ".heli-harness", "safety", "command-rules.json"), "utf8");
const scratch = mkdtempSync(join(tmpdir(), "heli-mcp-input-"));
Object.assign(process.env, { HELI_CONFIG_DIR: join(scratch, "config"), HELI_DATA_DIR: join(scratch, "data"), HELI_HOST_HOME: join(scratch, "home") });
const env = { ...process.env };

function workspace(name) {
	const dir = join(scratch, name);
	mkdirSync(join(dir, ".heli-harness", "safety"), { recursive: true });
	mkdirSync(join(dir, ".heli-harness", "state"), { recursive: true });
	mkdirSync(join(dir, ".heli-harness", "tasks", "t1", "reports"), { recursive: true });
	writeFileSync(join(dir, ".heli-harness", "HARNESS.md"), "# Heli\n");
	writeFileSync(join(dir, ".heli-harness", "safety", "command-rules.json"), shippedRules);
	return dir;
}

const started = Date.now();
try {
	const ws = workspace("ws");
	const call = (toolName, toolInput, extraEnv = {}) => evaluatePreToolUse({ cwd: ws, host: "claude", env: { ...env, ...extraEnv }, toolName, toolInput });

	// 1. A read or a fetch that mentions a `.env` file is not a `.env` write. (MCP tools carry server-defined inputs, so the `.env`
	//    gate reads a call as a write only when it looks like one: a writing tool, content to put in the file, or a destination.)
	for (const [toolName, toolInput] of [
		["mcp__fs__read_text_file", { path: ".env.example" }],
		["mcp__fs__read_file", { path: ".env" }],
		["mcp__fs__read_multiple_files", { paths: [".env.example", "src/app.js"] }],
		["mcp__github__get_file_contents", { owner: "KJ-AIML", repo: "heli-harness", path: ".env.example" }],
		["mcp__fetch__fetch", { url: "https://example.com/.env" }],
		["mcp__fetch__fetch", { url: "https://raw.githubusercontent.com/KJ-AIML/heli-harness/main/.env.example" }],
		["mcp__browser__navigate", { url: "http://localhost:3000/.env", waitUntil: "load" }],
		["mcp__fs__get_file_info", { path: "config/.env.local" }],
		["mcp__fs__search_files", { path: ".", pattern: ".env*" }],
		["mcp__fs__list_directory", { path: "config" }],
		["mcp__grep__search", { query: "API_KEY", file: ".env.example" }],
		// A URL is not a file: even a call that writes somewhere else is not writing the `.env` its URL ends in.
		["mcp__x__download", { url: "https://example.com/.env", path: "downloads/a.txt" }],
		["mcp__fs__write_file", { path: "notes.md", content: "x", source_url: "https://raw.githubusercontent.com/o/r/main/.env.example" }],
	]) {
		const result = call(toolName, toolInput);
		assert.equal(result.deny, false, `${toolName} ${JSON.stringify(toolInput)}: ${result.reason}`);
	}
	// A write, or something that looks like one, still needs the grant.
	for (const [toolName, toolInput] of [
		["mcp__fs__write_file", { path: ".env", content: "X=1" }],
		["mcp__fs__edit_file", { path: ".env.local", edits: [{ oldText: "a", newText: "b" }] }],
		["mcp__github__create_or_update_file", { owner: "o", repo: "r", path: ".env", content: "WA1=", message: "m", branch: "main" }],
		["mcp__fs__create_directory", { path: ".env" }],
		["mcp__fs__move_file", { source: "x.txt", destination: ".env" }],
		["mcp__fs__move_file", { source: ".env", destination: "backup.txt" }],
		["mcp__fs__copy_file", { source: ".env", destination: "backup.txt" }],
		["mcp__fs__delete_file", { path: ".env" }],
		["mcp__notes__save", { path: "config/.env.production", text: "x" }],
		["mcp__x__do_thing", { path: ".env", content: "X=1" }],
		["mcp__x__do_thing", { output: ".env" }],
		["mcp__x__do_thing", { target: "config/.env", data: "X=1" }],
		["mcp__x__download", { url: "https://example.com/a", path: ".env" }],
		["mcp__x__do_thing", { to: ".env.local" }],
		["mcp__x__do_thing", { newPath: ".env.staging", oldPath: "a" }],
	]) {
		const result = call(toolName, toolInput);
		assert.equal(result.code, "ENV_WRITE_DENIED", `${toolName} ${JSON.stringify(toolInput)}: ${result.reason}`);
	}
	// A shell server's command writes what it writes: a redirect into .env is a write however the tool is named.
	assert.equal(call("mcp__shell__run", { command: "echo X=1 > .env" }).code, "ENV_WRITE_DENIED");
	assert.equal(call("mcp__shell__run", { command: "cat .env.example" }).deny, false);
	// Tools that are not MCP tools keep the rule: a path a file tool names is a path it writes.
	assert.equal(call("Write", { file_path: ".env", content: "X=1" }).code, "ENV_WRITE_DENIED");
	assert.equal(call("Edit", { file_path: ".env.local", old_string: "a", new_string: "b" }).code, "ENV_WRITE_DENIED");
	// Only a URL is skipped, and only when it names a scheme: a file: URI is still a path, and so is a Windows drive path.
	assert.equal(call("mcp__x__do_thing", { destination: "file:///.env" }).code, "ENV_WRITE_DENIED", "a file: URI is a path");
	assert.equal(call("mcp__x__do_thing", { url: `file:///${join(ws, ".heli-harness", "state", "yolo.json").replaceAll("\\", "/")}` }).code, "HELI_STATE_PROTECTED", "a file: URI is checked");
	assert.equal(call("mcp__x__do_thing", { url: "https://example.com/a/.heli-harness/state/yolo.json" }).deny, false, "a URL never names a local file");
	assert.equal(call("mcp__x__do_thing", { link: "s3://bucket/.heli-harness/state/yolo.json" }).deny, false);
	if (process.platform === "win32") {
		const drive = join(ws, ".heli-harness", "state", "yolo.json").replaceAll("\\", "/").replace(/^([A-Za-z]):\//, "$1://");
		assert.equal(call("mcp__x__do_thing", { anything: drive }).code, "HELI_STATE_PROTECTED", `a drive letter is not a scheme: ${drive}`);
	}

	// 2. A directory field says where relative paths land (and where a shell server's command runs).
	for (const key of ["cwd", "workdir", "working_directory", "workingDirectory", "directory", "dir", "root", "rootDir", "folder", "baseDir"]) {
		for (const value of [".heli-harness", ".heli-harness/state", ".heli-harness/tasks/t1"]) {
			const result = call("mcp__shell__run", { command: "echo x > yolo.json", [key]: value });
			assert.equal(result.code, "HELI_STATE_PROTECTED", `${key}: ${value}: ${result.reason}`);
		}
	}
	assert.equal(call("mcp__shell__run", { command: "echo x > state/yolo.json", cwd: ".heli-harness" }).code, "HELI_STATE_PROTECTED");
	assert.equal(call("mcp__shell__run", { command: "echo x > yolo.json", cwd: ".heli-harness/tasks/t1/reports/.." }).code, "HELI_STATE_PROTECTED", "a cwd that leads into Heli state");
	assert.equal(call("mcp__shell__run", { command: "echo x > ../yolo.json", cwd: ".heli-harness/tasks/t1/reports" }).code, "HELI_STATE_PROTECTED", "a target that leaves a narrative folder for the state around it");
	assert.equal(call("mcp__shell__run", { command: "cd state && echo x > yolo.json", cwd: ".heli-harness" }).code, "HELI_STATE_PROTECTED", "cd inside a cwd");
	// Splits: a directory field and a relative path that only name Heli state together.
	assert.equal(call("mcp__x__do_thing", { root: "src", relative: "../.heli-harness/state/yolo.json" }).code, "HELI_STATE_PROTECTED");
	assert.equal(call("mcp__x__do_thing", { directory: ".heli-harness/tasks/t1/reports", filename: "../task.json" }).code, "HELI_STATE_PROTECTED");
	assert.equal(call("mcp__x__do_thing", { options: { cwd: ".heli-harness/tasks/t1/reports" }, args: ["../yolo.json"] }).code, "HELI_STATE_PROTECTED", "nested");
	assert.equal(call("mcp__x__do_thing", { root: "..", relative: `${ws.split(/[\\/]/).pop()}/.heli-harness/state/yolo.json` }).code, "HELI_STATE_PROTECTED", "a root outside the workspace");
	// And what stays allowed.
	for (const [toolName, toolInput] of [
		["mcp__shell__run", { command: "echo x > out.txt", cwd: "src" }],
		["mcp__shell__run", { command: "npm test", cwd: ".", timeout: 1000 }],
		["mcp__shell__run", { command: "cat state/yolo.json", cwd: "src" }],
		["mcp__x__do_thing", { root: "src", relative: "a/b.js" }],
		["mcp__x__do_thing", { directory: "docs", filename: "readme.md", direction: "asc" }],
		["mcp__x__do_thing", { cwd: "src", note: "state/yolo.json is protected" }],
	]) {
		const result = call(toolName, toolInput);
		assert.equal(result.deny, false, `${toolName} ${JSON.stringify(toolInput)}: ${result.reason}`);
	}

	// 4. The denial says what MCP tools may not do (they may not read Heli state either: a call cannot be told from a write).
	const read = call("mcp__fs__read_file", { path: ".heli-harness/workspace/target.json" });
	assert.equal(read.code, "HELI_STATE_PROTECTED");
	assert.match(read.reason, /^Heli-Harness protects its own authority state: /);
	assert.match(read.reason, /Agents may not read or write it through MCP tools/);
	assert.match(read.reason, /Heli CLI/);
	const shellServer = call("mcp__shell__run", { command: "echo x > .heli-harness/state/yolo.json" });
	assert.match(shellServer.reason, /^Heli-Harness protects its own authority state: /);
	assert.match(shellServer.reason, /Agents may not read or write it through MCP tools/);
	for (const [toolName, toolInput] of [["Write", { file_path: ".heli-harness/state/yolo.json", content: "{}" }], ["Bash", { command: "echo x > .heli-harness/state/yolo.json" }], ["PowerShell", { command: "sc .heli-harness/state/yolo.json x" }]]) {
		const written = call(toolName, toolInput);
		assert.match(written.reason, /^Heli-Harness protects its own authority state: /, toolName);
		assert.match(written.reason, /Agents may not write it\./, toolName);
		assert.doesNotMatch(written.reason, /read or write/, toolName);
	}

	// 5. No input can cost the hook its 30 seconds (hosts treat a hook that times out as an allow): what an MCP call may hold is bounded,
	//    and a call beyond a limit is refused with the fail-closed prefix, never read in part. The limits sit far above a real call
	//    (a model writes a tool call token by token; 128k output tokens are about 0.5 MB) and every one is checked at its edge.
	const { MCP_INPUT_LIMITS: limits } = await import("../.heli-harness/adapters/shared/mcp-input.mjs");
	const refused = (toolInput, extraTool = "mcp__x__do_thing") => {
		const result = call(extraTool, toolInput);
		assert.equal(result.deny, true);
		assert.equal(result.code, "MCP_INPUT_TOO_COMPLEX", result.reason);
		assert.equal(result.hardDeny, true);
		assert.match(result.reason, /^Heli-Harness could not evaluate this action \(MCP_INPUT_TOO_COMPLEX: [^)]+\); denying \(fail-closed\)\./);
		assert.match(result.reason, /split it into smaller calls/);
		return result;
	};
	const nested = (depth) => {
		let value = "leaf";
		for (let level = 0; level < depth; level += 1) value = { a: value };
		return value;
	};
	assert.equal(call("mcp__x__do_thing", nested(limits.maxDepth)).deny, false, "a nesting at the limit");
	assert.match(refused(nested(limits.maxDepth + 1)).reason, /nesting of its input is over the limit of 128/);
	refused(nested(100000)); // deep enough to overflow a recursive reader
	assert.equal(call("mcp__x__do_thing", { a: Array.from({ length: limits.maxNodes - 2 }, () => 1) }).deny, false, "values at the limit");
	assert.match(refused({ a: Array.from({ length: limits.maxNodes - 1 }, () => 1) }).reason, /number of values in its input is over the limit of 250,000/);
	assert.equal(call("mcp__x__do_thing", { text: "hello world ".repeat(Math.floor(limits.maxStringChars / 12)) }).deny, false, "text at the limit");
	assert.match(refused({ text: "hello world ".repeat(Math.floor(limits.maxStringChars / 12) + 1) }).reason, /text in its input is over the limit of 33,554,432/);
	assert.match(refused({ path: "a/".repeat(limits.maxPathChars / 2 + 1) }).reason, /text of the path-like values in its input is over the limit of 8,388,608/);
	assert.match(refused({ files: Array.from({ length: limits.maxPathValues + 1 }, (_, index) => `docs/f${index}.md`) }).reason, /number of path-like values in its input is over the limit of 50,000/);
	// Directory values times relative paths are more paths.
	assert.equal(call("mcp__x__do_thing", { dirs: Array.from({ length: 10 }, (_, index) => `d${index}`), files: Array.from({ length: 100 }, (_, index) => `f${index}.md`) }).deny, false);
	assert.match(refused({ dirs: Array.from({ length: 200 }, (_, index) => `d${index}`), files: Array.from({ length: 101 }, (_, index) => `f${index}.md`) }).reason, /directory and path pairs in its input is over the limit of 20,000/);
	// A command is read against every directory the call names, so a call with a command may name only so many.
	const directories = (count) => Array.from({ length: count }, (_, index) => `d${index}`);
	assert.equal(call("mcp__shell__run", { command: "echo hi > out.txt", dirs: directories(limits.maxDirectories) }).deny, false);
	assert.match(refused({ command: "echo hi > out.txt", dirs: directories(limits.maxDirectories + 1) }, "mcp__shell__run").reason, /directory values in a call that carries a command is over the limit of 16/);
	assert.equal(call("mcp__x__do_thing", { dirs: directories(limits.maxDirectories + 1) }).deny, false, "without a command there is nothing to read against them");
	// Naming the paths costs file-system lookups, most of all for paths that exist or that are many missing levels deep: the count is
	// budgeted, so 15,000 of them are refused after the first 100,000 units of lookups and not after minutes.
	const budgetStarted = Date.now();
	const deep = refused({ files: Array.from({ length: 15000 }, (_, index) => `m${index}/a/b/c/d/e/f/g/h/i.txt`) });
	assert.match(deep.reason, /naming its paths takes more than 100,000 file-system lookups/);
	const budgetElapsed = Date.now() - budgetStarted;
	assert.ok(budgetElapsed < 20000, `the budget stopped it after ${budgetElapsed} ms`);
	// A tool that is not an MCP tool is not held to these limits (its input is a command or a file's path; the command has its own).
	assert.equal(call("Write", { file_path: "notes.txt", content: "x\n".repeat(200000) }).deny, false);

	// 7. This test is part of `npm run check`, right after the Claude coverage test.
	const checkChain = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts.check;
	assert.ok(checkChain.includes("node scripts/smoke-claude-windows-coverage.mjs && node scripts/smoke-mcp-input.mjs && node scripts/smoke-codex-plugin.mjs"), "smoke-mcp-input runs right after smoke-claude-windows-coverage");

	console.log(`mcp input smoke ok (${Date.now() - started} ms)`);
} finally {
	rmSync(scratch, { recursive: true, force: true });
}
