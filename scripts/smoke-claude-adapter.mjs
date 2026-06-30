#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const tempParent = mkdtempSync(join(tmpdir(), "heli-claude-adapter-"));

function read(path) {
	return readFileSync(path, "utf8");
}

function json(path) {
	return JSON.parse(read(path));
}

function run(command, args) {
	const result = spawnSync(command, args, {
		cwd: root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (result.status !== 0) {
		throw new Error(
			`${command} ${args.join(" ")} failed\nerror:\n${result.error?.message ?? "none"}\nstdout:\n${result.stdout ?? ""}\nstderr:\n${result.stderr ?? ""}`,
		);
	}
	return result;
}

function assertContains(text, expected, label) {
	assert.ok(text.includes(expected), `${label} should include ${expected}`);
}

try {
	const adapterDir = join(root, ".heli-harness", "adapters", "claude");
	const adapterEntrypoint = join(adapterDir, "CLAUDE.md");
	const settingsExample = join(adapterDir, "settings.local.json.example");
	const manifest = json(join(root, ".heli-harness", "adapters", "adapters.json"));
	const matrix = read(join(root, "docs", "ADAPTER_SUPPORT_MATRIX.md"));

	assert.ok(existsSync(adapterDir), "Claude adapter folder should exist");
	assert.ok(existsSync(adapterEntrypoint), "Claude adapter CLAUDE.md should exist");
	assert.ok(existsSync(settingsExample), "Claude settings example should exist");

	const claudeText = read(adapterEntrypoint);
	for (const required of [
		"Heli-Harness identity",
		"Read first",
		"Target repo discipline",
		"Write boundaries",
		"Safety rules",
		"Command tiers",
		"Claims require evidence",
		"Validation before completion",
		"Final reports",
		"Limitations",
	]) {
		assertContains(claudeText, required, "CLAUDE.md");
	}
	assertContains(claudeText, ".heli-harness/HARNESS.md", "CLAUDE.md");
	assert.doesNotMatch(claudeText, /claude(?: code)?\s+(?:is\s+)?enforced/i, "Claude docs must not claim enforcement");

	JSON.parse(read(settingsExample));

	const claude = manifest.adapters.find((adapter) => adapter.id === "claude");
	assert.ok(claude, "Claude adapter should be present in adapters.json");
	assert.equal(claude.status, "verified-plugin-wired", "Claude adapter should be verified-plugin-wired");
	assert.ok(claude.evidence.includes("scripts/smoke-claude-adapter.mjs"), "Claude manifest should include smoke evidence");
	assert.ok(claude.verification.includes("node scripts/smoke-claude-adapter.mjs"), "Claude manifest should include smoke command");
	for (const evidencePath of claude.evidence) {
		assert.ok(existsSync(join(root, evidencePath)), `Claude evidence should exist: ${evidencePath}`);
	}
	assert.ok(claude.limitations.some((item) => /No live Claude Code runtime hook enforcement/i.test(item)), "Claude limitations should say no live runtime hook enforcement");

	assertContains(matrix, "Claude Code", "support matrix");
	assertContains(matrix, "verified-plugin-wired", "support matrix");
	assertContains(matrix, "node scripts/smoke-claude-adapter.mjs", "support matrix");
	assertContains(matrix, "No live Claude Code runtime hook enforcement has been proven", "support matrix");

	if (platform() === "win32") {
		run("powershell", [
			"-ExecutionPolicy",
			"Bypass",
			"-File",
			join(root, "install.ps1"),
			"-Parent",
			tempParent,
		]);
	} else {
		run("bash", [join(root, "install.sh"), tempParent]);
	}

	const installedPointer = join(tempParent, "CLAUDE.md");
	assert.ok(existsSync(installedPointer), "workspace CLAUDE.md should be created by install");
	assertContains(read(installedPointer), ".heli-harness/adapters/claude/CLAUDE.md", "workspace CLAUDE.md");
	assert.ok(existsSync(join(tempParent, ".heli-harness", "HARNESS.md")), "installed HARNESS.md should exist");
	assert.ok(existsSync(join(tempParent, ".heli-harness", "adapters", "claude", "CLAUDE.md")), "installed Claude adapter should exist");
	assert.ok(existsSync(join(tempParent, ".heli-harness", "adapters", "claude", "settings.local.json.example")), "installed Claude settings example should exist");

	const customClaude = "# User Claude Notes\n\nKeep this local workspace guidance.\n";
	writeFileSync(installedPointer, customClaude);

	if (platform() === "win32") {
		run("powershell", [
			"-ExecutionPolicy",
			"Bypass",
			"-File",
			join(root, "update.ps1"),
			"-Parent",
			tempParent,
		]);
	} else {
		run("bash", [join(root, "update.sh"), tempParent]);
	}

	assert.equal(read(installedPointer), customClaude, "update should preserve user-owned workspace CLAUDE.md");
	assert.ok(existsSync(join(tempParent, ".heli-harness", "adapters", "claude", "CLAUDE.md")), "update should keep packaged Claude adapter");

	console.log("claude adapter smoke ok");
} finally {
	rmSync(tempParent, { recursive: true, force: true });
}
