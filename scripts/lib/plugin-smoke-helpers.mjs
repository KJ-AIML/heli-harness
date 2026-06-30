import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export function read(path) {
	return readFileSync(path, "utf8");
}

export function json(path) {
	return JSON.parse(read(path));
}

export function assertFile(path, label = path) {
	assert.ok(existsSync(path), `${label} should exist`);
}

export function assertHookDeny(root, relScript, sample, expectedReason) {
	const result = spawnSync(process.execPath, [join(root, relScript)], {
		cwd: root,
		input: JSON.stringify(sample),
		encoding: "utf8",
		stdio: ["pipe", "pipe", "pipe"],
	});
	assert.equal(result.status, 0, result.stderr);
	const output = JSON.parse(result.stdout);
	assert.equal(output.hookSpecificOutput.hookEventName, "PreToolUse");
	assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
	assert.match(output.hookSpecificOutput.permissionDecisionReason, expectedReason);
}

export function assertSessionContext(root, relScript) {
	const result = spawnSync(process.execPath, [join(root, relScript)], {
		cwd: root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	assert.equal(result.status, 0, result.stderr);
	const output = JSON.parse(result.stdout);
	assert.equal(output.hookSpecificOutput.hookEventName, "SessionStart");
	assert.match(output.hookSpecificOutput.additionalContext, /Heli-Harness plugin context/);
	assert.match(output.hookSpecificOutput.additionalContext, /\.heli-harness\/HARNESS\.md/);
}

export function nodeCheck(root, relScript) {
	const result = spawnSync(process.execPath, ["--check", join(root, relScript)], {
		cwd: root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	assert.equal(result.status, 0, result.stderr);
}
