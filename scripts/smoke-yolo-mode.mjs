#!/usr/bin/env node
/**
 * Smoke: YOLO mode allows guarded actions; default still denies them.
 * Avoids embedding blocked command phrases in process argv where possible.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const hook = join(root, ".heli-harness", "adapters", "claude-plugin", "hooks", "heli-pre-tool-use.mjs");
assert.ok(existsSync(hook), "claude pre-tool hook missing");

const remoteWrite = ["git", "push", "origin", "main"].join(" ");

function runHook(cwd, sample) {
	const result = spawnSync(process.execPath, [hook], {
		cwd,
		input: JSON.stringify(sample),
		encoding: "utf8",
	});
	let body = {};
	try {
		body = result.stdout.trim() ? JSON.parse(result.stdout) : {};
	} catch {
		body = {};
	}
	const denied =
		body?.hookSpecificOutput?.permissionDecision === "deny" ||
		body?.decision === "deny" ||
		result.status === 2;
	return { denied, body, status: result.status };
}

// 1) Default strict
const strictDir = mkdtempSync(join(tmpdir(), "heli-yolo-strict-"));
try {
	mkdirSync(join(strictDir, ".heli-harness", "state"), { recursive: true });
	writeFileSync(join(strictDir, ".heli-harness", "HARNESS.md"), "# Heli\n");
	const out = runHook(strictDir, {
		tool_name: "Bash",
		tool_input: { command: remoteWrite },
	});
	assert.equal(out.denied, true, "default must deny remote write");
	console.log("smoke-yolo: default deny ok");
} finally {
	rmSync(strictDir, { recursive: true, force: true });
}

// 2) yolo.json allows
const yoloDir = mkdtempSync(join(tmpdir(), "heli-yolo-on-"));
try {
	mkdirSync(join(yoloDir, ".heli-harness", "state"), { recursive: true });
	writeFileSync(join(yoloDir, ".heli-harness", "HARNESS.md"), "# Heli\n");
	writeFileSync(join(yoloDir, ".heli-harness", "state", "yolo.json"), JSON.stringify({ enabled: true }));
	const out = runHook(yoloDir, {
		tool_name: "Bash",
		tool_input: { command: remoteWrite },
	});
	assert.equal(out.denied, false, "yolo.json must allow remote write");
	const envOut = runHook(yoloDir, {
		tool_name: "Write",
		tool_input: { file_path: ".env" },
	});
	assert.equal(envOut.denied, false, "yolo.json must allow .env write");
	console.log("smoke-yolo: yolo.json allow ok");
} finally {
	rmSync(yoloDir, { recursive: true, force: true });
}

// 3) CLI yolo on/off
const cliDir = mkdtempSync(join(tmpdir(), "heli-yolo-cli-"));
try {
	mkdirSync(join(cliDir, ".heli-harness", "state"), { recursive: true });
	writeFileSync(join(cliDir, ".heli-harness", "HARNESS.md"), "# Heli\n");
	const heli = join(root, "bin", "heli.mjs");
	const on = spawnSync(process.execPath, [heli, "yolo", "on", cliDir], { encoding: "utf8" });
	assert.equal(on.status, 0, on.stderr || on.stdout);
	assert.ok(existsSync(join(cliDir, ".heli-harness", "state", "yolo.json")));
	const allowed = runHook(cliDir, {
		tool_name: "Bash",
		tool_input: { command: remoteWrite },
	});
	assert.equal(allowed.denied, false, "after heli yolo on must allow");
	const off = spawnSync(process.execPath, [heli, "yolo", "off", cliDir], { encoding: "utf8" });
	assert.equal(off.status, 0, off.stderr || off.stdout);
	const deniedAgain = runHook(cliDir, {
		tool_name: "Bash",
		tool_input: { command: remoteWrite },
	});
	assert.equal(deniedAgain.denied, true, "after heli yolo off must deny");
	console.log("smoke-yolo: heli yolo on/off ok");
} finally {
	rmSync(cliDir, { recursive: true, force: true });
}

// 4) shared hook-core
const corePath = join(root, ".heli-harness", "adapters", "shared", "hook-core.mjs");
const core = await import(pathToFileURL(corePath).href);
const tmp = mkdtempSync(join(tmpdir(), "heli-yolo-core-"));
try {
	mkdirSync(join(tmp, ".heli-harness", "state"), { recursive: true });
	writeFileSync(join(tmp, ".heli-harness", "HARNESS.md"), "# Heli\n");
	assert.equal(core.isYoloActive(tmp).active, false);
	writeFileSync(join(tmp, ".heli-harness", "state", "yolo.json"), JSON.stringify({ enabled: true }));
	assert.equal(core.isYoloActive(tmp).active, true);
	const evalAllow = core.evaluatePreToolUse({
		cwd: tmp,
		toolName: "Bash",
		toolInput: { command: remoteWrite },
	});
	assert.equal(evalAllow.deny, false);
	console.log("smoke-yolo: hook-core ok");
} finally {
	rmSync(tmp, { recursive: true, force: true });
}

console.log("smoke-yolo-mode: ok");
