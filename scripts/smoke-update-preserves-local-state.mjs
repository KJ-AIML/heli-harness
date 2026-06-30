#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { platform } from "node:os";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const tempParent = mkdtempSync(join(tmpdir(), "heli-update-preserve-"));

function run(command, args) {
	const result = spawnSync(command, args, {
		cwd: root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (result.status !== 0) {
		throw new Error(
			`${command} ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
		);
	}
	return result;
}

function read(path) {
	return readFileSync(path, "utf8").trim();
}

try {
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

	const harnessRoot = join(tempParent, ".heli-harness");
	const customIndex = JSON.stringify({
		schemaVersion: 1,
		workspaceRoot: ".",
		repos: [
			{
				name: "real-app",
				path: "real-app",
				gitRoot: "real-app",
				profile: ".heli-harness/profiles/real-app.md",
				defaultTarget: true,
				notes: "user workspace config",
			},
		],
	}, null, 2);
	const customTarget = JSON.stringify({
		schemaVersion: 1,
		targetRepo: "real-app",
		targetGitRoot: "real-app",
		writesAllowedUnder: "real-app",
		activeProfile: ".heli-harness/profiles/real-app.md",
		selectedAt: "2026-06-30T00:00:00.000Z",
		selectedBy: "smoke",
		reason: "preserve local target",
	}, null, 2);
	const customPolicy = "# Engineering\n\nUser workspace policy must survive updates.\n";
	const customSafety = JSON.stringify({
		version: 1,
		rules: [{ id: "custom", match: "custom", tier: "T6", reason: "custom rule" }],
	}, null, 2);

	writeFileSync(join(harnessRoot, "workspace", "index.json"), `${customIndex}\n`);
	writeFileSync(join(harnessRoot, "workspace", "target.json"), `${customTarget}\n`);
	writeFileSync(join(harnessRoot, "policies", "engineering.md"), customPolicy);
	writeFileSync(join(harnessRoot, "safety", "command-rules.json"), `${customSafety}\n`);

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

	assert.equal(read(join(harnessRoot, "workspace", "index.json")), customIndex);
	assert.equal(read(join(harnessRoot, "workspace", "target.json")), customTarget);
	assert.equal(read(join(harnessRoot, "policies", "engineering.md")), customPolicy.trim());
	assert.equal(read(join(harnessRoot, "safety", "command-rules.json")), customSafety);

	console.log("update preserve smoke ok");
} finally {
	rmSync(tempParent, { recursive: true, force: true });
}
