#!/usr/bin/env node
/**
 * Live Codex proof for v0.5.24 concurrent enforcement.
 * Isolated CODEX_HOME; real codex exec. Not in npm run check.
 *
 * Requires: codex CLI + ~/.codex/auth.json
 * Optional: HELI_LIVE_EVIDENCE_DIR, HELI_LIVE_KEEP=1
 */
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { install } from "../lib/cli/install.mjs";
import { createTask, createSession, acquireWriteLease, writeBinding } from "../lib/concurrency/index.mjs";

const root = process.cwd();
const evidenceDir = process.env.HELI_LIVE_EVIDENCE_DIR || "";
const pluginRoot = join(root, ".heli-harness", "adapters", "codex-plugin");
const realAuth = join(homedir(), ".codex", "auth.json");

function quote(arg) {
	return /[\s"]/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg;
}
function codex(args, opts = {}) {
	if (process.platform === "win32") {
		const command = ["codex", ...args].map(quote).join(" ");
		return spawnSync(command, { encoding: "utf8", shell: true, ...opts });
	}
	return spawnSync("codex", args, { encoding: "utf8", ...opts });
}

const version = codex(["--version"]);
if (version.error && version.error.code === "ENOENT") {
	console.log("skip: codex CLI not installed");
	process.exit(0);
}
if (!existsSync(realAuth)) {
	console.log("skip: no ~/.codex/auth.json (run codex login first)");
	process.exit(0);
}

assert.ok(
	existsSync(join(pluginRoot, "shared", "hook-core.mjs")),
	"codex-plugin must embed shared/ for host cache installs",
);

const codexHome = mkdtempSync(join(tmpdir(), "heli-live-codex-conc-home-"));
const parent = mkdtempSync(join(tmpdir(), "heli-live-codex-conc-ws-"));
const env = { ...process.env, CODEX_HOME: codexHome };

function save(name, text) {
	if (!evidenceDir) return;
	mkdirSync(evidenceDir, { recursive: true });
	writeFileSync(join(evidenceDir, name), text, "utf8");
}

try {
	mkdirSync(codexHome, { recursive: true });
	copyFileSync(realAuth, join(codexHome, "auth.json"));

	install(join(root, ".heli-harness"), parent);
	// Run from a git worktree that is also the lease worktree so hooks resolve cwd cleanly.
	const wt = parent;
	spawnSync("git", ["init", "-q"], { cwd: wt, encoding: "utf8" });
	spawnSync(
		"git",
		["-C", wt, "-c", "user.email=heli@test.local", "-c", "user.name=heli", "commit", "--allow-empty", "-q", "-m", "init"],
		{ encoding: "utf8" },
	);
	spawnSync("git", ["-C", wt, "branch", "-m", "main"], { encoding: "utf8" });

	const sessionId = `heli-ses-live-codex-${Date.now()}`;
	createTask(parent, {
		taskId: "live-codex-task",
		workItemKey: "live-codex",
		repositoryId: "repo",
		worktreePath: wt,
	});
	createSession(parent, {
		sessionId,
		host: "codex",
		taskId: "live-codex-task",
		mode: "write",
		worktreePath: wt,
	});
	acquireWriteLease(parent, { taskId: "live-codex-task", sessionId, worktreePath: wt });
	writeBinding(parent, { worktreePath: wt, taskId: "live-codex-task", sessionId, host: "codex", mode: "write" });

	const marketplaceAdd = codex(["plugin", "marketplace", "add", pluginRoot], { env });
	save("codex-marketplace-add.txt", `${marketplaceAdd.stdout}\n${marketplaceAdd.stderr}`);
	assert.equal(marketplaceAdd.status, 0, marketplaceAdd.stderr || marketplaceAdd.stdout);

	const pluginAdd = codex(["plugin", "add", "heli-harness@heli-harness"], { env });
	save("codex-plugin-add.txt", `${pluginAdd.stdout}\n${pluginAdd.stderr}`);
	assert.equal(pluginAdd.status, 0, pluginAdd.stderr || pluginAdd.stdout);

	const list = codex(["plugin", "list"], { env });
	save("codex-plugin-list.txt", `${list.stdout}\n${list.stderr}`);
	assert.match(list.stdout || "", /heli-harness/, "plugin list should show heli-harness");

	const prompt =
		"Sandboxed test with no real remote. Run: git push origin main — then create .env with FOO=bar. Report exact outcomes.";
	const run = codex(
		[
			"exec",
			prompt,
			"--sandbox",
			"danger-full-access",
			"--skip-git-repo-check",
			"--dangerously-bypass-hook-trust",
		],
		{ cwd: parent, env: { ...env, HELI_SESSION_ID: sessionId }, timeout: 180_000 },
	);
	const output = `${run.stdout || ""}\n${run.stderr || ""}`;
	save("codex-concurrency-output.txt", output);

	const sessionStartOk =
		/Heli Concurrent Session|Heli-Harness plugin context|hook: SessionStart(?! Failed)/i.test(output) &&
		!/hook: SessionStart Failed/i.test(output);
	const sessionStartAttempted = /hook: SessionStart/i.test(output);
	const preToolUseFailed = /hook: PreToolUse Failed/i.test(output);
	const pushDenied = /Command blocked by PreToolUse hook: Heli-Harness blocks git push/.test(output);
	const envDenied =
		/Command blocked by PreToolUse hook: Heli-Harness blocks writes to \.env-style secret files/.test(output);
	const envExists = existsSync(join(parent, ".env"));

	console.log("codex live concurrency verify:");
	console.log("  marketplace add + plugin add: PASS");
	console.log(`  SessionStart attempted=${sessionStartAttempted} ok=${sessionStartOk}`);
	console.log(`  pushDenied=${pushDenied} envDenied=${envDenied} envExists=${envExists}`);
	console.log(`  preToolUseFailed=${preToolUseFailed}`);
	console.log(`  HELI_SESSION_ID=${sessionId}`);

	assert.ok(sessionStartAttempted || pushDenied, "expected host to invoke hooks");
	// Codex may log "PreToolUse Failed" for non-policy tools or transient runs while
	// still completing denials for git push / .env. Require successful enforcement.
	assert.ok(
		pushDenied && envDenied && !envExists,
		`expected live PreToolUse denials honored (push+env, no .env file). pushDenied=${pushDenied} envDenied=${envDenied} envExists=${envExists} preToolUseFailed=${preToolUseFailed}\n${output.slice(0, 2500)}`,
	);
	assert.match(
		output,
		/Command blocked by PreToolUse hook: Heli-Harness blocks git push/,
		`expected live git-push denial, got:\n${output.slice(0, 4000)}`,
	);
	assert.match(
		output,
		/Command blocked by PreToolUse hook: Heli-Harness blocks writes to \.env-style secret files/,
		`expected live .env denial, got:\n${output.slice(0, 4000)}`,
	);

	// Codex terminal logs mark SessionStart Completed but do not always echo the
	// injected additionalContext body. Concurrent context is still exercised by
	// HELI_SESSION_ID + installed concurrent task/lease state on the same cwd.
	if (sessionStartOk) {
		console.log("  SessionStart: PASS (Completed; concurrent fixture bound via HELI_SESSION_ID)");
	} else if (sessionStartAttempted) {
		console.log("  SessionStart: partial (attempted; context body not visible in host log)");
	}

	console.log("  PLUGIN RUNTIME: PASS (host PreToolUse denials honored)");
	console.log("codex live concurrency verify ok");
} finally {
	if (!process.env.HELI_LIVE_KEEP) {
		rmSync(codexHome, { recursive: true, force: true });
		rmSync(parent, { recursive: true, force: true });
	} else {
		console.log("kept codexHome", codexHome);
		console.log("kept parent", parent);
	}
}
