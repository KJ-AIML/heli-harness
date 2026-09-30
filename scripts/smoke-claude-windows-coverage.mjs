#!/usr/bin/env node
/**
 * Claude Code coverage beyond Bash/Edit/Write: the PowerShell tool (Windows
 * default shell), Monitor (runs a command), NotebookEdit, and MCP tools must
 * reach Heli and be governed like their Bash/Write equivalents.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { evaluatePreToolUse, isLikelyShellMutation, isMcpTool, isShellTool } from "../.heli-harness/adapters/shared/hook-core.mjs";
import { createTask } from "../lib/concurrency/task.mjs";
import { createSession, attachSession } from "../lib/concurrency/session.mjs";
import { acquireWriteLease } from "../lib/concurrency/lease.mjs";
import { scrubHeliProcessEnv } from "./lib/hermetic-env.mjs";

scrubHeliProcessEnv();
const root = process.cwd();
const hooksJson = JSON.parse(readFileSync(join(root, ".heli-harness", "adapters", "claude-plugin", "hooks", "hooks.json"), "utf8"));
const shippedRules = readFileSync(join(root, ".heli-harness", "safety", "command-rules.json"), "utf8");

// 1. The PreToolUse matcher is a regex (it contains non-name characters) that
//    selects exactly the governed tools. Claude reads a matcher made only of
//    letters, digits, `_`, `-`, `,`, `|` and spaces as a list of exact names,
//    and anything else as an unanchored, case-sensitive JavaScript regex.
assert.equal(hooksJson.hooks.PreToolUse.length, 1, "one PreToolUse entry");
const matcher = hooksJson.hooks.PreToolUse[0].matcher;
assert.match(matcher, /[^A-Za-z0-9_, |-]/, "matcher must contain regex characters so Claude treats it as a regex");
const matcherRe = new RegExp(matcher);
for (const tool of ["Bash", "PowerShell", "Monitor", "Edit", "MultiEdit", "Write", "NotebookEdit", "mcp__fs__write_file", "mcp__github__create_issue", "mcp__notebooklm-mcp__notebook_create"]) {
	assert.ok(matcherRe.test(tool), `matcher must select ${tool}`);
}
for (const tool of ["Read", "Glob", "Grep", "TodoWrite", "WebFetch", "WebSearch", "Task", "Skill", "BashOutput", "KillShell", "PowerShellX", "xBash", "MultiEditor", "NotebookEditor", "Monitors", " Bash", "PowerShell ", "xmcp__fs__write_file", "mcp_fs_write_file", "Mcp__fs__write_file"]) {
	assert.equal(matcherRe.test(tool), false, `matcher must not select ${tool}`);
}
assert.equal(hooksJson.hooks.PreToolUse[0].hooks[0].timeout, 30, "the hook keeps its 30 second timeout");

// 2. Shell classification for the new tool names and PowerShell mutations.
for (const tool of ["PowerShell", "powershell", "pwsh", "Monitor", "Bash", "run_command"]) assert.ok(isShellTool(tool), tool);
for (const tool of ["mcp__shell__run", "mcp__monitor__start", "PowerShellX", "Monitoring", "Read", "Edit", "NotebookEdit", ""]) assert.equal(isShellTool(tool), false, `${tool} is not a shell`);
assert.equal(isShellTool(undefined), false);
for (const tool of ["mcp__fs__write_file", "MCP__fs__write_file", "mcp__github__create_issue"]) assert.equal(isMcpTool(tool), true, tool);
for (const tool of ["Bash", "PowerShell", "Write", "mcp_fs", "fs__mcp__x", "xmcp__fs", "", undefined, null]) assert.equal(isMcpTool(tool), false, String(tool));
for (const command of [
	"Set-Content -Path src/x.ts -Value 1",
	"Add-Content notes.txt more",
	"'x' | Out-File out.txt",
	"New-Item -ItemType File a.txt",
	"Remove-Item a.txt",
	"Move-Item a.txt b.txt",
	"Copy-Item a.txt b.txt",
	"Rename-Item a.txt b.txt",
	"Clear-Content a.txt",
	"Get-Date | Tee-Object log.txt",
	"SET-CONTENT a.txt 1",
	"Get-ChildItem | ForEach-Object { Remove-Item $_ }",
	"sc a.txt 1",
	"ni a.txt",
	"md newdir",
	"del a.txt",
	"copy a.txt b.txt",
	"echo 1 > a.txt",
	"cd src; del a.txt",
	"Get-Date | sc log.txt",
	"pwsh -NoProfile -Command \"del a.txt\"",
]) {
	assert.equal(isLikelyShellMutation("PowerShell", command), true, command);
}
for (const command of ["Get-ChildItem", "git status", "echo sc is a word", "Get-Content a.txt", "Write-Host hello", "Select-String foo a.txt", "Test-Path a.txt", "Get-Help copy", "Get-Process | Sort-Object CPU"]) {
	assert.equal(isLikelyShellMutation("PowerShell", command), false, command);
}
assert.equal(isLikelyShellMutation("Monitor", "echo 1 > a.txt"), true, "Monitor runs a shell command");
assert.equal(isLikelyShellMutation("Monitor", "npm run dev"), false);
assert.equal(isLikelyShellMutation("mcp__shell__run", "Set-Content a.txt 1"), false, "an MCP tool is never a local shell");
assert.equal(isLikelyShellMutation("Read", "Set-Content a.txt 1"), false);

// The scratch folder exists only from here, so a failed assertion above leaves nothing behind.
const scratch = mkdtempSync(join(tmpdir(), "heli-claude-coverage-"));
const hostHome = join(scratch, "home");
// Heli's directories point into it for this process too, so setting up a workspace below never reaches the real home directory.
Object.assign(process.env, { HELI_CONFIG_DIR: join(scratch, "config"), HELI_DATA_DIR: join(scratch, "data"), HELI_HOST_HOME: hostHome });
const env = { ...process.env };

function hook(cwd, payload, extraEnv = {}) {
	const result = spawnSync(process.execPath, [join(root, ".heli-harness", "adapters", "claude-plugin", "hooks", "heli-pre-tool-use.mjs")], {
		cwd,
		input: JSON.stringify(payload),
		encoding: "utf8",
		env: { ...env, ...extraEnv },
	});
	assert.equal(result.status, 0, result.stderr);
	const body = result.stdout.trim() ? JSON.parse(result.stdout) : {};
	return { denied: body?.hookSpecificOutput?.permissionDecision === "deny", reason: body?.hookSpecificOutput?.permissionDecisionReason || "" };
}

function workspace(name, { rules = shippedRules, concurrent = false } = {}) {
	const dir = join(scratch, name);
	mkdirSync(join(dir, ".heli-harness", "safety"), { recursive: true });
	mkdirSync(join(dir, ".heli-harness", "state"), { recursive: true });
	writeFileSync(join(dir, ".heli-harness", "HARNESS.md"), "# Heli\n");
	if (rules !== null) writeFileSync(join(dir, ".heli-harness", "safety", "command-rules.json"), rules);
	if (concurrent) {
		mkdirSync(join(dir, ".heli-harness", "workspace"), { recursive: true });
		writeFileSync(join(dir, ".heli-harness", "workspace", "schema.json"), JSON.stringify({ schemaVersion: 1, mode: "concurrent" }));
	}
	return dir;
}

function evaluate(cwd, toolName, toolInput, extraEnv = {}) {
	return evaluatePreToolUse({ cwd, host: "claude", env: { ...env, ...extraEnv }, toolName, toolInput });
}

try {
	const ws = workspace("ws");

	// 3. Synthetic Claude payloads through the real wrapper.
	const cases = [
		[{ tool_name: "PowerShell", tool_input: { command: "git push origin main" } }, /git push/],
		[{ tool_name: "PowerShell", tool_input: { command: "Set-Content .env x" } }, /\.env/],
		[{ tool_name: "PowerShell", tool_input: { command: "Remove-Item -Recurse -Force src" } }, /tier T6/],
		[{ tool_name: "Monitor", tool_input: { command: "rm -rf build", description: "watch" } }, /tier T6/],
		[{ tool_name: "NotebookEdit", tool_input: { notebook_path: ".heli-harness/state/yolo.json", new_source: "{}" } }, /authority state/],
		[{ tool_name: "mcp__fs__write_file", tool_input: { path: ".heli-harness/state/yolo.json", content: "{\"enabled\":true}" } }, /authority state/],
		[{ tool_name: "mcp__fs__move_file", tool_input: { source: "x.json", destination: `${ws}/.heli-harness/workspace/target.json` } }, /authority state/],
		// The PowerShell and Monitor tools are shells: what they write is checked against Heli state like Bash's writes.
		[{ tool_name: "PowerShell", tool_input: { command: "'{}' | Out-File .heli-harness/state/yolo.json" } }, /authority state/],
		[{ tool_name: "PowerShell", tool_input: { command: "sc .heli-harness/workspace/target.json x" } }, /authority state/],
		[{ tool_name: "Monitor", tool_input: { command: "echo 1 > .heli-harness/state/yolo.json" } }, /authority state/],
		[{ tool_name: "PowerShell", tool_input: { command: "$s = Get-Content .claude/settings.json | ConvertFrom-Json; $s.disableAllHooks = $true; $s | ConvertTo-Json | Set-Content .claude/settings.json" } }, /disableAllHooks/],
		[{ tool_name: "PowerShell", tool_input: { command: "pwsh -Command \"git push origin main\"" } }, /git push/],
		// PowerShell binds a parameter's value in the same word (`-Path:x`) as readily as in the next one.
		[{ tool_name: "PowerShell", tool_input: { command: "Set-Content -Path:.heli-harness/state/yolo.json -Value:x" } }, /authority state/],
		[{ tool_name: "PowerShell", tool_input: { command: "Set-Content -LiteralPath:.heli-harness/workspace/target.json x" } }, /authority state/],
		[{ tool_name: "PowerShell", tool_input: { command: "Out-File -FilePath:.heli-harness/state/yolo.json" } }, /authority state/],
		[{ tool_name: "PowerShell", tool_input: { command: "Copy-Item -Path a.json -Destination:.heli-harness/state/yolo.json" } }, /authority state/],
		[{ tool_name: "PowerShell", tool_input: { command: "Remove-Item -Path:.heli-harness/state/yolo.json -Force:$true" } }, /authority state/],
		[{ tool_name: "PowerShell", tool_input: { command: "Rename-Item -Path:.heli-harness/state/plan.md -NewName:yolo.json" } }, /authority state/],
		[{ tool_name: "PowerShell", tool_input: { command: "Rename-Item .heli-harness/state/plan.md -Force:$true yolo.json" } }, /authority state/],
		[{ tool_name: "PowerShell", tool_input: { command: "Set-Location -Path:.heli-harness/state; Set-Content yolo.json x" } }, /authority state/],
		[{ tool_name: "PowerShell", tool_input: { command: "Set-Location -Path:.heli-harness/state -PassThru:$true; Set-Content yolo.json x" } }, /authority state/],
		[{ tool_name: "PowerShell", tool_input: { command: "Set-Location -PassThru:$true -L:.heli-harness/state; Set-Content yolo.json x" } }, /authority state/],
		[{ tool_name: "PowerShell", tool_input: { command: "Set-Content -Path:.env x" } }, /\.env/],
		[{ tool_name: "PowerShell", tool_input: { command: "pwsh -Command \"Set-Content -Path:.env x\"" } }, /\.env/],
		// MCP tools: every path-like value is a path, whatever the server calls it.
		[{ tool_name: "mcp__fs__batch", tool_input: { operations: [{ from: "a.txt", to: ".heli-harness/tasks/t1/task.json" }] } }, /authority state/],
		[{ tool_name: "mcp__fs__copy", tool_input: { uri: pathToFileURL(join(ws, ".heli-harness", "state", "yolo.json")).href } }, /authority state/],
		[{ tool_name: "mcp__shell__run", tool_input: { command: "rm -rf build" } }, /tier T6/],
	];
	for (const [payload, reason] of cases) {
		const out = hook(ws, payload);
		assert.equal(out.denied, true, `${payload.tool_name} ${JSON.stringify(payload.tool_input)} must be denied`);
		assert.match(out.reason, reason, payload.tool_name);
	}
	for (const payload of [
		{ tool_name: "PowerShell", tool_input: { command: "Get-ChildItem" } },
		{ tool_name: "PowerShell", tool_input: { command: "Remove-Item file.txt" } },
		{ tool_name: "PowerShell", tool_input: { command: "Set-Content notes.txt hello" } },
		{ tool_name: "PowerShell", tool_input: { command: "New-Item -ItemType File a.txt; Copy-Item a.txt b.txt" } },
		{ tool_name: "PowerShell", tool_input: { command: "Get-Content .heli-harness/state/yolo.json" } },
		{ tool_name: "PowerShell", tool_input: { command: "Get-Content -Path:.heli-harness/state/yolo.json" } },
		{ tool_name: "PowerShell", tool_input: { command: "Set-Content -Path:notes.txt -Value:hello -Encoding:utf8" } },
		{ tool_name: "PowerShell", tool_input: { command: "Remove-Item -Path:file.txt -Force:$true" } },
		{ tool_name: "PowerShell", tool_input: { command: "Copy-Item -Path:a.txt -Destination:b.txt" } },
		{ tool_name: "PowerShell", tool_input: { command: "Rename-Item -Path:a.txt -NewName:b.txt" } },
		{ tool_name: "PowerShell", tool_input: { command: "Set-Location -Path:src; Set-Content a.txt x" } },
		{ tool_name: "PowerShell", tool_input: { command: "git status" } },
		{ tool_name: "Monitor", tool_input: { command: "npm run dev" } },
		{ tool_name: "Monitor", tool_input: { command: "tail -f build.log", description: "watch the build log", timeout_ms: 60000 } },
		// A WebSocket watch has a `ws` source and no command: its required `description` is a label, not a command.
		{ tool_name: "Monitor", tool_input: { ws: { url: "wss://events.example.com/stream" }, description: "git push events and rm -rf build alerts", timeout_ms: 60000 } },
		{ tool_name: "NotebookEdit", tool_input: { notebook_path: "analysis.ipynb", new_source: "print(1)" } },
		{ tool_name: "mcp__fs__read_file", tool_input: { path: "src/app.js" } },
		{ tool_name: "mcp__github__create_issue", tool_input: { title: "bug", body: "see docs/x.md" } },
		// Text that only talks about Heli state, commands or URLs is not a path or a command.
		{ tool_name: "mcp__github__create_issue", tool_input: { title: "cleanup", description: "run git push --force, then rm -rf build", body: "never edit .heli-harness/state/yolo.json by hand" } },
		{ tool_name: "mcp__github__get_file_contents", tool_input: { owner: "KJ-AIML", repo: "heli-harness", url: "https://github.com/KJ-AIML/heli-harness/blob/main/.heli-harness/HARNESS.md" } },
		{ tool_name: "mcp__calendar__create_event", tool_input: { when: "2026/09/30", mime: "application/json" } },
		{ tool_name: "mcp__fs__write_file", tool_input: { path: "docs/notes.md", content: "x" } },
	]) {
		const out = hook(ws, payload);
		assert.equal(out.denied, false, `${payload.tool_name} ${JSON.stringify(payload.tool_input)}: ${out.reason}`);
	}

	// 4. PowerShell and Monitor writes face the ownership gate like Bash writes.
	const conc = workspace("concurrent", { concurrent: true });
	createTask(conc, { taskId: "t1", repositoryId: "demo", worktreePath: conc });
	createSession(conc, { sessionId: "owner", mode: "write", worktreePath: conc });
	attachSession(conc, "owner", "t1", { mode: "write", worktreePath: conc });
	acquireWriteLease(conc, { taskId: "t1", sessionId: "owner", worktreePath: conc });
	createSession(conc, { sessionId: "observer", mode: "observe", worktreePath: conc });
	attachSession(conc, "observer", "t1", { mode: "observe", worktreePath: conc });
	const asObserver = { HELI_SESSION_ID: "observer" };
	const asOwner = { HELI_SESSION_ID: "owner" };
	for (const [toolName, command] of [
		["PowerShell", "Set-Content src/x.ts 'y'"],
		["PowerShell", "del src/x.ts"],
		["PowerShell", "'y' | Out-File src/x.ts"],
		["Monitor", "echo y > src/x.ts"],
	]) {
		const observerWrite = evaluatePreToolUse({ cwd: conc, host: "claude", env: { ...env, ...asObserver }, toolName, toolInput: { command } });
		assert.equal(observerWrite.deny, true, `${toolName}: ${command}`);
		assert.equal(observerWrite.code, "NOT_WRITE_MODE", `${toolName}: ${command}`);
		assert.equal(observerWrite.coverage, "shell-mutation-best-effort", `${toolName}: ${command}`);
		assert.equal(evaluate(conc, toolName, { command }, asOwner).deny, false, `${toolName} by the lease holder: ${command}`);
	}
	for (const command of ["Get-ChildItem", "Get-Content src/x.ts", "git status"]) {
		assert.equal(evaluate(conc, "PowerShell", { command }, asObserver).deny, false, `an observer may read: ${command}`);
	}
	assert.equal(evaluate(conc, "NotebookEdit", { notebook_path: "src/analysis.ipynb", new_source: "print(1)" }, asObserver).code, "NOT_WRITE_MODE", "NotebookEdit is a file writer");
	assert.equal(evaluate(conc, "PowerShell", { command: "Set-Content .heli-harness/tasks/t1/task.json x" }, asOwner).code, "HELI_STATE_PROTECTED", "not even the lease holder writes authority state from PowerShell");

	// 5. MCP inputs: which strings are paths, and what the command rules still read.
	const mcp = (toolInput, extraEnv = {}) => evaluate(ws, "mcp__server__do_thing", toolInput, extraEnv);
	const yoloFile = join(ws, ".heli-harness", "state", "yolo.json");
	for (const [label, toolInput, extraEnv] of [
		["a path-like key", { target: ".heli-harness/state/yolo.json" }],
		["a key that only contains one", { destinationFolder: ".heli-harness/state" }],
		["a bare name under a path-like key", { directory: ".heli-harness" }],
		["a key in another case", { OutputLocation: ".heli-harness/state/yolo.json" }],
		["a value under any key", { anything: ".heli-harness/state/yolo.json" }],
		["an absolute path", { anything: yoloFile }],
		["a list under a path-like key", { files: ["src/a.js", ".heli-harness/state/yolo.json"] }],
		["a list of bare names under a path-like key", { directories: ["docs", ".heli-harness"] }],
		// Padding a path with `x/../` past any length limit does not hide where it leads.
		["a padded path under a path-like key", { destination: `${"x/../".repeat(300)}.heli-harness/state/yolo.json` }],
		["a padded path with spaces under a path-like key", { destination: `${"x y/../".repeat(200)}.heli-harness/state/yolo.json` }],
		["a padded path under any key", { anything: `${"x/../".repeat(1000)}.heli-harness/state/yolo.json` }],
		["a padded path under path or file", { file_path: `${"x/../".repeat(300)}.heli-harness/state/yolo.json` }],
		["a patch in the command of an MCP tool", { command: "*** Begin Patch\n*** Add File: .heli-harness/state/yolo.json\n+x\n*** End Patch\n" }],
		["a list of objects", { changes: [{ note: "x", to: ".heli-harness/state/yolo.json" }] }],
		["a deeply nested value", { a: { b: [{ c: { d: yoloFile } }] } }],
		["a file: URI", { anything: pathToFileURL(yoloFile).href }],
		["a file: URI with one slash", { anything: `file:${pathToFileURL(yoloFile).pathname}` }],
		["a file: URI with an encoded dot", { anything: pathToFileURL(yoloFile).href.replace("/.heli-harness/", "/%2eheli-harness/") }],
		["a spelling with dot segments", { anything: "src/../.heli-harness/state/yolo.json" }],
		["a home path", { location: "~/.grok/hooks/heli-harness.json" }, { HOME: hostHome, USERPROFILE: hostHome }],
		["a path with spaces under a path-like key", { path: `${yoloFile} ` }],
		...(process.platform === "win32" ? [["a Windows spelling", { anything: ".heli-harness\\state\\yolo.json" }], ["a Windows spelling in another case", { anything: ".HELI-HARNESS\\STATE\\YOLO.JSON" }]] : []),
	]) {
		const result = mcp(toolInput, extraEnv);
		assert.equal(result.code, "HELI_STATE_PROTECTED", `${label}: ${JSON.stringify(toolInput).slice(0, 160)}: ${result.reason}`);
		assert.match(result.reason, /protects its own authority state/);
	}
	for (const [label, toolInput] of [
		["nothing", {}],
		["plain data", { limit: 10, query: "open issues", flag: true, nothing: null }],
		["a project path", { path: "src/app.js", dir: "docs" }],
		["an owner/repo slug and a branch", { repo: "KJ-AIML/heli-harness", branch: "hardening/phase-0", target: "main" }],
		["a URL", { url: "https://example.com/.heli-harness/state/yolo.json" }],
		["prose that names Heli state", { note: "the file .heli-harness/state/yolo.json is protected" }],
		["prose that names a command", { description: "git push --force origin main", summary: "rm -rf build" }],
		["Heli narrative state", { path: ".heli-harness/state/current-task.md" }],
		["a very long string", { text: "x/".repeat(100000) }],
		["a very long string under a path key", { path: "x".repeat(100000) }],
		["a long multi-line string under a path key", { path: `${"line\n".repeat(50)}.heli-harness/state/yolo.json` }],
	]) {
		const result = mcp(toolInput);
		assert.equal(result.deny, false, `${label}: ${result.reason}`);
	}
	// A big input costs a scan of its strings, not a walk of the directories they name (hosts treat a hook that times out as an allow).
	for (const [label, toolInput] of [
		["a 2 MB string of names", { text: "ab/".repeat(700000) }],
		["a 2 MB string under a path key", { path: "a/".repeat(1000000) }],
		["5,000 paths", { files: Array.from({ length: 5000 }, (_, i) => `docs/d${i % 50}/f${i}.md`) }],
		// A directory that does not exist has nothing below it, so 500 missing levels are not 500 lookups (they were 45 ms of them on Windows).
		["500 paths of 500 missing directories each", { files: Array.from({ length: 500 }, (_, i) => `q${i}/${"a/".repeat(500)}f.md`) }],
	]) {
		const started = Date.now();
		const result = mcp(toolInput);
		assert.equal(result.deny, false, `${label}: ${result.reason}`);
		assert.ok(Date.now() - started < 5000, `${label} took ${Date.now() - started} ms (limit 5000 ms)`);
	}
	// The command rules still read the `command` of an MCP tool; a `description` is never a command.
	assert.equal(evaluate(ws, "mcp__shell__run", { command: "rm -rf build" }).code, "TIER_BLOCKED");
	assert.equal(evaluate(ws, "mcp__shell__run", { command: "git push origin main" }).code, "REMOTE_PUSH_DENIED");
	// So do the files it writes: a shell server (an MCP tool that carries a command) may not write Heli state or .env files
	// any more than Bash may. The tool is still not a shell: it is not guessed at as a write (no ownership gate), and it is
	// not refused for a missing rules file.
	for (const [command, code] of [
		["echo x > .heli-harness/state/yolo.json", "HELI_STATE_PROTECTED"],
		["cd .heli-harness/state && echo x > yolo.json", "HELI_STATE_PROTECTED"],
		["Set-Content -Path:.heli-harness/workspace/target.json x", "HELI_STATE_PROTECTED"],
		["Set-Content .env x", "ENV_WRITE_DENIED"],
		["jq '.disableAllHooks=true' .claude/settings.json | tee .claude/settings.json", "HELI_HOOKS_PROTECTED"],
	]) {
		assert.equal(evaluate(ws, "mcp__shell__run", { command }).code, code, command);
	}
	for (const command of ["ls -la", "npm test", "echo hi > out.txt", "cat .heli-harness/state/yolo.json", "Set-Content notes.txt hello"]) {
		assert.equal(evaluate(ws, "mcp__shell__run", { command }).deny, false, command);
	}
	assert.equal(evaluate(conc, "mcp__shell__run", { command: "echo x > src/app.js" }, asObserver).deny, false, "an MCP tool's command is not guessed at as a write");
	// A call that carries a command and also the text it writes to Claude settings is read for both.
	assert.equal(evaluate(ws, "mcp__shell__run", { command: "noop", path: ".claude/settings.json", content: "{\"disableAllHooks\": true}" }).code, "HELI_HOOKS_PROTECTED");
	assert.equal(evaluate(ws, "mcp__shell__run", { command: "noop", path: ".claude/settings.json", content: "{\"env\": {\"HELI_YOLO\": \"1\"}}" }).code, "HELI_STATE_PROTECTED");
	assert.equal(evaluate(ws, "mcp__shell__run", { command: "noop", path: ".claude/settings.json", content: "{\"model\": \"x\"}" }).deny, false);
	assert.equal(evaluate(ws, "mcp__shell__run", { description: "rm -rf build; git push origin main" }).deny, false);
	assert.equal(evaluate(ws, "Bash", { description: "rm -rf build" }).code, "TIER_BLOCKED", "the description fallback is unchanged for shell tools");
	// Yolo and the lease holder cannot pass the protected-state check through an MCP tool either.
	const concYolo = join(conc, ".heli-harness", "state", "yolo.json");
	for (const sessionEnv of [asOwner, { ...asOwner, HELI_YOLO: "1" }, asObserver]) {
		assert.equal(evaluate(conc, "mcp__server__do_thing", { destination: concYolo }, sessionEnv).code, "HELI_STATE_PROTECTED", JSON.stringify(sessionEnv));
	}

	// 6. The PowerShell and Monitor tools are shells: a Heli workspace whose rules file is gone cannot check their approvals.
	const noRules = workspace("no-rules", { rules: null });
	for (const toolName of ["PowerShell", "Monitor", "Bash"]) {
		const result = evaluate(noRules, toolName, { command: "Get-ChildItem" });
		assert.equal(result.code, "COMMAND_RULES_UNAVAILABLE", `${toolName}: ${result.reason}`);
	}
	assert.equal(evaluate(noRules, "mcp__server__do_thing", { command: "Get-ChildItem" }).deny, false, "an MCP tool is not a shell");
	assert.equal(evaluate(noRules, "PowerShell", { command: "rm -rf build" }).code, "TIER_BLOCKED", "the built-in floor needs no rules file");

	// 7. This test is part of `npm run check`, right after the Claude plugin smoke test.
	const checkChain = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts.check;
	assert.ok(checkChain.includes("node scripts/smoke-claude-plugin.mjs && node scripts/smoke-claude-windows-coverage.mjs && "), "smoke-claude-windows-coverage runs right after smoke-claude-plugin");

	console.log("claude windows coverage smoke ok");
} finally {
	rmSync(scratch, { recursive: true, force: true });
}
