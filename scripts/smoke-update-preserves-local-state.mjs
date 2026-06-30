#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";
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

function write(path, content) {
	const dir = join(path, "..");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(path, content);
}

try {
	// Simulate an installed harness by copying .heli-harness/ to temp parent
	const harnessRoot = join(tempParent, ".heli-harness");
	mkdirSync(harnessRoot, { recursive: true });

	// Copy the source .heli-harness/ to simulate an existing install
	const sourceRoot = join(root, ".heli-harness");
	const sourceDirs = ["profiles", "workspace", "policies", "safety", "state", "skills", "templates", "adapters"];
	for (const dir of sourceDirs) {
		const src = join(sourceRoot, dir);
		const dst = join(harnessRoot, dir);
		if (existsSync(src)) {
			run(platform() === "win32" ? "powershell" : "cp",
				platform() === "win32"
					? ["-Command", `Copy-Item -LiteralPath "${src}" -Destination "${dst}" -Recurse -Force`]
					: ["-R", src, dst]);
		}
	}
	// Copy essential root files
	for (const file of ["HARNESS.md", "manifest.json"]) {
		const src = join(sourceRoot, file);
		if (existsSync(src)) {
			run("cp", [src, join(harnessRoot, file)]);
		}
	}

	// Write custom local overlay files
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
	const customState = "# Custom Task\n\nUser state must survive updates.\n";
	const customProfile = "# Real App\n\nUser profile must survive updates.\n";

	writeFileSync(join(harnessRoot, "workspace", "index.json"), `${customIndex}\n`);
	writeFileSync(join(harnessRoot, "workspace", "target.json"), `${customTarget}\n`);
	writeFileSync(join(harnessRoot, "policies", "engineering.md"), customPolicy);
	writeFileSync(join(harnessRoot, "safety", "command-rules.json"), `${customSafety}\n`);
	writeFileSync(join(harnessRoot, "state", "current-task.md"), customState);
	writeFileSync(join(harnessRoot, "profiles", "real-app.md"), customProfile);

	// Run update
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

	// Assert local overlay files are preserved
	assert.equal(read(join(harnessRoot, "workspace", "index.json")), customIndex, "workspace/index.json should be preserved");
	assert.equal(read(join(harnessRoot, "workspace", "target.json")), customTarget, "workspace/target.json should be preserved");
	assert.equal(read(join(harnessRoot, "policies", "engineering.md")), customPolicy.trim(), "policies/engineering.md should be preserved");
	assert.equal(read(join(harnessRoot, "safety", "command-rules.json")), customSafety, "safety/command-rules.json should be preserved");
	assert.equal(read(join(harnessRoot, "state", "current-task.md")), customState.trim(), "state/current-task.md should be preserved");
	assert.equal(read(join(harnessRoot, "profiles", "real-app.md")), customProfile.trim(), "profiles/real-app.md should be preserved");

	// Assert packaged files can still update (HARNESS.md should exist and be from package)
	assert.ok(existsSync(join(harnessRoot, "HARNESS.md")), "HARNESS.md should exist after update");
	assert.ok(existsSync(join(harnessRoot, "manifest.json")), "manifest.json should exist after update");

	console.log("update preserve smoke ok");
} finally {
	rmSync(tempParent, { recursive: true, force: true });
}
