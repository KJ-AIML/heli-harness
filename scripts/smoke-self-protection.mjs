#!/usr/bin/env node
/**
 * Heli protects itself from the agent it governs:
 *  - agent-run privilege commands (grants, YOLO, takeovers, Heli removal, and the
 *    --accept-policy-changes flag of a sync pull) are hard-denied in every form the rule reads;
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
import { classifyShellWriteTargets, classifyToolPaths, disablesClaudeHooks, heliEnvironmentKeys, normalizePolicyPath } from "../.heli-harness/adapters/shared/concurrency/protected-paths.mjs";
import { createTask } from "../lib/concurrency/task.mjs";
import { createSession, attachSession } from "../lib/concurrency/session.mjs";
import { acquireWriteLease } from "../lib/concurrency/lease.mjs";
import { issueGrant, listGrants } from "../lib/concurrency/grant.mjs";
import { projectWorkspaceKey } from "../lib/concurrency/project-binding.mjs";
import { isTaskStateWriteForContext, resolveExecutionContext } from "../lib/concurrency/resolve.mjs";
import { canonicalizePath } from "../lib/concurrency/index.mjs";
import { runGrant } from "../lib/cli/grant.mjs";
import { assertHumanTerminal } from "../lib/cli/human-gate.mjs";
import { runYolo } from "../lib/cli/yolo.mjs";
import { scrubHeliProcessEnv } from "./lib/hermetic-env.mjs";

scrubHeliProcessEnv();
const root = process.cwd();
const heli = join(root, "bin", "heli.mjs");
const scratch = canonicalizePath(mkdtempSync(join(tmpdir(), "heli-self-protection-")));
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
	// The kernel's own description must not claim more than the parser does: it reads command text, so it is a guardrail.
	const kernelSource = readFileSync(join(root, ".heli-harness", "adapters", "shared", "command-policy.mjs"), "utf8");
	assert.doesNotMatch(kernelSource, /may never run them, in any invocation form/, "the header must not promise every form");
	assert.match(kernelSource, /refuses every spelled-out form/);
	assert.match(kernelSource, /a guardrail, not a guarantee/);

	const legacy = workspace("legacy");

	// 1. Agent-run privilege commands are hard-denied in every form listed here (the rule reads command text, so this is a guardrail).
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
		// Accepting governance changes pulled from a sync server is a human decision too.
		"heli pull --accept-policy-changes",
		"heli pull --force --accept-policy-changes",
		"heli sync --accept-policy-changes",
		"heli init lab --dir ../ws --clone --accept-policy-changes",
		"node .heli-harness/heli.mjs pull --accept-policy-changes",
		"npx heli-harness pull --accept-policy-changes",
		"heli-harness pull --force --accept-policy-changes",
		"echo ok && heli pull --force --accept-policy-changes",
		"bash -c 'heli pull --accept-policy-changes'",
		"pwsh -Command \"heli pull --accept-policy-changes\"",
		"heli pull --accept-policy-changes # sure",
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
	// Only the flag is human-only: a plain pull or init stays allowed (they refuse governance changes on their own),
	// and a plain sync stays approvable (T5) rather than hard-denied.
	for (const command of [
		"heli pull",
		"heli pull --force",
		"heli pull --version 3 --force",
		"heli init lab --dir ../ws --clone",
		"npx heli-harness pull",
		"bash -c 'heli pull --force'",
		// Text that only mentions the flag is not the flag: a comment, another command in the line, data inside a longer word.
		"heli pull # --accept-policy-changes",
		"heli pull\n# --accept-policy-changes is for a human",
		"heli pull && echo --accept-policy-changes",
		"echo --accept-policy-changes | heli pull",
		"heli task create t2 --title \"docs: --accept-policy-changes needs a terminal\"",
		"heli pull --accept-policy-changes-now",
	]) {
		const result = evaluate(legacy, "Bash", { command });
		assert.equal(result.deny, false, `${command}: ${result.reason}`);
	}
	for (const command of [["heli", "pull", "--force"], ["bash", "-lc", "heli pull"]]) {
		const result = evaluate(legacy, "Bash", { command });
		assert.equal(result.deny, false, `${JSON.stringify(command)}: ${result.reason}`);
	}
	assert.equal(evaluate(legacy, "Bash", { command: "heli sync" }).code, "TIER_APPROVAL_REQUIRED", "a plain sync is a T5 approval, not a hard deny");
	// A command given as an argv list (Codex's shell tool) is read as its shell-quoted join, so the flag is found there too.
	for (const command of [
		["heli", "pull", "--accept-policy-changes"],
		["heli", "pull", "--force", "--accept-policy-changes"],
		["bash", "-lc", "heli pull --force --accept-policy-changes"],
		["node", ".heli-harness/heli.mjs", "init", "lab", "--accept-policy-changes"],
		["npx", "heli-harness", "sync", "--accept-policy-changes"],
	]) {
		for (const extraEnv of [{}, { HELI_YOLO: "1", HELI_ALLOW_COMMAND: "heli-privileged-command" }]) {
			const result = evaluate(legacy, "Bash", { command }, extraEnv);
			assert.equal(result.code, "TIER_BLOCKED", `${JSON.stringify(command)}: ${result.reason}`);
			assert.match(result.reason, /human in their own terminal/, JSON.stringify(command));
		}
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
		// The flag that accepts synced governance changes, in every one of those forms.
		"pnpm dlx heli-harness pull --accept-policy-changes",
		"bunx heli-harness sync --accept-policy-changes",
		"yarn dlx heli-harness init lab --accept-policy-changes",
		"npm exec heli-harness -- pull --accept-policy-changes",
		"npx -y heli-harness@latest pull --accept-policy-changes",
		"npx -y github:KJ-AIML/heli-harness#main pull --accept-policy-changes",
		"deno run -A npm:heli-harness pull --accept-policy-changes",
		"bun .heli-harness/heli.mjs pull --accept-policy-changes",
		"./node_modules/.bin/heli pull --accept-policy-changes",
		"node C:\\tools\\heli\\bin\\heli.mjs pull --force --accept-policy-changes",
		"\"C:\\Program Files\\nodejs\\node.exe\" .heli-harness\\heli.mjs pull --accept-policy-changes",
		"heli.cmd pull --accept-policy-changes",
		"heli.exe pull --accept-policy-changes",
		"heli.ps1 sync --accept-policy-changes",
		"sudo heli pull --accept-policy-changes",
		"env HELI_X=1 heli pull --accept-policy-changes",
		"time heli pull --accept-policy-changes",
		"heli pull --accept-policy-changes=true",
		"heli --accept-policy-changes pull",
		"heli pull -- --accept-policy-changes",
		"heli pull \"--accept-policy-changes\"",
		"heli --json pull --accept-policy-changes",
		"ssh host 'heli pull --accept-policy-changes'",
		"su -c 'node .heli-harness/heli.mjs pull --accept-policy-changes'",
		"docker exec c sh -c 'heli sync --accept-policy-changes'",
		"watch 'heli pull --accept-policy-changes'",
		"ssh host 'npx heli-harness pull --accept-policy-changes'",
		"ssh host 'pnpm dlx heli-harness pull --accept-policy-changes'",
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
		"ssh host 'heli pull --accept-policy-changes'",
		"ssh host 'heli-harness sync --accept-policy-changes'",
		"su -c 'node .heli-harness/heli.mjs init lab --accept-policy-changes'",
		"ssh host 'npx heli-harness pull --accept-policy-changes'",
		"ssh host 'npm exec heli-harness -- pull --accept-policy-changes'",
		"ssh host 'pnpm dlx heli-harness pull --accept-policy-changes'",
		"ssh host 'yarn dlx heli-harness pull --accept-policy-changes'",
		"ssh host 'bunx heli-harness pull --accept-policy-changes'",
		"ssh host 'deno run -A npm:heli-harness pull --accept-policy-changes'",
		"ssh host './.heli-harness/heli.mjs pull --accept-policy-changes'",
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
		"ssh host 'heli pull'",
		"ssh host 'heli pull --force'",
		"echo 'heli pull --accept-policy-changes is blocked'",
		"git commit -m \"docs: heli pull --accept-policy-changes needs a terminal\"",
		"grep -rn 'accept-policy-changes' docs",
		"heli pull && echo done",
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
		"env -u ren ren .heli-harness/tasks/t1/plan.md yolo.json", // the first `ren` is an option's value, the second is the command
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

	// 16. Fix round 1. Every occurrence of a command is read in order, so a `cd` or a write that appears twice is not
	// dropped (a repeated segment used to vanish and take the directory it changed to with it).
	for (const command of [
		"cd .heli-harness; cd ..; cd .heli-harness; cd state; echo x > yolo.json",
		"cd a; echo x > yolo.json; cd ..; cd .heli-harness/state; echo x > yolo.json",
		"cd d1; cd ..; cd d2; cd ..; cd .heli-harness/state; echo x > yolo.json",
		"rm task.json; cd .heli-harness/tasks/t1; rm task.json",
	]) {
		assert.ok(writeKinds(command).has("authority"), command);
	}
	// The targets keep their documented shape, { path, cdPath }, though a chain is stored one node per `cd`; a target made by hand
	// (an array and no chain) is classified like one from the analysis.
	assert.deepStrictEqual(shellWriteTargets(analyzeCommand("cd a && cd b && echo x > f")).find((target) => target.path === "f"), { path: "f", cdPath: ["a", "b"] });
	assert.deepStrictEqual(shellWriteTargets(analyzeCommand("echo x > f"))[0], { path: "f", cdPath: [] });
	assert.deepEqual(Object.keys(shellWriteTargets(analyzeCommand("cd a && echo x > f"))[0]), ["path", "cdPath"]);
	for (const cdPath of [[".heli-harness/state"], [".heli-harness", "state"]]) {
		const byHand = classifyShellWriteTargets([{ path: "yolo.json", cdPath }, { path: "y", cdPath }, { path: "z" }], { workspaceRoot: legacy, cwd: legacy, env });
		assert.ok(byHand.some((entry) => entry.kind === "authority" && entry.raw === "yolo.json"), JSON.stringify(cdPath));
	}
	// A chain stops growing the working directory at a bound (no real directory is longer than the OS allows, and a chain that long
	// has `cd`s that fail): that is what keeps each hop cheap however many there are.
	const grown = classifyShellWriteTargets(
		shellWriteTargets(analyzeCommand(`${Array.from({ length: 60 }, (_, i) => `cd ${"x".repeat(100)}${i}`).join("; ")}; echo y > out.txt`)),
		{ workspaceRoot: legacy, cwd: legacy, env },
	);
	assert.ok(grown.length > 0 && grown.every((entry) => entry.normalized.length < legacy.length + 1024 + 300), `the chain grew the directory to ${Math.max(...grown.map((entry) => entry.normalized.length))} characters`);
	// A `cd` chain costs the same per target however long it is. It used to cost O(chain) per target: a 19 KB command
	// took 121 s, one write after 3,500 `cd`s took 8 s, and hosts treat a hook that times out as an allow. The shapes
	// below run at and near the analysis limits and must still be denied for the protected write at their end.
	const largestFit = (build) => {
		let low = 1;
		let high = 20000;
		while (low < high) {
			const mid = Math.ceil((low + high) / 2);
			if (analyzeCommand(build(mid)).limitExceeded) high = mid - 1;
			else low = mid;
		}
		return low;
	};
	const protectedTail = "echo x > .heli-harness/state/yolo.json";
	const chainShapes = [
		["cd dK; echo x > fK", (n) => `${Array.from({ length: n }, (_, i) => `cd d${i}; echo x > f${i}`).join("; ")}; ${protectedTail}`],
		["cd dK", (n) => `${Array.from({ length: n }, (_, i) => `cd d${i}`).join("; ")}; ${protectedTail}`],
		["cd dK; cd ..", (n) => `${Array.from({ length: n }, (_, i) => `cd d${i}; cd ..`).join("; ")}; ${protectedTail}`],
		["cd <long name>", (n) => `${Array.from({ length: n }, (_, i) => `cd ${"long".repeat(20)}${i}`).join("; ")}; ${protectedTail}`],
		// The chain's own result decides this one: every pair returns to the start, then `cd` goes into Heli state.
		["cd dK; cd .. then cd into state", (n) => `${Array.from({ length: n }, (_, i) => `cd d${i}; cd ..`).join("; ")}; cd .heli-harness/state; echo x > yolo.json`],
	];
	for (const [label, build] of chainShapes) {
		const largest = largestFit(build);
		assert.ok(largest >= 500, `${label}: the analysis limits allow only ${largest}`);
		for (const size of [...new Set([100, 200, 400, 800, Math.floor(largest * 0.9), largest].filter((n) => n <= largest))]) {
			const command = build(size);
			assert.ok(command.length <= limits.maxCommandChars, `${label} x${size} fits the command limit`);
			assert.equal(analyzeCommand(command).limitExceeded, null, `${label} x${size} fits the analysis limits`);
			const started = Date.now();
			const result = evaluate(legacy, "Bash", { command });
			const elapsed = Date.now() - started;
			assert.equal(result.code, "HELI_STATE_PROTECTED", `${label} x${size}: ${result.code} ${result.reason}`);
			assert.ok(elapsed < 5000, `${label} x${size} (${command.length} chars) took ${elapsed} ms`);
		}
		const unitStart = Date.now();
		const kinds = new Set(classifyShellWriteTargets(shellWriteTargets(analyzeCommand(build(largest))), { workspaceRoot: legacy, cwd: legacy, env }).map((entry) => entry.kind));
		assert.ok(kinds.has("authority"), label);
		assert.ok(Date.now() - unitStart < 3000, `${label} x${largest}: classifying took ${Date.now() - unitStart} ms`);
	}
	// The same chains without the protected write are allowed, and just as fast.
	const harmlessChain = Array.from({ length: 1200 }, (_, i) => `cd d${i}; echo x > f${i}`).join("; ");
	const harmlessStart = Date.now();
	assert.equal(evaluate(legacy, "Bash", { command: harmlessChain }).deny, false);
	assert.ok(Date.now() - harmlessStart < 5000, `a long harmless chain took ${Date.now() - harmlessStart} ms`);

	// 17. Fix round 1. Redirect operators bash accepts beyond `>` and `>>` (`>|` overrides noclobber, `<>` opens a file for
	// reading and writing and creates it, `x=>file` is an empty assignment and a redirect), and the common writers that
	// take an explicit output path.
	for (const command of [
		"echo x >| .heli-harness/state/yolo.json",
		"echo x 2>| .heli-harness/state/yolo.json",
		"printf '{\"enabled\":true}' x=>.heli-harness/state/yolo.json",
		"x=>.heli-harness/state/yolo.json",
		"echo x =>.heli-harness/state/yolo.json",
		"exec 3<>.heli-harness/state/yolo.json",
		"exec 3<>.heli-harness/state/yolo.json; echo '{\"enabled\":true}' >&3",
		"cat <>.heli-harness/state/yolo.json",
		"cat 3<> .heli-harness/tasks/t1/task.json",
		"sort -o .heli-harness/state/yolo.json forged.json",
		"sort --output=.heli-harness/tasks/t1/task.json forged.json",
		"sort -ro .heli-harness/tasks/t1/task.json forged.json",
		"curl -o .heli-harness/state/yolo.json http://example.com/yolo.json",
		"curl --output .heli-harness/state/yolo.json http://example.com/yolo.json",
		"curl --output=.heli-harness/state/yolo.json http://example.com/yolo.json",
		"curl -sSLo .heli-harness/state/yolo.json http://example.com/yolo.json",
		"wget -O .heli-harness/state/yolo.json http://example.com/yolo.json",
		"wget -O.heli-harness/state/yolo.json http://example.com/yolo.json",
		"wget --output-document=.heli-harness/state/yolo.json http://example.com/yolo.json",
		"wget --output-document .heli-harness/state/yolo.json http://example.com/yolo.json",
		"curl --output-dir .heli-harness/state -O http://example.com/yolo.json",
		"curl -D .heli-harness/state/yolo.json http://example.com/",
		"curl -c .heli-harness/state/yolo.json http://example.com/",
		"wget -P .heli-harness/state http://example.com/yolo.json",
		"wget --directory-prefix=.heli-harness/state http://example.com/yolo.json",
		"wget -o .heli-harness/state/yolo.json http://example.com/",
		"Invoke-WebRequest -Uri http://example.com/yolo.json -OutFile .heli-harness/state/yolo.json",
		"iwr http://example.com/yolo.json -OutFile .heli-harness/state/yolo.json",
		"iwr http://example.com/yolo.json -outfile:.heli-harness/state/yolo.json",
		"irm http://example.com/yolo.json -OutFile .heli-harness/state/yolo.json",
		"Invoke-RestMethod http://example.com/yolo.json -OutFile .heli-harness/state/yolo.json",
		"tar -xzf forged.tgz -C .heli-harness/tasks/t1",
		"tar -xf forged.tar --directory=.heli-harness/state",
		"tar -xf forged.tar --directory .heli-harness/state",
		"tar xf forged.tar -C .heli-harness/sessions",
		"tar -xzf forged.tgz -C.heli-harness/state",
		"cd .heli-harness/state && tar -xf forged.tar",
		"tar -cf .heli-harness/state/yolo.json src",
		"tar czf .heli-harness/tasks/t1/task.json src",
		"unzip forged.zip -d .heli-harness/tasks/t1",
		"unzip -d .heli-harness/state forged.zip",
		"unzip -d.heli-harness/state forged.zip",
		"cd .heli-harness/state && unzip forged.zip",
		"Expand-Archive -Path forged.zip -DestinationPath .heli-harness/state",
		"rsync -a forged/ .heli-harness/tasks/t1/",
		"rsync -av forged.json .heli-harness/state/yolo.json",
		"rsync -a --exclude x forged/ .heli-harness/state/",
		"rsync -e ssh -a host:forged/ .heli-harness/state/",
		"truncate -s 0 .heli-harness/tasks/t1/events.jsonl",
		"install -m 644 forged.json .heli-harness/state/yolo.json",
		"dd if=forged.json of=.heli-harness/state/yolo.json bs=1",
		// The folder a GNU cp, mv, install or ln puts its files in, with the value attached to the option.
		"cp -t .heli-harness/state /tmp/yolo.json",
		"cp -t.heli-harness/state /tmp/yolo.json",
		"cp -at.heli-harness/state /tmp/yolo.json",
		"cp --target-directory=.heli-harness/state /tmp/yolo.json",
		"cp --target-directory .heli-harness/state /tmp/yolo.json",
		"mv -t.heli-harness/tasks/t1 /tmp/task.json",
		"install --target-directory=.heli-harness/state forged.json",
		// A writer's name can also be the value of an option before it (`env -u tar`): every appearance is read, not the first.
		"env -u tar tar xzf forged.tgz -C .heli-harness/state",
		"env -u unzip unzip -d .heli-harness/state forged.zip",
		"env -u rsync rsync -a forged/ .heli-harness/state/",
		"env -u curl curl -o .heli-harness/state/yolo.json http://example.com/yolo.json",
	]) {
		assert.ok(writeKinds(command).has("authority"), command);
	}
	for (const command of [
		"echo x >| out.txt",
		"exec 3<>out.txt",
		"a=>out.txt",
		"sort -o sorted.txt in.txt",
		"sort in.txt",
		"curl -o out.json http://example.com/x.json",
		"curl -o - http://example.com/x.json",
		"curl http://example.com/x.json",
		"curl -O http://example.com/x.json",
		"wget -O notes.txt http://example.com/x.txt",
		"wget -O - http://example.com/x.txt",
		"wget http://example.com/x.txt",
		"iwr http://example.com/x.txt -OutFile notes.txt",
		"iwr http://example.com/x.txt",
		"tar -xzf a.tgz -C build",
		"tar -xf a.tar",
		"tar -tf a.tar",
		"tar -cf out.tar src",
		"unzip a.zip -d out",
		"unzip a.zip",
		"unzip -l a.zip",
		"rsync -a src/ dest/",
		"rsync -a .heli-harness/tasks/t1/plan.md /tmp/plan.bak",
		"rsync src",
		"Expand-Archive -Path a.zip -DestinationPath out",
	]) {
		assert.ok(!writeKinds(command).has("authority"), command);
	}
	// What the reader takes for a target, one operator or writer at a time.
	for (const [command, expected] of [
		["echo x >| a", ["a"]],
		["echo x 2>| a", ["a"]],
		["echo x >|a", ["a"]],
		["echo x >| \"a b\"", ["a b"]],
		["x=>a", ["a"]],
		["echo x=>a", ["a"]],
		["echo x =>a", ["a"]],
		["exec 3<>a", ["a"]],
		["cat <>a", ["a"]],
		["cat 3<> a", ["a"]],
		["echo x >&3", []],
		["echo x 3>&1", []],
		["echo x <in", []],
		["cat <<EOF", []],
		["sort -o out in", ["out"]],
		["sort -ro out in", ["out"]],
		["sort -oout in", ["out"]],
		["sort --output=out in", ["out"]],
		["sort --output out in", ["out"]],
		["sort in", []],
		["curl -o out http://x", ["out"]],
		["curl --output out http://x", ["out"]],
		["curl --output=out http://x", ["out"]],
		["curl -sSLo out http://x", ["out"]],
		["curl -o - http://x", []],
		["curl -O http://x/f", []],
		["curl --output-dir dir -O http://x/f", ["dir"]],
		["curl -D headers.txt http://x", ["headers.txt"]],
		["curl -c jar.txt http://x", ["jar.txt"]],
		["curl -XDELETE http://x", ["ELETE"]], // an over-approximation: the reader does not know that -X takes a value, so it reads -D
		["curl -XPOST http://x", []],
		["wget -P dir http://x", ["dir"]],
		["wget --directory-prefix=dir http://x", ["dir"]],
		["wget -o log.txt http://x", ["log.txt"]],
		["wget -a log.txt http://x", ["log.txt"]],
		["wget -qO- http://x", []],
		["wget -O out http://x", ["out"]],
		["wget -Oout http://x", ["out"]],
		["wget --output-document=out http://x", ["out"]],
		["wget --output-document out http://x", ["out"]],
		["wget -O - http://x", []],
		["wget http://x", []],
		["iwr http://x -OutFile out", ["out"]],
		["Invoke-WebRequest -Uri http://x -OutFile out", ["out"]],
		["Invoke-RestMethod http://x -outfile out", ["out"]],
		["irm http://x -OutFile:out", ["out"]],
		["iwr http://x", []],
		["tar -xzf a.tgz -C dir", ["dir"]],
		["tar -xf a.tar --directory dir", ["dir"]],
		["tar -xf a.tar --directory=dir", ["dir"]],
		["tar xzf a.tgz -C dir", ["dir"]],
		["env -u tar tar xzf a.tgz -C dir", ["dir"]],
		["cp -t d f", ["d", "f"]],
		["cp -td f", ["d", "f"]],
		["cp -atd f", ["d", "f"]],
		["cp --target-directory=d f", ["d", "f"]],
		["cp --preserve=all a b", ["a", "b"]],
		["tar -xzf a.tgz -Cdir", ["dir"]],
		["tar -xf a.tar", ["."]],
		["tar -cf out.tar src", ["out.tar"]],
		["tar czf out.tgz src", ["out.tgz"]],
		["tar --create --file=out.tar src", ["out.tar"]],
		["tar -tf a.tar", []],
		["unzip a.zip -d dir", ["dir"]],
		["unzip -d dir a.zip", ["dir"]],
		["unzip -ddir a.zip", ["dir"]],
		["unzip a.zip", ["."]],
		["unzip -l a.zip", []],
		["Expand-Archive -Path a.zip -DestinationPath dir", ["dir"]],
		["rsync -av src/ dest/", ["dest/"]],
		["rsync -a a b c dest", ["dest"]],
		["rsync -a --exclude x src dest", ["dest"]],
		["rsync -e ssh src dest", ["dest"]],
		["rsync src", []],
		["dd if=a of=b bs=1", ["b"]],
	]) {
		assert.deepEqual(targetsOf(command), [...expected].sort(), command);
	}
	// Through the whole hook: the legacy workspace, and the lease holder of a concurrent one.
	for (const command of ["printf '{\"enabled\":true}' x=>.heli-harness/state/yolo.json", "echo x >| .heli-harness/state/yolo.json", "exec 3<>.heli-harness/state/yolo.json; echo '{\"enabled\":true}' >&3", "curl -o .heli-harness/state/yolo.json http://example.com/y.json", "tar -xf forged.tar -C .heli-harness/state"]) {
		assert.equal(shell(command).code, "HELI_STATE_PROTECTED", command);
		assert.equal(evaluate(ws, "Bash", { command }, asOwner).code, "HELI_STATE_PROTECTED", `${command} (lease holder)`);
	}
	// A `>|` is not a pipe: what follows it is a file, not a command the rules read.
	assert.equal(analyzeCommand("echo x >| notes.txt").segments.length, 2, "one segment per dialect");
	// A `cd` behind a shell keyword, a wrapper of the builtin or an assignment is a `cd` all the same, and a redirect target
	// is the word as the shell reads it: `yol''o.json`, `yolo\.json` and `$'yolo.json'` all name yolo.json.
	for (const command of [
		"{ cd .heli-harness/state; echo x > yolo.json; }",
		"if true; then cd .heli-harness/state; echo x > yolo.json; fi",
		"if true; then cd .heli-harness/state\necho x > yolo.json\nfi",
		"for i in 1; do cd .heli-harness/state; echo x > yolo.json; done",
		"while true; do cd .heli-harness/state; echo x > yolo.json; break; done",
		"if false; then :; else cd .heli-harness/state; echo x > yolo.json; fi",
		"builtin cd .heli-harness/state && echo x > yolo.json",
		"command cd .heli-harness/state && echo x > yolo.json",
		"command -- cd .heli-harness/state && echo x > yolo.json",
		"time cd .heli-harness/state && echo x > yolo.json",
		"! cd .heli-harness/state && echo x > yolo.json",
		"CDPATH= cd .heli-harness/state && echo x > yolo.json",
		"f() { cd .heli-harness/state; echo x > yolo.json; }; f",
		"cd .heli-harness/state && echo x > yolo\\.json",
		"cd .heli-harness/state && echo x > yol''o.json",
		"cd .heli-harness/state && echo x > yolo.js\"\"on",
		"cd .heli-harness/state && echo x > \"yolo\".json",
		"cd .heli-harness/state && echo x > $'yolo.json'",
		"cd .heli-harness/state && echo x > $\"yolo.json\"",
		"echo x > .heli-harness/state/yol''o.json",
		"echo x > .heli-harness/state/\"yolo\".json",
		"echo x > '.heli-harness/state/'yolo.json",
		"echo x > $'.heli-harness/state/yolo.json'",
		// `$'...'` decodes its escapes: \x6f and \157 are an `o`, and `\'` does not end the word.
		"echo x > $'.heli-harness/state/yol\\x6f.json'",
		"cd .heli-harness/state && echo x > $'yol\\157.json'",
		"echo x > $'.heli-harness/state/\\x79olo.json'",
		"echo $'it\\'s'; echo x > .heli-harness/state/yolo.json",
		"echo $'\\''; cd .heli-harness/state; echo x > yolo.json",
		"echo x >| .heli-harness/state/yol\\o.json",
		"exec 3<>.heli-harness/state/yol\"\"o.json",
	]) {
		assert.equal(shell(command).code, "HELI_STATE_PROTECTED", command);
	}
	for (const command of [
		"if true; then cd src; echo x > out.txt; fi",
		"builtin cd docs && echo x > notes.txt",
		"! cd docs && echo x > yolo.json",
		"echo x > 'my notes.txt'",
		"echo x > \"my\"' notes'.txt",
		"echo x > $'my\\x20notes.txt'",
	]) {
		assert.equal(shell(command).deny, false, command);
	}
	for (const [command, expected] of [
		["echo x > yol''o.json", ["yolo.json"]],
		["echo x > \"yo\"lo.json", ["yolo.json"]],
		["echo x > 'a b'c", ["a bc"]],
		["echo x > $'a.json'", ["a.json"]],
		// The POSIX reading decodes the escapes; the Windows reading of the same text keeps them as written, and both are checked.
		["echo x > $'a\\x62.json'", ["a\\x62.json", "ab.json"]],
		["echo x > $'it\\'s.json'", ["it's.json", "it\\s.json"]],
		["echo x > \"a b\"", ["a b"]],
		["echo x >| \"a b\"", ["a b"]],
		["echo x > \"\"", []],
	]) {
		assert.deepEqual(targetsOf(command), expected, command);
	}
	// The option readers stay linear on hostile words: one long cluster of letters, one program named over and over.
	for (const command of [
		`tar -${"x".repeat(nearLimit - 8)}f`,
		`tar ${"x".repeat(nearLimit - 8)}`,
		`unzip -${"d".repeat(nearLimit - 10)}`,
		`unzip -${"l".repeat(nearLimit - 10)}!`,
		`curl -${"s".repeat(nearLimit - 10)}o`,
		`sort -${"o".repeat(nearLimit - 10)}`,
		`rsync -${"a".repeat(nearLimit - 10)}e`,
		`iwr -${"o".repeat(nearLimit - 10)}`,
		`${"tar ".repeat(60)}-xf a`,
		`${"rsync ".repeat(40)}${Array.from({ length: 200 }, (_, i) => `a${i}`).join(" ")}`,
		// Every appearance of a program is read to the end of its segment: many appearances, then one very long word.
		`${"tar ".repeat(120)}-${"x".repeat(nearLimit - 600)}f`,
		`${"curl ".repeat(120)}-${"s".repeat(nearLimit - 700)}o`,
		`${"rsync ".repeat(120)}-${"a".repeat(nearLimit - 900)}e`,
		`cp -${"a".repeat(nearLimit - 8)}`,
		`cp -${"a".repeat(nearLimit - 8)}t`,
		`${"cp ".repeat(120)}${Array.from({ length: 100 }, () => `-${"a".repeat(400)}`).join(" ")}`,
		`${"echo x >|a ".repeat(3000)}`,
		`${"echo x <>a ".repeat(3000)}`,
		`x${"=>".repeat(20000)}`,
	]) {
		within(400, `option readers on ${command.slice(0, 24)}...`, () => shellWriteTargets(analyzeCommand(command)));
	}
	// The settings checks stay linear on hostile text too: a file tool's content is not limited by the command budget, so
	// these are far past it: long runs of whitespace after a key, one name repeated, a quote-and-bracket run.
	const hostileSize = 100000;
	for (const text of [
		`disableAllHooks${" ".repeat(hostileSize)}x`,
		`"disableAllHooks"${" ".repeat(hostileSize)}x`,
		`disableAllHooks -Value${" ".repeat(hostileSize)}x`,
		"disableAllHooks = ".repeat(hostileSize / 18),
		"heli-harness@".repeat(hostileSize / 13),
		`heli-harness@x"]${" ".repeat(hostileSize)}y`,
		"HELI_A ".repeat(hostileSize / 7),
		`"HELI_A"${" ".repeat(hostileSize)}x`,
	]) {
		within(400, `settings checks on ${text.slice(0, 24)}...`, () => [
			disablesClaudeHooks(text),
			disablesClaudeHooks(text, { loose: true }),
			heliEnvironmentKeys(text),
			heliEnvironmentKeys(text, { loose: true }),
		]);
	}

	// 18. Fix round 1. The `env` block of a Claude settings file can reach Heli's hook processes, so a settings write that
	// sets a HELI_ variable (YOLO, GUARDS, ALLOW_*, or the data/config dir that holds the grants) is refused, whatever tool
	// or spelling carries it. Other settings, and other env variables, stay writable.
	const envBlock = (variables) => JSON.stringify({ env: variables });
	const yoloEnv = envBlock({ HELI_YOLO: "1" });
	for (const content of [
		yoloEnv,
		envBlock({ HELI_GUARDS: "off" }),
		envBlock({ HELI_ALLOW_GIT_PUSH: "1", HELI_ALLOW_ENV_WRITE: "1" }),
		envBlock({ HELI_DATA_DIR: join(scratch, "forged-data") }),
		envBlock({ HELI_CONFIG_DIR: join(scratch, "forged-config") }),
		envBlock({ HELI_SESSION_ID: "heli-ses-owner" }),
		envBlock({ FOO: "1", HELI_YOLO: "1" }),
		"{\"env\":{\"heli_yolo\":\"1\"}}",
		"{\n  \"env\": {\n    \"HELI_YOLO\"\n    :\n    \"1\"\n  }\n}",
		"{\"env\":{\"HELI\\u005fYOLO\":\"1\"}}",
		"{\"env\":{\"\\u0048ELI_YOLO\":\"1\"}}",
	]) {
		const result = settings(".claude/settings.json", content);
		assert.equal(result.deny, true, `env block: ${content}`);
		assert.equal(result.code, "HELI_STATE_PROTECTED", `${content}: ${result.reason}`);
		assert.match(result.reason, /Heli-Harness protects its own authority state/, content);
	}
	// Every settings file: project, user, CLAUDE_CONFIG_DIR, and the local variants.
	for (const filePath of [".claude/settings.local.json", "sub/.claude/settings.json", join(hostHome, ".claude", "settings.json"), join(hostHome, ".claude", "settings.local.json")]) {
		assert.equal(settings(filePath, yoloEnv).code, "HELI_STATE_PROTECTED", filePath);
	}
	assert.equal(evaluate(ws, "Write", { file_path: join(claudeConfigDir, "settings.json"), content: yoloEnv }, { ...asOwner, CLAUDE_CONFIG_DIR: claudeConfigDir }).code, "HELI_STATE_PROTECTED", "CLAUDE_CONFIG_DIR");
	assert.equal(evaluate(dotfiles, "Write", { file_path: ".claude/settings.json", content: yoloEnv }).code, "HELI_STATE_PROTECTED", "a linked .claude");
	// Every tool that can write it.
	const envEdit = { old_string: "\"env\": {}", new_string: "\"env\": {\"HELI_YOLO\": \"1\"}" };
	for (const [toolName, toolInput] of [
		["Edit", { file_path: ".claude/settings.json", ...envEdit }],
		["MultiEdit", { file_path: ".claude/settings.json", edits: [{ old_string: "a", new_string: "b" }, envEdit] }],
		["NotebookEdit", { notebook_path: ".claude/settings.json", new_source: yoloEnv, edit_mode: "replace" }],
		["str_replace_editor", { command: "str_replace", path: ".claude/settings.json", old_str: "{}", new_str: yoloEnv }],
		["mcp__filesystem__write_file", { path: ".claude/settings.json", content: yoloEnv }],
		["mcp__filesystem__edit_file", { path: ".claude/settings.json", edits: [{ oldText: "{}", newText: yoloEnv }] }],
		["apply_patch", { command: `*** Begin Patch\n*** Update File: .claude/settings.json\n@@\n-{}\n+${yoloEnv}\n*** End Patch\n` }],
		["apply_patch", { command: `*** Begin Patch\n*** Add File: .claude/settings.local.json\n+${yoloEnv}\n*** End Patch\n` }],
	]) {
		const result = evaluate(ws, toolName, toolInput, asOwner);
		assert.equal(result.code, "HELI_STATE_PROTECTED", `${toolName}: ${result.reason}`);
		assert.match(result.reason, /protects its own authority state/, toolName);
	}
	// A shell edit may not spell the setting as JSON: jq and PowerShell assign it, so a shell command that writes a settings
	// file is read for the variable's name wherever it appears (a file tool is read for JSON keys, so a value that only
	// mentions one is fine there).
	for (const command of [
		"jq '.env.HELI_YOLO=\"1\"' .claude/settings.json > /tmp/settings.json && mv /tmp/settings.json .claude/settings.json",
		"jq '.env += {\"HELI_DATA_DIR\": \"/forged\"}' .claude/settings.json | tee .claude/settings.local.json",
		"$s = Get-Content .claude/settings.json | ConvertFrom-Json; $s.env.HELI_YOLO = '1'; $s | ConvertTo-Json | Set-Content .claude/settings.json",
		"sed -i 's/{}/{\"env\":{\"HELI_GUARDS\":\"off\"}}/' .claude/settings.json",
		"printf '%s' \"$JSON\" > .claude/settings.json # sets HELI_ALLOW_GIT_PUSH",
	]) {
		const result = evaluate(legacy, "Bash", { command });
		assert.equal(result.code, "HELI_STATE_PROTECTED", `${command}: ${result.reason}`);
	}
	assert.equal(evaluate(legacy, "Bash", { command: "jq '.model=\"opus\"' .claude/settings.json > /tmp/settings.json" }).deny, false, "a jq edit of something else");
	assert.equal(evaluate(legacy, "Bash", { command: "echo HELI_YOLO > notes.txt" }).deny, false, "mentioning a variable is not writing settings");
	// Shell writes, from the project and from the user's home.
	for (const [command, extraEnv] of [
		[`echo '${yoloEnv}' > .claude/settings.local.json`, {}],
		[`printf '${yoloEnv}' | tee .claude/settings.json`, {}],
		[`cat > .claude/settings.json <<'EOF'\n${envBlock({ HELI_DATA_DIR: "/forged" })}\nEOF`, {}],
		[`echo '${yoloEnv}' > ~/.claude/settings.json`, homeEnv],
		[`sed -i 's/{}/${yoloEnv}/' .claude/settings.json`, {}],
		[`echo '${yoloEnv}' >> "${join(claudeConfigDir, "settings.json")}"`, { CLAUDE_CONFIG_DIR: claudeConfigDir }],
	]) {
		const result = evaluate(legacy, "Bash", { command }, extraEnv);
		assert.equal(result.code, "HELI_STATE_PROTECTED", `${command}: ${result.reason}`);
	}
	// What stays allowed: other env variables and settings, values that merely mention HELI_, and files that are not settings.
	for (const content of [
		envBlock({ FOO: "1" }),
		envBlock({ NODE_OPTIONS: "--max-old-space-size=4096" }),
		envBlock({ NOT_HELI_YOLO: "1", MYHELI_X: "1" }),
		JSON.stringify({ permissions: { allow: ["Bash(HELI_YOLO=1 npm test)"] } }),
		JSON.stringify({ model: "HELI_YOLO" }),
	]) {
		assert.equal(settings(".claude/settings.json", content).deny, false, content);
	}
	for (const filePath of ["docs/config.json", ".claude/notes.json", "docs/settings.json", ".claude-backup/settings.json"]) {
		assert.equal(settings(filePath, yoloEnv).deny, false, filePath);
	}
	assert.equal(evaluate(legacy, "Bash", { command: "echo HELI_YOLO=1 > notes.txt" }).deny, false);
	assert.equal(evaluate(legacy, "Bash", { command: "export HELI_YOLO=1" }).deny, false);
	// Claude's MultiEdit and NotebookEdit are file writers like Edit and Write: an observer may not use them on source, and the
	// lease holder may.
	for (const [toolName, toolInput] of [
		["MultiEdit", { file_path: "src/app.js", edits: [{ old_string: "a", new_string: "b" }] }],
		["NotebookEdit", { notebook_path: "src/analysis.ipynb", new_source: "print(1)", edit_mode: "replace" }],
	]) {
		assert.equal(evaluate(ws, toolName, toolInput, asObserver).code, "NOT_WRITE_MODE", `${toolName} needs write authority`);
		assert.equal(evaluate(ws, toolName, toolInput, asOwner).deny, false, `${toolName} by the lease holder`);
		assert.equal(evaluate(ws, toolName, { ...toolInput, [toolName === "MultiEdit" ? "file_path" : "notebook_path"]: ".heli-harness/tasks/t1/yolo.json" }, asOwner).code, "HELI_STATE_PROTECTED", `${toolName} on Heli state`);
	}

	// 19. Fix round 1. Turning hooks back on, or taking an injected variable out, is not the attack: only the text a write puts
	// in the file is read (the new string of an edit, the content of a write, the added lines of a patch), never the text it
	// replaces. The same tools writing the disabling text are still refused.
	const hooksOff = "\"disableAllHooks\": true";
	const hooksOn = "\"disableAllHooks\": false";
	const pluginOff = "\"enabledPlugins\": {\"heli-harness@heli-harness\": false}";
	const pluginOn = "\"enabledPlugins\": {\"heli-harness@heli-harness\": true}";
	const injected = "\"env\": {\"HELI_YOLO\": \"1\"}";
	const clean = "\"env\": {}";
	const patchOf = (removed, added) => `*** Begin Patch\n*** Update File: .claude/settings.json\n@@\n-  ${removed}\n+  ${added}\n*** End Patch\n`;
	// [how the tool spells an edit, the tool call for (old text, new text)]
	const editForms = [
		["Edit", (oldText, newText) => ["Edit", { file_path: ".claude/settings.json", old_string: oldText, new_string: newText }]],
		["Edit (replace_all)", (oldText, newText) => ["Edit", { file_path: ".claude/settings.json", old_string: oldText, new_string: newText, replace_all: true }]],
		["MultiEdit", (oldText, newText) => ["MultiEdit", { file_path: ".claude/settings.json", edits: [{ old_string: oldText, new_string: newText }] }]],
		["MultiEdit, second edit", (oldText, newText) => ["MultiEdit", { file_path: ".claude/settings.json", edits: [{ old_string: "a", new_string: "b" }, { old_string: oldText, new_string: newText }] }]],
		["str_replace_editor", (oldText, newText) => ["str_replace_editor", { command: "str_replace", path: ".claude/settings.json", old_str: oldText, new_str: newText }]],
		["camelCase fields", (oldText, newText) => ["Edit", { file_path: ".claude/settings.json", oldString: oldText, newString: newText }]],
		["MCP edit_file", (oldText, newText) => ["mcp__filesystem__edit_file", { path: ".claude/settings.json", edits: [{ oldText, newText }] }]],
		["apply_patch", (oldText, newText) => ["apply_patch", { command: patchOf(oldText, newText) }]],
	];
	for (const [label, form] of editForms) {
		for (const [oldText, newText, what] of [[hooksOff, hooksOn, "hooks back on"], [pluginOff, pluginOn, "plugin back on"], [injected, clean, "injected variable removed"]]) {
			const [toolName, toolInput] = form(oldText, newText);
			const result = evaluate(ws, toolName, toolInput, asOwner);
			assert.equal(result.deny, false, `${label}, ${what}: ${result.code} ${result.reason}`);
		}
		for (const [oldText, newText, code, what] of [
			[hooksOn, hooksOff, "HELI_HOOKS_PROTECTED", "hooks off"],
			[pluginOn, pluginOff, "HELI_HOOKS_PROTECTED", "plugin off"],
			[clean, injected, "HELI_STATE_PROTECTED", "variable injected"],
			[hooksOff, `${hooksOff}, "x": 1`, "HELI_HOOKS_PROTECTED", "hooks still off after a reformat"],
		]) {
			const [toolName, toolInput] = form(oldText, newText);
			assert.equal(evaluate(ws, toolName, toolInput, asOwner).code, code, `${label}, ${what}`);
		}
	}
	assert.equal(settings(".claude/settings.json", `{${hooksOn}}`).deny, false, "a Write that says hooks are on");
	// A shell command is read whole, as before, and its assignment spellings (jq, PowerShell) count as JSON does.
	assert.equal(evaluate(legacy, "Bash", { command: `echo '{${hooksOff}}' > .claude/settings.json` }).code, "HELI_HOOKS_PROTECTED");
	for (const command of [
		"jq '.disableAllHooks=true' .claude/settings.json > /tmp/s.json && mv /tmp/s.json .claude/settings.json",
		"jq '.disableAllHooks = true' .claude/settings.json | tee .claude/settings.local.json",
		"$s = Get-Content .claude/settings.json | ConvertFrom-Json; $s | Add-Member disableAllHooks $true -Force; $s.disableAllHooks = $true; $s | ConvertTo-Json | Set-Content .claude/settings.json",
		"jq '.enabledPlugins[\"heli-harness@heli-harness\"]=false' .claude/settings.json | tee .claude/settings.json",
		"$s.enabledPlugins.'heli-harness@heli-harness' = $false; $s | ConvertTo-Json | Set-Content .claude/settings.json",
	]) {
		assert.equal(evaluate(legacy, "Bash", { command }).code, "HELI_HOOKS_PROTECTED", command);
	}
	for (const command of ["jq '.disableAllHooks=false' .claude/settings.json | tee .claude/settings.json", "$s.disableAllHooks = $false; $s | ConvertTo-Json | Set-Content .claude/settings.json"]) {
		assert.equal(evaluate(legacy, "Bash", { command }).deny, false, command);
	}

	// 20. Fix round 1. This test is part of `npm run check`, and the chain that runs it is well formed: every step is a `node`
	// command joined to the next by ` && ` (an edit once left `&&node`), with this test right after the command-rules test.
	const checkChain = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts.check;
	assert.ok(!/&&(?! )|(?<! )&&/.test(checkChain), "every && in scripts.check has a space on both sides");
	for (const step of checkChain.split(" && ")) {
		assert.match(step, /^node (?:--check )?[\w./-]+\.m?js(?: --check)?$/, `a well-formed step: ${step}`);
	}
	assert.ok(checkChain.includes("node scripts/smoke-command-rules.mjs && node scripts/smoke-self-protection.mjs && node scripts/smoke-concurrency-foundation.mjs"), "smoke-self-protection runs right after smoke-command-rules");

	// 21. A path with hundreds of missing directories is resolved like a short one, and does not cost a lookup per directory
	// (one call can carry hundreds of them, and hosts treat a hook that times out as an allow): once the walk up to the nearest
	// directory that exists has gone eight levels without finding one, it is bisected, and the tail is joined in one step.
	const junction = join(ws, "innocent-dir");
	for (const levels of [1, 7, 8, 9, 10, 12, 40, 300]) {
		const tail = `${"m/".repeat(levels)}f.json`;
		const viaLink = normalizePolicyPath(join(junction, tail), { cwd: ws, env });
		const direct = normalizePolicyPath(join(ws, ".heli-harness", "tasks", "t1", tail), { cwd: ws, env });
		assert.equal(viaLink.path, direct.path, `the link above ${levels} missing directories is followed`);
		assert.ok(viaLink.path.includes("/.heli-harness/tasks/t1/m/"), viaLink.path);
	}
	// Below a file that exists (nothing lives under it), and from a working directory that is itself missing.
	const harnessFile = join(ws, ".heli-harness", "HARNESS.md");
	const belowFile = normalizePolicyPath(join(harnessFile, "m/".repeat(20), "x"), { cwd: ws, env }).path;
	assert.equal(belowFile, `${normalizePolicyPath(join(harnessFile, "m"), { cwd: ws, env }).path}${"/m".repeat(19)}/x`);
	const missingCwd = join(scratch, "does", "not", "exist");
	const shortFromMissing = normalizePolicyPath("m/x", { cwd: missingCwd, env }).path;
	assert.equal(normalizePolicyPath(`${"m/".repeat(30)}x`, { cwd: missingCwd, env }).path, `${shortFromMissing.slice(0, -"m/x".length)}${"m/".repeat(30)}x`);
	// Siblings that share the missing directories resolve as they do one at a time (they share what the first one found).
	const siblings = [`${"m/".repeat(300)}a.json`, `${"m/".repeat(300)}b.json`, `${"m/".repeat(299)}c.json`, `${"m/".repeat(9)}d.json`, `${"m/".repeat(8)}e.json`, "m/f.json", "m/m/g.json"].map((tail) => join(junction, tail));
	const together = classifyToolPaths(siblings, { workspaceRoot: ws, cwd: ws, env }).map((entry) => entry.normalized);
	assert.deepEqual(together, siblings.map((sibling) => classifyToolPaths([sibling], { workspaceRoot: ws, cwd: ws, env })[0].normalized));
	within(5000, "500 paths of 500 missing directories each", () => classifyToolPaths(Array.from({ length: 500 }, (_, index) => `q${index}/${"a/".repeat(500)}f.md`), { workspaceRoot: ws, cwd: ws, env }));

	console.log("self-protection smoke ok");
} finally {
	rmSync(scratch, { recursive: true, force: true });
}
