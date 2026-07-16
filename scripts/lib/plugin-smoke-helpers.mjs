import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
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

/**
 * SessionStart must not run against the package checkout — createIfMissing mints
 * sessions/bindings under .heli-harness/ and pollutes the publishable tree.
 */
export function assertSessionContext(root, relScript) {
	withFixtureWorkspace(
		{
			".heli-harness/HARNESS.md": "# Heli-Harness\n",
			".heli-harness/state/current-task.md":
				"# Current Task\n\nTask: (none — idle)\n\nMode: idle\n\nCurrent status: complete\n\nFailed attempts count: 0\n",
			".heli-harness/workspace/target.json": JSON.stringify(
				{
					schemaVersion: 1,
					targetRepo: "",
					targetGitRoot: "",
					writesAllowedUnder: "",
					activeProfile: "",
					selectedAt: "",
					selectedBy: "",
					reason: "fixture — no target selected",
				},
				null,
				2,
			),
		},
		(cwd) => {
			const result = spawnSync(process.execPath, [join(root, relScript)], {
				cwd,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			});
			assert.equal(result.status, 0, result.stderr);
			const output = JSON.parse(result.stdout);
			assert.equal(output.hookSpecificOutput.hookEventName, "SessionStart");
			assert.match(output.hookSpecificOutput.additionalContext, /Heli-Harness plugin context/);
			assert.match(output.hookSpecificOutput.additionalContext, /\.heli-harness\/HARNESS\.md/);
			// Skill bootstrap must appear exactly once and remain distinct from governance context.
			const ctx = output.hookSpecificOutput.additionalContext;
			assert.match(ctx, /Heli skill usage:/);
			assert.match(ctx, /using-heli-skills/);
			assert.match(ctx, /mandatory workflow resources/);
			const bootstrapHits = ctx.split("Heli skill usage:").length - 1;
			assert.equal(bootstrapHits, 1, "skill bootstrap must appear exactly once per SessionStart");
		},
	);
}

export function nodeCheck(root, relScript) {
	const result = spawnSync(process.execPath, ["--check", join(root, relScript)], {
		cwd: root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	assert.equal(result.status, 0, result.stderr);
}

export function withFixtureWorkspace(files, fn) {
	const dir = mkdtempSync(join(tmpdir(), "heli-hook-fixture-"));
	try {
		for (const [rel, content] of Object.entries(files)) {
			const full = join(dir, rel);
			mkdirSync(dirname(full), { recursive: true });
			writeFileSync(full, content);
		}
		const result = fn(dir);
		// Async callers get a Promise that cleans up after completion.
		if (result && typeof result.then === "function") {
			return Promise.resolve(result).finally(() => {
				rmSync(dir, { recursive: true, force: true });
			});
		}
		rmSync(dir, { recursive: true, force: true });
		return result;
	} catch (err) {
		rmSync(dir, { recursive: true, force: true });
		throw err;
	}
}

export function assertHookDenyInCwd(root, relScript, cwd, sample, expectedReason) {
	const result = spawnSync(process.execPath, [join(root, relScript)], {
		cwd,
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

export function assertHookAllowInCwd(root, relScript, cwd, sample) {
	const result = spawnSync(process.execPath, [join(root, relScript)], {
		cwd,
		input: JSON.stringify(sample),
		encoding: "utf8",
		stdio: ["pipe", "pipe", "pipe"],
	});
	assert.equal(result.status, 0, result.stderr);
	const output = result.stdout.trim() ? JSON.parse(result.stdout) : {};
	assert.notEqual(output?.hookSpecificOutput?.permissionDecision, "deny", result.stdout);
}

export function sessionContextInCwd(root, relScript, cwd) {
	const result = spawnSync(process.execPath, [join(root, relScript)], {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	assert.equal(result.status, 0, result.stderr);
	const output = JSON.parse(result.stdout);
	return output.hookSpecificOutput.additionalContext;
}

/** Grok PreToolUse: exit 2 + { decision: "deny", reason } (also Claude-compat fields). */
export function assertGrokHookDeny(root, relScript, sample, expectedReason) {
	const result = spawnSync(process.execPath, [join(root, relScript)], {
		cwd: root,
		input: JSON.stringify(sample),
		encoding: "utf8",
		stdio: ["pipe", "pipe", "pipe"],
	});
	assert.equal(result.status, 2, `expected exit 2, got ${result.status}: ${result.stderr}`);
	const output = JSON.parse(result.stdout);
	assert.equal(output.decision, "deny");
	assert.match(output.reason, expectedReason);
}

export function assertGrokHookDenyInCwd(root, relScript, cwd, sample, expectedReason) {
	const result = spawnSync(process.execPath, [join(root, relScript)], {
		cwd,
		input: JSON.stringify(sample),
		encoding: "utf8",
		stdio: ["pipe", "pipe", "pipe"],
	});
	assert.equal(result.status, 2, `expected exit 2, got ${result.status}: ${result.stderr}`);
	const output = JSON.parse(result.stdout);
	assert.equal(output.decision, "deny");
	assert.match(output.reason, expectedReason);
}

export function assertGrokHookAllowInCwd(root, relScript, cwd, sample) {
	const result = spawnSync(process.execPath, [join(root, relScript)], {
		cwd,
		input: JSON.stringify(sample),
		encoding: "utf8",
		stdio: ["pipe", "pipe", "pipe"],
	});
	assert.equal(result.status, 0, result.stderr);
	if (result.stdout.trim()) {
		const output = JSON.parse(result.stdout);
		assert.notEqual(output.decision, "deny", result.stdout);
	}
}
