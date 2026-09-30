#!/usr/bin/env node
/**
 * Heli protects itself from the agent it governs:
 *  - agent-run privilege commands (grants, YOLO, takeovers, Heli removal) are
 *    hard-denied in every invocation form;
 *  - `heli grant issue` / `heli yolo on` refuse to run without a human terminal;
 *  - Heli authority state is never agent-writable, whatever the path spelling;
 *  - narrative task files stay writable by their owner;
 *  - the same holds for every shell form that writes a file, for Windows and Git Bash
 *    spellings, links, `cd` chains and environment variables in paths;
 *  - Claude settings that turn Heli off are refused, and `.env` writes need their grant;
 *  - reading a command's write targets stays inside the analysis time budget.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMMAND_ANALYSIS_LIMITS, analyzeCommand, evaluateCommandRules, shellWriteTargets } from "../.heli-harness/adapters/shared/command-policy.mjs";
import { evaluatePreToolUse } from "../.heli-harness/adapters/shared/hook-core.mjs";
import { classifyShellWriteTargets, classifyToolPaths, disablesClaudeHooks, normalizePolicyPath } from "../.heli-harness/adapters/shared/concurrency/protected-paths.mjs";
import { createTask } from "../lib/concurrency/task.mjs";
import { createSession, attachSession } from "../lib/concurrency/session.mjs";
import { acquireWriteLease } from "../lib/concurrency/lease.mjs";
import { issueGrant, listGrants } from "../lib/concurrency/grant.mjs";
import { projectWorkspaceKey } from "../lib/concurrency/project-binding.mjs";
import { isTaskStateWriteForContext, resolveExecutionContext } from "../lib/concurrency/resolve.mjs";
import { runGrant } from "../lib/cli/grant.mjs";
import { assertHumanTerminal } from "../lib/cli/human-gate.mjs";
import { runYolo } from "../lib/cli/yolo.mjs";
import { scrubHeliProcessEnv } from "./lib/hermetic-env.mjs";

scrubHeliProcessEnv();
const root = process.cwd();
const heli = join(root, "bin", "heli.mjs");
const scratch = mkdtempSync(join(tmpdir(), "heli-self-protection-"));
const hostHome = join(scratch, "home");
const env = {
	...process.env,
	HELI_CONFIG_DIR: join(scratch, "config"),
	HELI_DATA_DIR: join(scratch, "data"),
	HELI_HOST_HOME: hostHome,
};
const shippedRules = readFileSync(join(root, ".heli-harness", "safety", "command-rules.json"), "utf8");
const HUMAN = { stdin: true, stdout: true };

function workspace(name, { concurrent = false } = {}) {
	const dir = join(scratch, name);
	mkdirSync(join(dir, ".heli-harness", "safety"), { recursive: true });
	mkdirSync(join(dir, ".heli-harness", "state"), { recursive: true });
	writeFileSync(join(dir, ".heli-harness", "HARNESS.md"), "# Heli\n");
	writeFileSync(join(dir, ".heli-harness", "safety", "command-rules.json"), shippedRules);
	writeFileSync(join(dir, ".heli-harness", "state", "current-task.md"), "# Current Task\n\nTarget repo: demo\n\nCurrent status: in progress\n\nFailed attempts count: 0\n");
	if (concurrent) {
		mkdirSync(join(dir, ".heli-harness", "workspace"), { recursive: true });
		writeFileSync(join(dir, ".heli-harness", "workspace", "schema.json"), JSON.stringify({ schemaVersion: 1, mode: "concurrent" }));
	}
	return dir;
}

function evaluate(cwd, toolName, toolInput, extraEnv = {}) {
	return evaluatePreToolUse({ cwd, host: "test", env: { ...env, ...extraEnv }, toolName, toolInput });
}

try {
	const legacy = workspace("legacy");

	// 1. Agent-run privilege commands are hard-denied in every invocation form.
	const privileged = [
		"heli grant issue --action git.push --scope once",
		"heli grant --json issue --action git.push",
		"node .heli-harness/heli.mjs grant issue --action git.push",
		"node C:\\tools\\heli\\bin\\heli.mjs grant issue --action git.push",
		"npx heli-harness grant issue --action git.push",
		"npx -y github:KJ-AIML/heli-harness#main yolo on",
		"heli-harness yolo on",
		"heli yolo on",
		"heli yolo enable --hours 4",
		"heli task takeover t1 --confirm",
		"heli task release t1 --force",
		"heli task create t2 --yolo",
		"heli task create t2 --mode yolo",
		"heli session start --task t1 --yolo",
		"heli session attach t1 --yolo",
		"heli session transfer-write heli-ses-child",
		"heli host remove claude",
		"heli uninstall",
		"echo ok && heli grant issue --action env.write",
		"bash -c 'heli yolo on'",
		"pwsh -Command \"heli grant issue --action git.push\"",
		"claude plugin uninstall heli-harness@heli-harness",
		"claude plugin disable heli-harness@heli-harness",
		"codex plugin remove heli-harness@heli-harness",
		"grok plugin uninstall heli-harness",
		"pi remove heli-harness",
	];
	for (const command of privileged) {
		for (const extraEnv of [{}, { HELI_YOLO: "1", HELI_ALLOW_COMMAND: "heli-privileged-command,heli-host-integration-removal" }]) {
			const result = evaluate(legacy, "Bash", { command }, extraEnv);
			assert.equal(result.deny, true, `${command} must be denied (${JSON.stringify(extraEnv)})`);
			assert.equal(result.code, "TIER_BLOCKED", `${command}: ${result.reason}`);
			assert.match(result.reason, /human in their own terminal/, command);
		}
	}
	for (const command of ["heli grant list", "heli grant revoke heli-grant-x", "heli yolo off", "heli yolo status", "heli task claim t1 --mode write", "heli task create t2", "heli status", "heli host status", "heli doctor", "cd .heli-harness && ls"]) {
		const result = evaluate(legacy, "Bash", { command });
		assert.equal(result.deny, false, `${command}: ${result.reason}`);
	}

	// 2. The CLI refuses grant issue / yolo on without a human terminal.
	const cliEnv = { ...env };
	const grantCli = spawnSync(process.execPath, [heli, "grant", "issue", "--action", "git.push", legacy], { encoding: "utf8", env: cliEnv });
	assert.equal(grantCli.status, 1, grantCli.stdout);
	assert.match(grantCli.stderr, /interactive terminal/);
	assert.match(grantCli.stderr, /HUMAN_TERMINAL_REQUIRED/);
	assert.equal(listGrants(legacy, { env }).length, 0, "a refused grant issue must not create a grant");
	const yoloCli = spawnSync(process.execPath, [heli, "yolo", "on", legacy], { encoding: "utf8", env: cliEnv });
	assert.equal(yoloCli.status, 1, yoloCli.stdout);
	assert.match(yoloCli.stderr, /interactive terminal/);
	assert.equal(existsSync(join(legacy, ".heli-harness", "state", "yolo.json")), false);
	// Test seam: an explicit terminal argument (not an env var) stands in for a human.
	const previousConfig = process.env.HELI_CONFIG_DIR;
	const previousData = process.env.HELI_DATA_DIR;
	process.env.HELI_CONFIG_DIR = env.HELI_CONFIG_DIR;
	process.env.HELI_DATA_DIR = env.HELI_DATA_DIR;
	try {
		runGrant(["issue", "--action", "git.push", legacy], { terminal: HUMAN });
		assert.equal(listGrants(legacy, { env }).length, 1);
		assert.throws(() => runGrant(["issue", "--action", "git.push", legacy], { terminal: { stdin: false, stdout: true } }), (error) => error.code === "HUMAN_TERMINAL_REQUIRED");
		const yoloDir = workspace("yolo-seam");
		runYolo(["on", yoloDir], { terminal: HUMAN });
		assert.ok(existsSync(join(yoloDir, ".heli-harness", "state", "yolo.json")));
	} finally {
		if (previousConfig === undefined) delete process.env.HELI_CONFIG_DIR;
		else process.env.HELI_CONFIG_DIR = previousConfig;
		if (previousData === undefined) delete process.env.HELI_DATA_DIR;
		else process.env.HELI_DATA_DIR = previousData;
	}

	// 3. current-task.md is narrative: its Mode field no longer enables YOLO.
	const modeYolo = workspace("mode-yolo");
	writeFileSync(join(modeYolo, ".heli-harness", "state", "current-task.md"), "# Current Task\n\nMode: yolo\n\nCurrent status: in progress\n");
	assert.equal(evaluate(modeYolo, "Bash", { command: "git push origin main" }).code, "REMOTE_PUSH_DENIED");

	// 4. Protected state paths in a concurrent workspace with an owner and an observer.
	const ws = workspace("concurrent", { concurrent: true });
	createTask(ws, { taskId: "t1", repositoryId: "demo", worktreePath: ws });
	createSession(ws, { sessionId: "owner", mode: "write", worktreePath: ws });
	attachSession(ws, "owner", "t1", { mode: "write", worktreePath: ws });
	acquireWriteLease(ws, { taskId: "t1", sessionId: "owner", worktreePath: ws });
	createSession(ws, { sessionId: "observer", mode: "observe", worktreePath: ws });
	attachSession(ws, "observer", "t1", { mode: "observe", worktreePath: ws });
	const asOwner = { HELI_SESSION_ID: "owner" };
	const asObserver = { HELI_SESSION_ID: "observer" };
	const write = (cwd, filePath, sessionEnv, content = "x") => evaluate(cwd, "Write", { file_path: filePath, content }, sessionEnv);

	const authorityFiles = [
		".heli-harness/tasks/t1/task.json",
		".heli-harness/tasks/t1/yolo.json",
		".heli-harness/tasks/t1/events.jsonl",
		".heli-harness/tasks/t1/diagnosis.json",
		".heli-harness/sessions/owner.json",
		".heli-harness/locks/tasks/t1.write.lock/lease.json",
		".heli-harness/bindings/worktrees/abc.json",
		".heli-harness/state/yolo.json",
		".heli-harness/workspace/target.json",
		".heli-harness/workspace/schema.json",
		".heli-harness/tasks/t1/yolo.json:hidden",
		"./.heli-harness/./tasks/t1/../t1/yolo.json",
		join(ws, ".heli-harness", "tasks", "t1", "yolo.json"),
		join(env.HELI_CONFIG_DIR, "policy.json"),
		join(env.HELI_DATA_DIR, "grants", "workspaces", "x", "grants.json"),
		join(hostHome, ".grok", "hooks", "heli-harness.json"),
		join(hostHome, ".cursor", "plugins", "local", "heli-harness", "hooks.json"),
	];
	if (process.platform === "win32") {
		authorityFiles.push(".HELI-HARNESS\\TASKS\\T1\\YOLO.JSON", `\\\\?\\${join(ws, ".heli-harness", "tasks", "t1", "yolo.json")}`);
	}
	for (const filePath of authorityFiles) {
		for (const sessionEnv of [asObserver, asOwner, { ...asOwner, HELI_YOLO: "1" }]) {
			const result = write(ws, filePath, sessionEnv);
			assert.equal(result.code, "HELI_STATE_PROTECTED", `${filePath} (${JSON.stringify(sessionEnv)}): ${result.reason}`);
			assert.match(result.reason, /protects its own authority state/);
		}
	}

	// A symlink/junction into Heli state is resolved before classification.
	const link = join(ws, "innocent-dir");
	symlinkSync(join(ws, ".heli-harness", "tasks", "t1"), link, process.platform === "win32" ? "junction" : "dir");
	assert.equal(write(ws, "innocent-dir/yolo.json", asOwner).code, "HELI_STATE_PROTECTED");

	// `..` no longer rides the task-state exemption past the ownership gate.
	const escaped = write(ws, ".heli-harness/tasks/../../src/app.js", asObserver);
	assert.equal(escaped.deny, true);
	assert.equal(escaped.code, "NOT_WRITE_MODE");

	// Narrative files stay writable by the task owner (Review Focus).
	for (const filePath of [".heli-harness/tasks/t1/current-task.md", ".heli-harness/tasks/t1/plan.md", ".heli-harness/tasks/t1/reports/run.json", ".heli-harness/state/current-task.md"]) {
		const result = write(ws, filePath, asOwner);
		assert.equal(result.deny, false, `${filePath}: ${result.reason}`);
	}
	assert.equal(write(ws, "src/app.js", asOwner).deny, false, "the lease holder still writes source files");

	// 5. Claude settings: turning hooks (or the Heli plugin) off is denied; other edits are fine.
	assert.equal(write(ws, ".claude/settings.local.json", asOwner, JSON.stringify({ disableAllHooks: true })).code, "HELI_HOOKS_PROTECTED");
	assert.equal(evaluate(ws, "Edit", { file_path: join(hostHome, ".claude", "settings.json"), old_string: "\"x\": 1", new_string: "\"disableAllHooks\": true" }, asOwner).code, "HELI_HOOKS_PROTECTED");
	assert.equal(write(ws, ".claude/settings.json", asOwner, JSON.stringify({ enabledPlugins: { "heli-harness@heli-harness": false } })).code, "HELI_HOOKS_PROTECTED");
	assert.equal(write(ws, ".claude/settings.json", asOwner, JSON.stringify({ permissions: { allow: ["Bash(npm test)"] } })).deny, false);

	// 6. Shell writes are checked by their targets.
	const shell = (command) => evaluate(legacy, "Bash", { command });
	assert.equal(shell("echo SECRET=1 > .env").code, "ENV_WRITE_DENIED");
	assert.equal(shell("printf x >> apps/api/.env.local").code, "ENV_WRITE_DENIED");
	assert.equal(shell("Set-Content -Path .env -Value x").code, "ENV_WRITE_DENIED");
	for (const command of [
		"echo '{\"enabled\":true}' > .heli-harness/state/yolo.json",
		"Set-Content -Path .heli-harness/tasks/t1/task.json -Value x",
		"cp /tmp/forged.json .heli-harness/tasks/t1/task.json",
		"cd .heli-harness/tasks/t1 && echo '{\"enabled\":true}' > yolo.json",
		"rm .heli-harness/sessions/owner.json",
		`tee "${join(env.HELI_CONFIG_DIR, "policy.json")}" < forged.json`,
	]) {
		assert.equal(shell(command).code, "HELI_STATE_PROTECTED", command);
	}
	// `~` expands to the shell's home directory.
	const tildeHook = evaluate(legacy, "Bash", { command: "tee ~/.grok/hooks/heli-harness.json < forged.json" }, { HOME: hostHome, USERPROFILE: hostHome });
	assert.equal(tildeHook.code, "HELI_STATE_PROTECTED", tildeHook.reason);
	assert.equal(shell("echo '{\"disableAllHooks\": true}' > .claude/settings.local.json").code, "HELI_HOOKS_PROTECTED");
	for (const command of ["echo ok > notes.txt", "cat .heli-harness/state/current-task.md", "echo note >> .heli-harness/state/current-task.md", "ls 2>&1 > build.log"]) {
		assert.equal(shell(command).deny, false, `${command}: ${shell(command).reason}`);
	}

	// 7. Every way to start the Heli CLI is read, quoted command lines included; text that only mentions it is not.
	const privilegeRules = (dir, command) =>
		evaluateCommandRules(dir, command, env).hardDenies.filter((match) => match.id === "heli-privileged-command" || match.id === "heli-host-integration-removal");
	for (const command of [
		"pnpm dlx heli-harness grant issue --action git.push",
		"bunx heli-harness yolo on",
		"yarn dlx heli-harness yolo on",
		"npm exec heli-harness -- yolo on",
		"deno run -A npm:heli-harness yolo on",
		"bun .heli-harness/heli.mjs yolo on",
		"./node_modules/.bin/heli yolo on",
		"\"C:\\Program Files\\nodejs\\node.exe\" .heli-harness\\heli.mjs grant issue --action git.push",
		"heli.cmd yolo on",
		"heli.ps1 grant issue --action git.push",
		"sudo heli yolo on",
		"env HELI_X=1 heli yolo on",
		"time heli grant issue --action git.push",
		"heli task create t2 --mode strict --mode yolo",
		"heli task create t2 --mode=yolo",
		"heli task create t2 --mode unguarded",
		"heli task release --confirm",
		"ssh host 'heli yolo on'",
		"su -c 'node .heli-harness/heli.mjs yolo on'",
		"docker exec c sh -c 'heli grant issue --action git.push'",
		"watch 'heli yolo on'",
		"ssh host 'npx heli-harness yolo on'",
		"ssh host 'pnpm dlx heli-harness yolo on'",
		"su -c 'claude plugin uninstall heli-harness@heli-harness'",
		"ssh host 'pi remove heli-harness'",
		"sudo -s 'codex plugin remove heli-harness@heli-harness'",
		"claude plugin marketplace remove heli-harness",
		"axga remove heli-harness",
	]) {
		assert.ok(privilegeRules(legacy, command).length > 0, command);
	}
	// A few of them through the whole hook, YOLO and HELI_ALLOW_COMMAND included.
	for (const command of ["pnpm dlx heli-harness grant issue --action git.push", "heli task create t2 --mode strict --mode yolo", "ssh host 'heli yolo on'", "su -c 'claude plugin uninstall heli-harness@heli-harness'"]) {
		for (const extraEnv of [{}, { HELI_YOLO: "1", HELI_ALLOW_COMMAND: "heli-privileged-command,heli-host-integration-removal" }]) {
			const result = evaluate(legacy, "Bash", { command }, extraEnv);
			assert.equal(result.code, "TIER_BLOCKED", `${command}: ${result.reason}`);
			assert.match(result.reason, /human in their own terminal/, command);
		}
	}
	// The built-in rules stand on their own: a workspace whose rules file lists nothing reads the same quoted command lines.
	const bareRules = workspace("bare-rules");
	writeFileSync(join(bareRules, ".heli-harness", "safety", "command-rules.json"), JSON.stringify({ version: 1, rules: [] }));
	for (const command of [
		"ssh host 'heli yolo on'",
		"ssh host 'heli-harness grant issue --action git.push'",
		"su -c 'node .heli-harness/heli.mjs yolo on'",
		"ssh host 'npx heli-harness yolo on'",
		"ssh host 'npm exec heli-harness -- yolo on'",
		"ssh host 'pnpm dlx heli-harness yolo on'",
		"ssh host 'pnpx heli-harness yolo on'",
		"ssh host 'yarn dlx heli-harness yolo on'",
		"ssh host 'bunx heli-harness yolo on'",
		"ssh host 'bun .heli-harness/heli.mjs yolo on'",
		"ssh host 'deno run -A npm:heli-harness yolo on'",
		"ssh host './.heli-harness/heli.mjs yolo on'",
		"su -c 'claude plugin uninstall heli-harness@heli-harness'",
		"ssh host 'codex plugin remove heli-harness@heli-harness'",
		"ssh host 'grok plugin uninstall heli-harness'",
		"ssh host 'cursor plugin remove heli-harness'",
		"ssh host 'opencode plugin uninstall heli-harness'",
		"ssh host 'kimi plugin disable heli-harness'",
		"ssh host 'pi remove heli-harness'",
		"ssh host 'axga remove heli-harness'",
	]) {
		assert.ok(privilegeRules(bareRules, command).length > 0, command);
	}
	assert.equal(evaluate(bareRules, "Bash", { command: "ssh host 'pnpm dlx heli-harness yolo on'" }).code, "TIER_BLOCKED");
	for (const command of [
		"heli task create t2 --mode strict",
		"ssh host 'heli status'",
		"echo 'heli grant issue is blocked'",
		"git commit -m \"docs: heli yolo on needs a terminal\"",
		"grep -rn 'heli grant issue' docs",
		"claude plugin list",
		"claude plugin install heli-harness@heli-harness",
		"pi list",
		"cat .heli-harness/heli.mjs",
		"node --check .heli-harness/heli.mjs",
		"cd D:/repos/heli-harness && npm test",
		"npm install -g heli-harness",
	]) {
		const result = evaluate(legacy, "Bash", { command });
		assert.equal(result.deny, false, `${command}: ${result.reason}`);
	}

	// 8. The gate wants both streams to be a TTY and has no environment bypass; read-only and revoking commands stay scriptable.
	for (const terminal of [{ stdin: true, stdout: false }, { stdin: false, stdout: true }, {}, null, { stdin: "true", stdout: "true" }, { stdin: 1, stdout: 1 }]) {
		assert.throws(
			() => assertHumanTerminal("heli yolo on", terminal),
			(error) => error.code === "HUMAN_TERMINAL_REQUIRED" && error.message.includes("`heli yolo on` must be run by a human"),
			JSON.stringify(terminal),
		);
	}
	assert.doesNotThrow(() => assertHumanTerminal("heli yolo on", HUMAN));
	const bypassAttempt = { ...env, HELI_YOLO: "1", HELI_GUARDS: "off", HELI_ALLOW_COMMAND: "heli-privileged-command", HELI_HUMAN: "1", HELI_TERMINAL: "1", FORCE_TTY: "1", CI: "1", TERM: "xterm" };
	for (const args of [["grant", "issue", "--action", "git.push", legacy], ["yolo", "on", legacy], ["yolo", "enable", legacy]]) {
		const refused = spawnSync(process.execPath, [heli, ...args], { encoding: "utf8", env: bypassAttempt });
		assert.equal(refused.status, 1, `${args.join(" ")}: ${refused.stdout}`);
		assert.match(refused.stderr, /HUMAN_TERMINAL_REQUIRED/, args.join(" "));
	}
	assert.equal(listGrants(legacy, { env }).length, 1, "the refused commands issued nothing");
	assert.equal(existsSync(join(legacy, ".heli-harness", "state", "yolo.json")), false);
	for (const args of [["yolo", "status", legacy], ["yolo", "off", legacy], ["grant", "list", legacy]]) {
		const ran = spawnSync(process.execPath, [heli, ...args], { encoding: "utf8", env });
		assert.equal(ran.status, 0, `${args.join(" ")}: ${ran.stderr}`);
	}

	// 9. Narrative task files stay writable by their owner; another task's files, mixed patches and authority files do not.
	createTask(ws, { taskId: "t2", repositoryId: "demo", worktreePath: ws, allowDuplicate: true });
	const patch = (...files) => `*** Begin Patch\n${files.map((file) => `*** Update File: ${file}\n@@\n-a\n+b`).join("\n")}\n*** End Patch\n`;
	const applyPatch = (files, sessionEnv) => evaluate(ws, "apply_patch", { command: patch(...files) }, sessionEnv);
	for (const filePath of [".heli-harness/tasks/t1/decisions.md", ".heli-harness/tasks/t1/runs/2026-09-30.md", ".heli-harness/state/plan.md", ".heli-harness/state/decisions.md", ".heli-harness/state/reports/r.md", ".heli-harness/state/runs/r.md"]) {
		const result = write(ws, filePath, asOwner);
		assert.equal(result.deny, false, `${filePath}: ${result.reason}`);
	}
	assert.equal(write(ws, ".heli-harness/tasks/t1/plan.md", asObserver).deny, false, "an observer may keep its own task's notes");
	assert.equal(write(ws, ".heli-harness/state/plan.md", asObserver).deny, false, "the shared ledger stays open");
	assert.equal(write(ws, ".heli-harness/tasks/t2/plan.md", asObserver).code, "NOT_WRITE_MODE", "another task's notes are not its own");
	assert.equal(write(ws, ".heli-harness/tasks/t2/plan.md", asOwner).deny, false, "the writer may");
	assert.equal(applyPatch([".heli-harness/tasks/t1/plan.md"], asObserver).deny, false);
	assert.equal(applyPatch([".heli-harness/tasks/t1/plan.md", "src/app.js"], asObserver).code, "NOT_WRITE_MODE", "a mixed patch still faces the ownership gate");
	assert.equal(applyPatch([".heli-harness/tasks/t1/plan.md", ".heli-harness/tasks/t1/yolo.json"], asOwner).code, "HELI_STATE_PROTECTED", "one protected file in a patch is enough");
	assert.equal(evaluate(ws, "apply_patch", { command: "*** Begin Patch\n*** Add File: .heli-harness/tasks/t1/yolo.json\n+{\"enabled\":true}\n*** End Patch\n" }, asOwner).code, "HELI_STATE_PROTECTED");
	assert.equal(evaluate(ws, "apply_patch", { command: "*** Begin Patch\n*** Update File: notes.md\n*** Move to: .heli-harness/tasks/t1/task.json\n*** End Patch\n" }, asObserver).code, "HELI_STATE_PROTECTED", "a patch that renames a file into Heli state");
	// Relative paths are read from the hook's cwd, not from the workspace root.
	mkdirSync(join(ws, "src"), { recursive: true });
	assert.equal(evaluate(join(ws, "src"), "Write", { file_path: "../.heli-harness/tasks/t1/yolo.json", content: "x" }, asOwner).code, "HELI_STATE_PROTECTED");
	assert.equal(evaluate(join(ws, "src"), "Write", { file_path: "../.heli-harness/tasks/t1/plan.md", content: "x" }, asObserver).deny, false);
	// Pi's two-argument call (it passes neither cwd nor env) and the option form.
	const ownerCtx = resolveExecutionContext({ cwd: ws, environment: { ...env, ...asOwner }, createIfMissing: false });
	assert.equal(isTaskStateWriteForContext(ownerCtx, [join(ws, ".heli-harness", "tasks", "t1", "plan.md")]), true);
	assert.equal(isTaskStateWriteForContext(ownerCtx, [join(ws, ".heli-harness", "tasks", "t1", "yolo.json")]), false);
	assert.equal(isTaskStateWriteForContext(ownerCtx, [join(ws, ".heli-harness", "tasks", "t2", "plan.md")]), false, "another task's notes");
	assert.equal(isTaskStateWriteForContext(ownerCtx, [".heli-harness/tasks/t1/plan.md"], { cwd: ws, env }), true);
	assert.equal(isTaskStateWriteForContext(ownerCtx, [".heli-harness/tasks/t1/plan.md", "src/app.js"], { cwd: ws, env }), false);
	assert.equal(isTaskStateWriteForContext(ownerCtx, []), false);
	assert.equal(isTaskStateWriteForContext({ workspaceRoot: null }, ["notes.md"]), false);
	// Every place Heli installs host hooks, including the directory the user names for Antigravity.
	for (const hookFile of [
		join(hostHome, ".config", "opencode", "plugins", "heli-harness.js"),
		join(hostHome, ".config", "opencode", "plugins", "heli-harness-bundle", "plugin.json"),
	]) {
		assert.equal(write(ws, hookFile, asOwner).code, "HELI_STATE_PROTECTED", hookFile);
	}
	const antigravityDir = join(scratch, "antigravity-plugins");
	const antigravityFile = join(antigravityDir, "heli-harness", "hooks.json");
	assert.equal(write(ws, antigravityFile, asOwner).deny, false, "only once the user says where Antigravity lives");
	assert.equal(write(ws, antigravityFile, { ...asOwner, HELI_ANTIGRAVITY_PLUGIN_DIR: antigravityDir }).code, "HELI_STATE_PROTECTED");
	// The legacy diagnosis records are authority too.
	for (const stateFile of ["diagnosis.json", "diagnosis-events.jsonl", "yolo.json"]) {
		assert.equal(evaluate(legacy, "Write", { file_path: `.heli-harness/state/${stateFile}`, content: "x" }).code, "HELI_STATE_PROTECTED", stateFile);
	}
	// A link to the whole state root is followed for shell writes as well as file tools.
	const rootLink = join(ws, "state-link");
	symlinkSync(join(ws, ".heli-harness"), rootLink, process.platform === "win32" ? "junction" : "dir");
	assert.equal(write(ws, "state-link/state/yolo.json", asOwner).code, "HELI_STATE_PROTECTED");
	assert.equal(write(ws, "state-link/tasks/t1/plan.md", asOwner).deny, false, "narrative through the link stays narrative");
	assert.equal(evaluate(ws, "Bash", { command: "echo x > state-link/sessions/owner.json" }, asOwner).code, "HELI_STATE_PROTECTED");
	assert.equal(evaluate(ws, "Bash", { command: "cd state-link && echo x > sessions/owner.json" }, asOwner).code, "HELI_STATE_PROTECTED", "a cd through the link");
	// A link inside Heli state that leads elsewhere (a tasks/ folder moved to another disk) still names Heli state.
	const linkKind = process.platform === "win32" ? "junction" : "dir";
	const relocated = workspace("relocated");
	mkdirSync(join(scratch, "moved-tasks", "t1"), { recursive: true });
	mkdirSync(join(scratch, "moved-sessions"), { recursive: true });
	symlinkSync(join(scratch, "moved-tasks"), join(relocated, ".heli-harness", "tasks"), linkKind);
	symlinkSync(join(scratch, "moved-sessions"), join(relocated, ".heli-harness", "sessions"), linkKind);
	assert.equal(evaluate(relocated, "Write", { file_path: ".heli-harness/tasks/t1/yolo.json", content: "x" }).code, "HELI_STATE_PROTECTED");
	assert.equal(evaluate(relocated, "Write", { file_path: ".heli-harness/sessions/owner.json", content: "x" }).code, "HELI_STATE_PROTECTED");
	assert.equal(evaluate(relocated, "Bash", { command: "echo x > .heli-harness/tasks/t1/task.json" }).code, "HELI_STATE_PROTECTED");
	assert.equal(classifyToolPaths([".heli-harness/tasks/t1/plan.md"], { workspaceRoot: relocated, cwd: relocated, env })[0].kind, "other", "notes that live elsewhere are not exempt");

	// 10. Every shell form that writes, moves, links or deletes a file is read by the paths it names.
	const homeEnv = { HOME: hostHome, USERPROFILE: hostHome };
	const writeKinds = (command, { cwd = legacy, extraEnv = {} } = {}) =>
		new Set(classifyShellWriteTargets(shellWriteTargets(analyzeCommand(command)), { workspaceRoot: legacy, cwd, env: { ...env, ...extraEnv } }).map((entry) => entry.kind));
	for (const command of [
		"echo x 1> .heli-harness/state/yolo.json",
		"echo x >> .heli-harness/state/yolo.json",
		"echo x &> .heli-harness/state/yolo.json",
		"echo x >& .heli-harness/state/yolo.json",
		"echo x >&.heli-harness/state/yolo.json",
		"echo x > \".heli-harness/state/yolo.json\"",
		"echo x > '.heli-harness/state/yolo.json'",
		"echo '{}' | tee -a .heli-harness/tasks/t1/task.json",
		"sed -i 's/false/true/' .heli-harness/tasks/t1/yolo.json",
		"sed --in-place=.bak s/a/b/ .heli-harness/tasks/t1/task.json",
		"perl -pi -e 's/a/b/' .heli-harness/tasks/t1/events.jsonl",
		"dd if=forged.json of=.heli-harness/state/yolo.json",
		"install -m 644 forged.json .heli-harness/tasks/t1/task.json",
		"mv forged.json .heli-harness/tasks/t1/task.json",
		"truncate -s 0 .heli-harness/tasks/t1/events.jsonl",
		"touch .heli-harness/state/yolo.json",
		"ln -s ../forged .heli-harness/tasks/t1/task.json",
		"cat > .heli-harness/state/yolo.json <<'EOF'\n{\"enabled\":true}\nEOF",
		"'{}' | Set-Content .heli-harness/tasks/t1/task.json",
		"Out-File -FilePath .heli-harness/state/yolo.json -InputObject x",
		"Add-Content -Path .heli-harness/state/yolo.json -Value x",
		"Copy-Item forged.json .heli-harness/tasks/t1/task.json",
		"Move-Item forged.json .heli-harness/tasks/t1/task.json",
		"Remove-Item .heli-harness/sessions/owner.json",
		"Clear-Content .heli-harness/tasks/t1/events.jsonl",
		"New-Item -ItemType File -Path .heli-harness/state/yolo.json",
		"bash -c 'echo x > .heli-harness/state/yolo.json'",
		"sh -c \"tee .heli-harness/state/yolo.json < forged.json\"",
		"cmd /c \"echo x > .heli-harness\\state\\yolo.json\"",
		"cmd /c copy forged.json .heli-harness\\tasks\\t1\\task.json",
		"pwsh -Command \"Set-Content .heli-harness/state/yolo.json x\"",
		"su -c 'echo x > .heli-harness/state/yolo.json'",
		"env FOO=1 tee .heli-harness/state/yolo.json",
		"sudo tee .heli-harness/state/yolo.json",
		// A rename names the new file next to the old one, and a link is a second name for the same file.
		"Rename-Item -Path .heli-harness/tasks/t1/plan.md -NewName yolo.json",
		"Rename-Item .heli-harness/tasks/t1/plan.md task.json",
		"rename-item -NewName yolo.json -Path .heli-harness/tasks/t1/plan.md",
		"ren .heli-harness\\tasks\\t1\\plan.md task.json",
		"mklink /H hard.json .heli-harness\\tasks\\t1\\yolo.json",
		"New-Item -ItemType HardLink -Path hard.json -Target .heli-harness/tasks/t1/yolo.json",
		"robocopy forged .heli-harness/tasks/t1 yolo.json",
		"xcopy /y forged.json .heli-harness\\tasks\\t1\\",
		// The directory a `cd` chain leads to, in every spelling of cd.
		"cd .heli-harness && cd tasks/t1 && echo x > yolo.json",
		"cd -P .heli-harness/tasks/t1 && echo x > task.json",
		"cd -- .heli-harness/tasks/t1 && echo x > task.json",
		"Set-Location -Path .heli-harness/tasks/t1; Set-Content yolo.json x",
		"Set-Location -LiteralPath .heli-harness/tasks/t1; Set-Content yolo.json x",
		"sl .heli-harness/tasks/t1; sc yolo.json x",
		"pushd .heli-harness/sessions && rm owner.json",
		"cd .heli-harness/tasks && cp forged.json t1/task.json",
		"cd /d .heli-harness\\tasks\\t1 & echo x> yolo.json",
		// Case-sensitive file systems: a harmless spelling first must not hide the real one after it.
		"rm .HELI-HARNESS/sessions/x.json; rm .heli-harness/sessions/owner.json",
	]) {
		assert.ok(writeKinds(command).has("authority"), command);
	}
	for (const [command, extraEnv] of [
		["cd ~/.grok/hooks && tee heli-harness.json < forged.json", homeEnv],
		["cd && tee .grok/hooks/heli-harness.json < forged.json", homeEnv],
		["tee $HOME/.grok/hooks/heli-harness.json < forged.json", homeEnv],
		["tee ${HOME}/.grok/hooks/heli-harness.json < forged.json", homeEnv],
		["Set-Content -Path $env:USERPROFILE/.grok/hooks/heli-harness.json -Value x", homeEnv],
		["tee %USERPROFILE%/.grok/hooks/heli-harness.json < forged.json", homeEnv],
		["tee $HELI_CONFIG_DIR/policy.json < forged.json", {}],
		["tee ${HELI_DATA_DIR}/grants/workspaces/x/grants.json < forged.json", {}],
		["Set-Content -Path $env:HELI_CONFIG_DIR/policy.json -Value x", {}],
		["echo x > %HELI_CONFIG_DIR%\\policy.json", {}],
		["tee $PWD/.heli-harness/state/yolo.json < forged.json", {}],
	]) {
		assert.ok(writeKinds(command, { extraEnv }).has("authority"), command);
	}
	for (const command of [
		"echo ok > notes.txt",
		"cat .heli-harness/tasks/t1/task.json",
		"cat .heli-harness/tasks/t1/task.json > /tmp/task-copy.json",
		"cp .heli-harness/tasks/t1/plan.md /tmp/plan.bak",
		"echo note >> .heli-harness/tasks/t1/current-task.md",
		"echo x > .heli-harness/tasks/t1/reports/run.json",
		"rm .heli-harness/tasks/t1/reports/old.json",
		"mkdir -p .heli-harness/tasks/t1/reports",
		"ls .heli-harness/tasks/t1",
		"ls 2>&1 > build.log",
		"echo hi 2>&1",
		"echo hi >&2",
		"echo hi > /dev/null",
		"sed -n p .heli-harness/tasks/t1/task.json",
		"sed -i s/a/b/ src/app.js",
		"git status > status.txt",
		"cd src && echo x > out.txt",
		"cd .. && echo x > out.txt",
		"echo \"a > b\"",
	]) {
		assert.ok(!writeKinds(command).has("authority"), command);
	}
	// What the redirect reader takes for a target.
	const targetsOf = (command) => [...new Set(shellWriteTargets(analyzeCommand(command)).map((target) => target.path))].sort();
	for (const [command, expected] of [
		["echo x > a", ["a"]],
		["echo x >> a", ["a"]],
		["echo x >a", ["a"]],
		["echo x 1>a", ["a"]],
		["echo x 2> a", ["a"]],
		["echo x &> a", ["a"]],
		["echo x >& a", ["a"]],
		["echo x >&a", ["a"]],
		["echo x *> a", ["a"]],
		["echo x > \"a b\"", ["a b"]],
		["echo x > 'a b'", ["a b"]],
		["echo x 2>&1", []],
		["echo x >&2", []],
		["echo x 2>&-", []],
		["echo x > /dev/null", []],
		["echo x 2>/dev/null", []],
		["echo x > NUL", []],
		["echo x > $null", []],
		["ls 2>&1 > build.log", ["build.log"]],
		["cat < in.txt", []],
		["cat <<EOF > out.txt", ["out.txt"]],
		["tee a b", ["a", "b"]],
		["cp -r a b", ["a", "b"]],
		["rm -f a", ["a"]],
		["sed -n p f", []],
		["sed -i s/a/b/ f", ["f", "s/a/b/"]],
		["dd if=a of=b", ["b"]],
		["DD OF=b", ["b"]],
		["ls -la", []],
		["cat f", []],
	]) {
		assert.deepEqual(targetsOf(command), [...expected].sort(), command);
	}
	// On a case-sensitive file system `rm .HELI/x; rm .heli/x` names two files, and both are read.
	assert.deepEqual(targetsOf("rm .HELI-HARNESS/sessions/x.json; rm .heli-harness/sessions/x.json"), [".HELI-HARNESS/sessions/x.json", ".heli-harness/sessions/x.json"]);
	// Through the whole hook.
	for (const command of [
		"echo x >& .heli-harness/state/yolo.json",
		"Rename-Item -Path .heli-harness/tasks/t1/plan.md -NewName yolo.json",
		"cd -P .heli-harness/tasks/t1 && echo x > task.json",
		"sed -i s/a/b/ .heli-harness/tasks/t1/yolo.json",
		"mklink /H hard.json .heli-harness\\tasks\\t1\\yolo.json",
	]) {
		assert.equal(shell(command).code, "HELI_STATE_PROTECTED", command);
	}

	// 11. One file, many spellings. Windows shells drop trailing dots and spaces, accept NT prefixes and
	// streams, and Git Bash writes `/c/...`; a file system that is case-sensitive keeps its own cases.
	const yoloFile = join(ws, ".heli-harness", "tasks", "t1", "yolo.json");
	const planFile = join(ws, ".heli-harness", "tasks", "t1", "plan.md");
	if (process.platform === "win32") {
		const slashed = yoloFile.replaceAll("\\", "/");
		const gitBash = `/${yoloFile[0].toLowerCase()}${slashed.slice(2)}`;
		const spellings = [
			`${yoloFile}.`,
			`${yoloFile}...`,
			`${yoloFile}::$DATA`,
			`\\??\\${yoloFile}`,
			`\\\\.\\${yoloFile}`,
			`//?/${slashed}`,
			"\\\\?\\Volume{01234567-89ab-cdef-0123-456789abcdef}\\repo\\.heli-harness\\tasks\\t1\\yolo.json",
			"\\\\?\\GLOBALROOT\\Device\\HarddiskVolume3\\repo\\.heli-harness\\tasks\\t1\\yolo.json",
			"\\\\?\\UNC\\localhost\\c$\\repo\\.heli-harness\\tasks\\t1\\yolo.json",
			"\\\\localhost\\c$\\repo\\.heli-harness\\tasks\\t1\\yolo.json",
			join(ws, ".heli-harness.", "tasks", "t1", "yolo.json"),
			`${ws.slice(0, 2)}.heli-harness\\tasks\\t1\\yolo.json`,
			gitBash,
			`/cygdrive${gitBash}`,
			`${planFile}:stream`,
			`\\\\?\\${planFile}`,
			join(ws, ".heli-harness", "tasks", "t1", "reports", "2026-09-30T10:00.json"),
		];
		for (const spelling of spellings) {
			const entries = classifyToolPaths([spelling], { workspaceRoot: ws, cwd: ws, env });
			assert.ok(entries.some((entry) => entry.kind === "authority"), `${spelling}: ${JSON.stringify(entries)}`);
		}
		// A few of them through the whole hook, for the observer and the lease holder.
		for (const spelling of [`${yoloFile}.`, `\\??\\${yoloFile}`, gitBash, `${planFile}:stream`, `${ws.slice(0, 2)}.heli-harness\\tasks\\t1\\yolo.json`]) {
			for (const sessionEnv of [asObserver, asOwner]) {
				assert.equal(write(ws, spelling, sessionEnv).code, "HELI_STATE_PROTECTED", `${spelling} (${JSON.stringify(sessionEnv)})`);
			}
		}
		// A short (8.3) name is an alias of the long one; not every volume makes them.
		if (existsSync(join(ws, "HELI-H~1"))) {
			assert.equal(write(ws, join(ws, "HELI-H~1", "TASKS", "T1", "YOLO.JSON"), asOwner).code, "HELI_STATE_PROTECTED", "an 8.3 short name");
		}
		const shellKindsInWs = (command) =>
			new Set(classifyShellWriteTargets(shellWriteTargets(analyzeCommand(command)), { workspaceRoot: ws, cwd: ws, env }).map((entry) => entry.kind));
		for (const command of [
			`Set-Content -Path "${yoloFile}." -Value x`,
			`Set-Content -LiteralPath "${yoloFile} " -Value x`,
			`echo x> "${yoloFile}."`,
			`echo x > ${gitBash}`,
			`tee /cygdrive${gitBash} < forged.json`,
			`cmd /c "echo x> \\??\\${yoloFile}"`,
			`cd ${gitBash.slice(0, gitBash.lastIndexOf("/"))} && echo x > yolo.json`,
			`cd "${join(ws, ".heli-harness.")}" && echo x > state\\yolo.json`,
			`Rename-Item -Path "${planFile}" -NewName yolo.json`,
		]) {
			assert.ok(shellKindsInWs(command).has("authority"), command);
		}
		assert.equal(evaluate(ws, "Bash", { command: `echo x> "${yoloFile}."` }, asOwner).code, "HELI_STATE_PROTECTED");
		assert.equal(evaluate(ws, "Bash", { command: `echo x > ${gitBash}` }, asOwner).code, "HELI_STATE_PROTECTED");
	} else {
		// `//tmp/x` is `/tmp/x` here, not a UNC path.
		assert.equal(write(ws, `/${yoloFile}`, asOwner).code, "HELI_STATE_PROTECTED", "a doubled leading slash");
		assert.equal(write(ws, `/${join(env.HELI_CONFIG_DIR, "policy.json")}`, asOwner).code, "HELI_STATE_PROTECTED", "a doubled leading slash on a path with no Heli marker in it");
		// `:` is a file-name character here, not a stream, so a notes file may carry a timestamp.
		assert.equal(write(ws, ".heli-harness/tasks/t1/reports/2026-09-30T10:00.json", asOwner).deny, false);
		assert.equal(write(ws, `${planFile}:stream`, asOwner).deny, false);
		assert.equal(write(ws, ".heli-harness/tasks/t1/yolo.json:hidden", asOwner).code, "HELI_STATE_PROTECTED", "still read as the file it names");
	}
	if (process.platform === "linux") {
		assert.equal(write(ws, ".HELI-HARNESS/tasks/t1/yolo.json", asOwner).deny, false, "a different directory on a case-sensitive file system");
		assert.equal(write(ws, ".heli-harness/tasks/T1/plan.md", asObserver).code, "NOT_WRITE_MODE", "task T1 is not task t1 there");
	}
	assert.equal(normalizePolicyPath("", { cwd: ws, env }), null);
	assert.equal(normalizePolicyPath("a\0b", { cwd: ws, env }), null);
	assert.deepEqual(classifyToolPaths(["", "notes.md"], { workspaceRoot: ws, cwd: ws, env }).map((entry) => entry.kind), ["other", "other"]);

	// 12. Settings that turn Heli off are found under every spelling; other settings edits stay fine.
	const settings = (filePath, content, sessionEnv = asOwner) => evaluate(ws, "Write", { file_path: filePath, content }, sessionEnv);
	for (const content of [
		"{\"disableAllHooks\": true}",
		"{\n  \"disableAllHooks\"\n  :\n  true\n}",
		"{\"disable\\u0041llHooks\": true}",
		"{\"enabledPlugins\": {\"heli-harness@some-marketplace\": false}}",
		"{\"enabledPlugins\":{\"heli-harness@heli-harness\":false}}",
	]) {
		assert.equal(disablesClaudeHooks(content), true, content);
	}
	assert.equal(settings(".claude/settings.json", "{\"disable\\u0041llHooks\": true}").code, "HELI_HOOKS_PROTECTED", "an escaped key is the same key");
	assert.equal(settings(".claude/settings.json", "{\"enabledPlugins\": {\"heli-harness@some-marketplace\": false}}").code, "HELI_HOOKS_PROTECTED");
	for (const content of [
		"{\"disableAllHooks\": false}",
		JSON.stringify({ permissions: { allow: ["Bash(git status)"] } }),
		"{\"enabledPlugins\": {\"heli-harness@heli-harness\": true}}",
		"{\"enabledPlugins\": {\"other@x\": false}}",
	]) {
		assert.equal(disablesClaudeHooks(content), false, content);
	}
	assert.equal(settings(".claude/settings.json", "{\"disableAllHooks\": false}").deny, false);
	// Only Claude's own settings files count.
	for (const filePath of ["docs/settings.json", ".claude/notes.json", ".claude-backup/settings.json"]) {
		const [entry] = classifyToolPaths([filePath], { workspaceRoot: ws, cwd: ws, env });
		assert.notEqual(entry.kind, "claude-settings", filePath);
	}
	assert.equal(settings("docs/settings.json", "{\"disableAllHooks\": true}").deny, false);
	for (const filePath of [".claude/settings.json", ".claude/settings.local.json", "sub/.claude/settings.json"]) {
		const [entry] = classifyToolPaths([filePath], { workspaceRoot: ws, cwd: ws, env });
		assert.equal(entry.kind, "claude-settings", filePath);
	}
	// A `.claude` that is a link into a dotfiles repository is still Claude's settings directory.
	const dotfiles = workspace("dotfiles");
	mkdirSync(join(dotfiles, "claude-dotfiles"), { recursive: true });
	symlinkSync(join(dotfiles, "claude-dotfiles"), join(dotfiles, ".claude"), process.platform === "win32" ? "junction" : "dir");
	assert.equal(evaluate(dotfiles, "Write", { file_path: ".claude/settings.json", content: "{\"disableAllHooks\": true}" }).code, "HELI_HOOKS_PROTECTED");
	assert.equal(evaluate(dotfiles, "Bash", { command: "echo '{\"disableAllHooks\": true}' > .claude/settings.local.json" }).code, "HELI_HOOKS_PROTECTED");
	assert.equal(evaluate(dotfiles, "Write", { file_path: ".claude/notes.json", content: "{\"disableAllHooks\": true}" }).deny, false);
	const claudeConfigDir = join(scratch, "claude-config");
	assert.equal(evaluate(ws, "Write", { file_path: join(claudeConfigDir, "settings.json"), content: "{\"disableAllHooks\": true}" }, { ...asOwner, CLAUDE_CONFIG_DIR: claudeConfigDir }).code, "HELI_HOOKS_PROTECTED", "CLAUDE_CONFIG_DIR moves the user settings");
	assert.equal(evaluate(ws, "apply_patch", { command: "*** Begin Patch\n*** Update File: .claude/settings.json\n@@\n-{}\n+{\"disableAllHooks\": true}\n*** End Patch\n" }, asOwner).code, "HELI_HOOKS_PROTECTED");
	assert.equal(evaluate(legacy, "Bash", { command: "echo '{\"disableAllHooks\": true}' > ~/.claude/settings.json" }, homeEnv).code, "HELI_HOOKS_PROTECTED");

	// 13. .env files are found by the paths shell commands and file tools resolve, and a scoped grant still opens them.
	for (const command of [
		"cd apps/api && echo SECRET=1 > .env",
		"cd apps && cd api && printf x >> .env",
		"tee .env.production < secrets.txt",
		"Set-Content -Path .env.local -Value x",
		"cp secrets.txt .env",
		"sed -i s/a/b/ .env",
		"echo x > \".env\"",
	]) {
		assert.equal(shell(command).code, "ENV_WRITE_DENIED", command);
	}
	assert.equal(evaluate(legacy, "Write", { file_path: ".env ", content: "x" }).code, "ENV_WRITE_DENIED", "a trailing space does not hide it");
	assert.equal(evaluate(legacy, "Write", { file_path: "apps/../.env", content: "x" }).code, "ENV_WRITE_DENIED");
	for (const command of ["echo x > .envrc", "echo x > env.txt", "echo x > .environment", "cat .env"]) {
		assert.equal(shell(command).deny, false, command);
	}
	const envWorkspace = workspace("env-grant");
	const envGrant = issueGrant(envWorkspace, { action: "env.write", scope: "once", resource: { type: "workspace", id: projectWorkspaceKey(envWorkspace, { env }) }, env });
	assert.equal(evaluate(envWorkspace, "Bash", { command: "echo SECRET=1 > .env" }).deny, false, "a scoped env.write grant opens a shell write to .env");
	assert.equal(listGrants(envWorkspace, { activeOnly: false, env }).find((grant) => grant.grantId === envGrant.grantId).remainingUses, 0);
	assert.equal(evaluate(envWorkspace, "Bash", { command: "echo SECRET=1 > .env" }).code, "ENV_WRITE_DENIED", "a once grant opens exactly one write");

	// 14. Reading the write targets stays inside the analysis budget's time guarantee (hosts treat a hook that
	// times out as an allow). The bounds are far above what these take and below what the unfixed code took:
	// a `\d+` file-descriptor prefix needed about a second for one 49,000-digit word.
	const limits = COMMAND_ANALYSIS_LIMITS;
	const within = (limitMs, label, fn) => {
		const startedAt = Date.now();
		const value = fn();
		const elapsed = Date.now() - startedAt;
		assert.ok(elapsed < limitMs, `${label} took ${elapsed} ms (limit ${limitMs} ms)`);
		return value;
	};
	const nearLimit = limits.maxCommandChars - 10;
	within(400, "a redirect after a 49,000-digit word", () => shellWriteTargets(analyzeCommand(`${"9".repeat(nearLimit - 4)} > x`)));
	within(400, "a 49,000-digit word", () => shellWriteTargets(analyzeCommand("9".repeat(nearLimit))));
	within(400, "a storm of redirect operators", () => shellWriteTargets(analyzeCommand(`echo ${">&".repeat(20000)}`)));
	within(400, "a storm of quoted redirects", () => shellWriteTargets(analyzeCommand(`echo ${">\"a".repeat(15000)}`)));
	within(400, "a run of dots and spaces in a path", () => classifyShellWriteTargets(shellWriteTargets(analyzeCommand(`rm "a${". ".repeat(19000)}b"`)), { workspaceRoot: legacy, cwd: legacy, env }));
	// The most file-system lookups the limits allow: about a thousand targets, each in its own missing directory chain.
	const chains = [];
	let chain = 0;
	while (chains.join("; ").length < limits.maxCommandChars - 400) {
		chains.push(`rm ${Array.from({ length: 5 }, () => `d${chain++}/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/q/r/s/t/x`).join(" ")}`);
	}
	const deepCommand = chains.join("; ");
	assert.ok(deepCommand.length <= limits.maxCommandChars, "the command fits the analysis limits");
	const deepStart = Date.now();
	const deepResult = evaluate(legacy, "Bash", { command: deepCommand });
	assert.equal(deepResult.deny, false, `${deepResult.code}: ${deepResult.reason}`);
	assert.ok(Date.now() - deepStart < 5000, `${chain} targets in distinct missing directories took ${Date.now() - deepStart} ms`);
	// Padding never hides a protected target: everything is read to the end.
	const paddedCommand = `${deepCommand.slice(0, deepCommand.lastIndexOf("; rm "))}; rm .heli-harness/sessions/owner.json`;
	assert.ok(paddedCommand.length <= limits.maxCommandChars, "the padded command fits the analysis limits");
	const paddedStart = Date.now();
	assert.equal(evaluate(legacy, "Bash", { command: paddedCommand }).code, "HELI_STATE_PROTECTED");
	assert.ok(Date.now() - paddedStart < 5000, `the padded command took ${Date.now() - paddedStart} ms`);
	// Path-only tools: thousands of paths in one patch are checked, not skipped.
	const bigPatch = `*** Begin Patch\n${Array.from({ length: 2000 }, (_, index) => `*** Add File: d${index}/sub/x.txt\n+x`).join("\n")}\n*** Add File: .heli-harness/tasks/t1/yolo.json\n+{}\n*** End Patch\n`;
	const bigStart = Date.now();
	assert.equal(evaluate(ws, "apply_patch", { command: bigPatch }, asOwner).code, "HELI_STATE_PROTECTED");
	assert.ok(Date.now() - bigStart < 5000, `a 2000-file patch took ${Date.now() - bigStart} ms`);

	// 15. A link out of a notes folder is judged by where it leads, so it does not smuggle a source write past the ownership gate.
	rmSync(join(ws, ".heli-harness", "tasks", "t1", "reports"), { recursive: true, force: true });
	symlinkSync(join(ws, "src"), join(ws, ".heli-harness", "tasks", "t1", "reports"), linkKind);
	assert.equal(write(ws, ".heli-harness/tasks/t1/reports/app.js", asObserver).code, "NOT_WRITE_MODE");
	assert.equal(write(ws, ".heli-harness/tasks/t1/reports/app.js", asOwner).deny, false, "the writer may write it");

	console.log("self-protection smoke ok");
} finally {
	rmSync(scratch, { recursive: true, force: true });
}
