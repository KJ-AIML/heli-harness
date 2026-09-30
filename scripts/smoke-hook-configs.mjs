#!/usr/bin/env node
/**
 * PreToolUse hook configs: generous timeouts (a timed-out hook lets the tool
 * run), Claude-valid fields only, and a fail-closed Codex fallback on Windows
 * machines where node is missing.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const adapters = join(root, ".heli-harness", "adapters");
const MIN_TIMEOUT_SECONDS = 30;

function json(rel) {
	return JSON.parse(readFileSync(join(adapters, rel), "utf8"));
}

function preToolHooks(config) {
	const groups = config.hooks?.PreToolUse || config["heli-harness-pretool"]?.PreToolUse || [];
	return groups.flatMap((group) => group.hooks);
}

for (const rel of [
	"claude-plugin/hooks/hooks.json",
	"codex-plugin/hooks/hooks.json",
	"grok-plugin/hooks/hooks.json",
	"grok-plugin/hooks/heli-user-hooks.json",
	"kimi-plugin/hooks/hooks.json",
	"antigravity-plugin/hooks.json",
	"antigravity-plugin/hooks/hooks.json",
]) {
	const hooks = preToolHooks(json(rel));
	assert.ok(hooks.length > 0, `${rel}: PreToolUse hooks missing`);
	for (const hook of hooks) {
		assert.ok(hook.timeout >= MIN_TIMEOUT_SECONDS, `${rel}: PreToolUse timeout ${hook.timeout}s is below ${MIN_TIMEOUT_SECONDS}s`);
	}
}

// Claude command hooks support command/timeout/statusMessage/async/shell;
// commandWindows is a Codex-only field and must not appear in the Claude plugin.
const claude = json("claude-plugin/hooks/hooks.json");
for (const group of [...claude.hooks.SessionStart, ...claude.hooks.PreToolUse]) {
	for (const hook of group.hooks) {
		assert.equal("commandWindows" in hook, false, "Claude hooks.json must not use the Codex-only commandWindows field");
	}
}

// Codex on Windows without node: the fallback branch must print a deny, not silently allow.
const codexPre = preToolHooks(json("codex-plugin/hooks/hooks.json"))[0];
const fallback = /else \{ '(\{.*\})' \}$/.exec(codexPre.commandWindows);
assert.ok(fallback, "Codex commandWindows must have an else branch that prints a PreToolUse deny");
const fallbackDecision = JSON.parse(fallback[1]);
assert.equal(fallbackDecision.hookSpecificOutput.hookEventName, "PreToolUse");
assert.equal(fallbackDecision.hookSpecificOutput.permissionDecision, "deny");
assert.match(fallbackDecision.hookSpecificOutput.permissionDecisionReason, /node was not found.*fail-closed/);
if (process.platform === "win32") {
	// Execute the real Windows command with a PATH that has no node on it.
	const systemRoot = process.env.SystemRoot || "C:\\Windows";
	const run = spawnSync(
		join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
		["-NoProfile", "-NonInteractive", "-Command", codexPre.commandWindows],
		{
			encoding: "utf8",
			env: { SystemRoot: systemRoot, PATH: join(systemRoot, "System32"), CLAUDE_PLUGIN_ROOT: join(adapters, "codex-plugin") },
		},
	);
	assert.equal(run.status, 0, run.stderr);
	assert.equal(JSON.parse(run.stdout.trim()).hookSpecificOutput.permissionDecision, "deny", run.stdout);
}

// The user-level installers write the raised timeout into the host config.
const home = mkdtempSync(join(tmpdir(), "heli-hook-configs-"));
try {
	const env = { ...process.env, HELI_HOST_HOME: home, KIMI_CODE_HOME: join(home, ".kimi-code") };
	for (const installer of ["grok-plugin/install-user-hooks.mjs", "kimi-plugin/install-user-hooks.mjs"]) {
		const result = spawnSync(process.execPath, [join(adapters, installer)], { encoding: "utf8", env });
		assert.equal(result.status, 0, result.stderr || result.stdout);
	}
	const grokUser = JSON.parse(readFileSync(join(home, ".grok", "hooks", "heli-harness.json"), "utf8"));
	for (const hook of preToolHooks(grokUser)) assert.ok(hook.timeout >= MIN_TIMEOUT_SECONDS, `grok user hook timeout ${hook.timeout}`);
	const kimiConfig = readFileSync(join(home, ".kimi-code", "config.toml"), "utf8");
	assert.match(kimiConfig, /event = "PreToolUse"\nmatcher = "\.\*"\ncommand = '[^']*'\ntimeout = 30/);
} finally {
	rmSync(home, { recursive: true, force: true });
}

console.log("hook configs smoke ok");
