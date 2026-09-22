#!/usr/bin/env node
/**
 * Pi runtime-evidence parity smoke.
 *
 * The governed wrapper must preserve the legacy Pi extension's exact blocking
 * result while recording live runtime capabilities and a local denial event.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const workspace = mkdtempSync(join(tmpdir(), "heli-pi-runtime-"));
const previousCwd = process.cwd();
const previousSessionId = process.env.HELI_SESSION_ID;

const {
	createTask,
	createSession,
	attachSession,
	acquireWriteLease,
	writeBinding,
	readSession,
	taskPaths,
} = await import(pathToFileURL(join(root, "lib", "concurrency", "index.mjs")).href);

function writeJson(path, value) {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

try {
	mkdirSync(join(workspace, ".heli-harness", "workspace"), { recursive: true });
	mkdirSync(join(workspace, ".heli-harness", "safety"), { recursive: true });
	mkdirSync(join(workspace, "repos", "demo"), { recursive: true });
	writeFileSync(join(workspace, ".heli-harness", "HARNESS.md"), "# Heli-Harness\n", "utf8");
	writeJson(join(workspace, ".heli-harness", "workspace", "index.json"), {
		schemaVersion: 1,
		workspaceRoot: ".",
		repos: [{ name: "demo", path: "repos/demo", gitRoot: "repos/demo", profile: "", defaultTarget: true }],
	});
	writeJson(join(workspace, ".heli-harness", "workspace", "target.json"), {
		schemaVersion: 1,
		targetRepo: "demo",
		targetGitRoot: "repos/demo",
		writesAllowedUnder: "repos/demo",
		activeProfile: "",
	});
	writeJson(join(workspace, ".heli-harness", "safety", "command-rules.json"), {
		version: 1,
		rules: [
			{ id: "git-push", match: "git push", tier: "T5", reason: "Remote git writes need explicit approval" },
		],
	});

	createTask(workspace, {
		taskId: "pi-runtime",
		title: "Pi runtime evidence",
		repositoryId: "demo",
		worktreePath: workspace,
		mode: "strict",
	});
	const session = createSession(workspace, {
		sessionId: "heli-ses-pi-runtime",
		host: "pi",
		taskId: "pi-runtime",
		mode: "write",
		worktreePath: workspace,
	});
	attachSession(workspace, session.sessionId, "pi-runtime", { mode: "write", worktreePath: workspace });
	acquireWriteLease(workspace, { taskId: "pi-runtime", sessionId: session.sessionId, worktreePath: workspace });
	writeBinding(workspace, {
		worktreePath: workspace,
		taskId: "pi-runtime",
		sessionId: session.sessionId,
		host: "pi",
		mode: "write",
	});

	process.env.HELI_SESSION_ID = session.sessionId;
	process.chdir(workspace);

	const events = [];
	const commands = [];
	const pi = {
		on(name, handler) {
			events.push({ name, handler });
		},
		registerCommand(name, options) {
			commands.push({ name, options });
		},
		sendUserMessage() {},
	};
	const ctx = { ui: { notify() {}, setStatus() {} } };

	const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	const piEntrypoint = packageJson.pi?.extensions?.[0];
	assert.equal(piEntrypoint, "./extensions/pi-governed.js", "Pi package must load the governed runtime-evidence wrapper");
	const governed = await import(pathToFileURL(join(root, piEntrypoint)).href);
	governed.default(pi);
	assert.deepEqual(events.map((event) => event.name), ["session_start", "before_agent_start", "tool_call", "input"]);
	assert.ok(commands.length > 0, "legacy Pi commands must remain registered through wrapper");

	const sessionStart = events.find((event) => event.name === "session_start").handler;
	const toolCall = events.find((event) => event.name === "tool_call").handler;
	await sessionStart({ sessionId: "pi-host-runtime" }, ctx);

	let observed = readSession(workspace, session.sessionId)?.runtimeAttestation?.observedCapabilities || {};
	assert.equal(observed.session_start?.observed, true, "session_start must be attested from a live Pi hook");
	assert.equal(observed.session_start?.host, "pi");

	const blocked = await toolCall({ toolName: "bash", input: { command: "git push" } }, ctx);
	assert.deepEqual(blocked, {
		block: true,
		reason: "Blocked: Remote git writes need explicit approval. Target repo: demo. Run operation explicitly to override.",
	});

	observed = readSession(workspace, session.sessionId)?.runtimeAttestation?.observedCapabilities || {};
	assert.equal(observed.pre_tool?.observed, true, "tool_call must attest pre_tool capability");
	assert.equal(observed.structured_tool_input?.observed, true, "structured Pi tool input must be attested");

	const eventLines = readFileSync(taskPaths(workspace, "pi-runtime").eventsJsonl, "utf8")
		.trim()
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => JSON.parse(line));
	const denial = [...eventLines].reverse().find((event) => event.type === "guard.decision");
	assert.ok(denial, "Pi denial must be written to the local task event log");
	assert.equal(denial.decision?.effect, "deny");
	assert.equal(denial.decision?.code, "PI_GUARD_BLOCKED");
	assert.equal(denial.decision?.host, "pi");
	assert.equal(denial.decision?.toolName, "bash");

	console.log("smoke-pi-runtime-evidence: ok");
} finally {
	process.chdir(previousCwd);
	if (previousSessionId == null) delete process.env.HELI_SESSION_ID;
	else process.env.HELI_SESSION_ID = previousSessionId;
	rmSync(workspace, { recursive: true, force: true });
}
