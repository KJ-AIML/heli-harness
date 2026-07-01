#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const tempParent = mkdtempSync(join(tmpdir(), "heli-codex-adapter-"));

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
	const adapterDir = join(root, ".heli-harness", "adapters", "codex");
	const adapterEntrypoint = join(adapterDir, "AGENTS.md");
	const adapterReadme = join(adapterDir, "README.md");
	const manifest = json(join(root, ".heli-harness", "adapters", "adapters.json"));
	const matrix = read(join(root, "docs", "ADAPTER_SUPPORT_MATRIX.md"));

	assert.ok(existsSync(adapterDir), "Codex adapter folder should exist");
	assert.ok(existsSync(adapterEntrypoint), "Codex adapter AGENTS.md should exist");
	assert.ok(existsSync(adapterReadme), "Codex adapter README.md should exist");

	const agentsText = read(adapterEntrypoint);
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
		assertContains(agentsText, required, "AGENTS.md");
	}
	assertContains(agentsText, ".heli-harness/HARNESS.md", "AGENTS.md");
	assertContains(agentsText, "Never use `git add .`", "AGENTS.md");
	assertContains(agentsText, "Do not claim support, enforcement", "AGENTS.md");
	assert.doesNotMatch(agentsText, /codex\s+(?:is\s+)?enforced/i, "Codex docs must not claim enforcement");

	const readmeText = read(adapterReadme);
	assertContains(readmeText, "Status: pointer adapter `verified-wired`; native plugin artifacts `verified-plugin-wired`", "Codex README");
	assertContains(readmeText, "No live runtime hook enforcement is proven", "Codex README");
	assertContains(readmeText, "Recommended Codex workflow", "Codex README");

	const codex = manifest.adapters.find((adapter) => adapter.id === "codex");
	assert.ok(codex, "Codex adapter should be present in adapters.json");
	assert.equal(codex.status, "verified-plugin-wired", "Codex adapter should be verified-plugin-wired");
	assert.ok(codex.evidence.includes("scripts/smoke-codex-adapter.mjs"), "Codex manifest should include smoke evidence");
	assert.ok(codex.verification.includes("node scripts/smoke-codex-adapter.mjs"), "Codex manifest should include smoke command");
	for (const evidencePath of codex.evidence) {
		assert.ok(existsSync(join(root, evidencePath)), `Codex evidence should exist: ${evidencePath}`);
	}
	assert.ok(codex.limitations.some((item) => /PreToolUse hook firing.*not yet proven live/i.test(item)), "Codex limitations should say hook firing is not yet proven live");

	assertContains(matrix, "Codex", "support matrix");
	assertContains(matrix, "verified-plugin-wired", "support matrix");
	assertContains(matrix, "node scripts/smoke-codex-adapter.mjs", "support matrix");
	assertContains(matrix, "node scripts/live-verify-codex-plugin-install.mjs", "support matrix");
	assert.match(matrix, /PreToolUse hook firing.*not yet proven live/i, "support matrix should say hook firing is not yet proven live");

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

	const installedPointer = join(tempParent, "AGENTS.md");
	assert.ok(existsSync(installedPointer), "workspace AGENTS.md should be created by install");
	assertContains(read(installedPointer), ".heli-harness/adapters/codex/AGENTS.md", "workspace AGENTS.md");
	assert.ok(existsSync(join(tempParent, ".heli-harness", "HARNESS.md")), "installed HARNESS.md should exist");
	assert.ok(existsSync(join(tempParent, ".heli-harness", "adapters", "codex", "AGENTS.md")), "installed Codex adapter should exist");

	const customAgents = "# User Codex Notes\n\nKeep this local workspace guidance.\n";
	writeFileSync(installedPointer, customAgents);

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

	assert.equal(read(installedPointer), customAgents, "update should preserve user-owned workspace AGENTS.md");
	assert.ok(existsSync(join(tempParent, ".heli-harness", "adapters", "codex", "AGENTS.md")), "update should keep packaged Codex adapter");

	console.log("codex adapter smoke ok");
} finally {
	rmSync(tempParent, { recursive: true, force: true });
}
