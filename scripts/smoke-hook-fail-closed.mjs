#!/usr/bin/env node
/**
 * PreToolUse wrappers must fail closed: any error -> a deny in the host's own
 * protocol, never a crash (hosts treat a crashed hook as "allow"). That covers
 * the per-host stub the host actually runs too: when the shared wrapper it
 * imports cannot load, the stub itself must deny. Antigravity's hook configs
 * must run the stubs (not the shared wrappers directly): the configured
 * PreToolUse command must deny too, and SessionStart and PreToolUse must report
 * the same host. Also pins the other direction: a healthy workspace must still
 * be allowed.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createTask } from "../lib/concurrency/task.mjs";
import { createSession, attachSession } from "../lib/concurrency/session.mjs";
import { scrubHeliProcessEnv } from "./lib/hermetic-env.mjs";

scrubHeliProcessEnv();
const root = process.cwd();
const scratch = mkdtempSync(join(tmpdir(), "heli-fail-closed-"));
const baseEnv = { ...process.env, HELI_CONFIG_DIR: join(scratch, "config"), HELI_DATA_DIR: join(scratch, "data") };
const shippedRules = readFileSync(join(root, ".heli-harness", "safety", "command-rules.json"), "utf8");

const WRAPPERS = [
	{ name: "claude", rel: ".heli-harness/adapters/claude-plugin/hooks/heli-pre-tool-use.mjs", denyStatus: 0 },
	{ name: "codex", rel: ".heli-harness/adapters/codex-plugin/hooks/heli-pre-tool-use.mjs", denyStatus: 0 },
	{ name: "kimi", rel: ".heli-harness/adapters/kimi-plugin/hooks/heli-pre-tool-use.mjs", denyStatus: 0 },
	{ name: "antigravity", rel: ".heli-harness/adapters/antigravity-plugin/hooks/heli-pre-tool-use.mjs", denyStatus: 0 },
	{ name: "grok", rel: ".heli-harness/adapters/grok-plugin/hooks/heli-pre-tool-use.mjs", denyStatus: 2 },
];

function workspace(name, files) {
	const dir = join(scratch, name);
	for (const [rel, content] of Object.entries(files)) {
		mkdirSync(join(dir, rel, ".."), { recursive: true });
		writeFileSync(join(dir, rel), content);
	}
	return dir;
}

function runHook(wrapper, cwd, stdinText, env = {}) {
	const result = spawnSync(process.execPath, [wrapper.script ?? join(root, wrapper.rel)], {
		cwd,
		input: stdinText,
		encoding: "utf8",
		env: { ...baseEnv, ...env },
	});
	let body = null;
	try {
		body = result.stdout.trim() ? JSON.parse(result.stdout) : null;
	} catch {
		body = { unparseable: result.stdout };
	}
	return { status: result.status, body, stderr: result.stderr };
}

function assertDenied(wrapper, out, reasonPattern, label) {
	assert.equal(out.status, wrapper.denyStatus, `${wrapper.name} ${label}: exit ${out.status}, stderr=${out.stderr}`);
	assert.equal(out.body?.hookSpecificOutput?.permissionDecision, "deny", `${wrapper.name} ${label}: expected a JSON deny, got ${JSON.stringify(out.body)} stderr=${out.stderr}`);
	assert.match(out.body.hookSpecificOutput.permissionDecisionReason, reasonPattern, `${wrapper.name} ${label}`);
}

function assertAllowed(wrapper, out, label) {
	assert.equal(out.status, 0, `${wrapper.name} ${label}: exit ${out.status}, stderr=${out.stderr}`);
	assert.notEqual(out.body?.hookSpecificOutput?.permissionDecision, "deny", `${wrapper.name} ${label}: ${JSON.stringify(out.body)}`);
}

// Copy only what a stub needs (hooks/ and shared/) so a test can break the copy
// without touching the repo. Returns a wrapper entry that runs the copied stub.
function copyPluginHooks(wrapper, name) {
	const pluginDir = dirname(dirname(wrapper.rel));
	const dir = join(scratch, name);
	for (const sub of ["hooks", "shared"]) cpSync(join(root, pluginDir, sub), join(dir, sub), { recursive: true });
	return { ...wrapper, script: join(dir, "hooks", "heli-pre-tool-use.mjs"), sharedDir: join(dir, "shared") };
}

// Import resolution, parsing and evaluation are separate failure phases of
// `await import()`, and only the first one carries an error code.
const UNLOADABLE_WRAPPER = [
	{ label: "missing", detail: /ERR_MODULE_NOT_FOUND/, breakFile: (file) => rmSync(file, { force: true }) },
	{ label: "unparseable", detail: null, breakFile: (file) => writeFileSync(file, "this is not javascript;;;\n") },
	{ label: "throwing", detail: /simulated import failure/, breakFile: (file) => writeFileSync(file, `throw new Error("simulated import failure");\n`) },
];

// A stub must deny in the same protocol as the wrapper it imports; only the reason text may differ.
const denyShape = (body) => JSON.stringify(body, (key, value) => (key === "reason" || key === "permissionDecisionReason" ? "<reason>" : value));

const antigravityPlugin = join(root, ".heli-harness", "adapters", "antigravity-plugin");

// The commands an Antigravity hook config runs for an event (hooks.json names its groups, hooks/hooks.json nests them).
function antigravityCommands(configRel, event) {
	const config = JSON.parse(readFileSync(join(antigravityPlugin, configRel), "utf8"));
	const groups = config[event === "PreToolUse" ? "heli-harness-pretool" : "heli-harness-session"]?.[event] || config.hooks?.[event] || [];
	return groups.flatMap((group) => group.hooks.map((hook) => hook.command));
}

// An embedded install carries the whole adapters/ tree, so the configs' workspace-relative
// commands resolve from the workspace root: copy `base` and add the tree Antigravity runs.
function embeddedAntigravity(name, base) {
	const dir = join(scratch, name);
	cpSync(base, dir, { recursive: true });
	const adapters = join(dir, ".heli-harness", "adapters");
	cpSync(join(root, ".heli-harness", "adapters", "shared"), join(adapters, "shared"), { recursive: true });
	for (const sub of ["hooks", "shared"]) cpSync(join(antigravityPlugin, sub), join(adapters, "antigravity-plugin", sub), { recursive: true });
	return dir;
}

const FAIL_CLOSED = /could not evaluate this action.*denying \(fail-closed\).*heli doctor/s;
const bash = (command) => JSON.stringify({ tool_name: "Bash", tool_input: { command } });
const write = (file_path) => JSON.stringify({ tool_name: "Write", tool_input: { file_path, content: "x" } });

try {
	const healthy = workspace("healthy", {
		".heli-harness/HARNESS.md": "# Heli\n",
		".heli-harness/safety/command-rules.json": shippedRules,
		".heli-harness/state/current-task.md": "# Current Task\n\nTarget repo: demo\n\nCurrent status: in progress\n\nFailed attempts count: 0\n",
		".heli-harness/workspace/target.json": JSON.stringify({ targetRepo: "demo" }),
	});
	const badBinding = workspace("bad-binding", {
		".heli/workspace.json": JSON.stringify({ schemaVersion: 99, workspaceId: "x" }),
	});
	const badLock = workspace("bad-lock", {
		".heli/workspace.json": JSON.stringify({ schemaVersion: 1, workspaceId: "heli-ws-bad-lock", resources: [{ id: "root", type: "worktree", path: "." }] }),
		".heli/heli.lock": "{not json",
	});

	// events.jsonl replaced by a directory: the decision receipt write fails (EISDIR)
	// AFTER a deny was decided. The deny must still reach the host.
	const eisdir = workspace("eisdir", {
		".heli-harness/HARNESS.md": "# Heli\n",
		".heli-harness/safety/command-rules.json": shippedRules,
		".heli-harness/workspace/schema.json": JSON.stringify({ schemaVersion: 1, mode: "concurrent" }),
	});
	createTask(eisdir, { taskId: "t1", repositoryId: "demo", worktreePath: eisdir });
	createSession(eisdir, { sessionId: "observer", mode: "observe", worktreePath: eisdir });
	attachSession(eisdir, "observer", "t1", { mode: "observe", worktreePath: eisdir });
	const eventsPath = join(eisdir, ".heli-harness", "tasks", "t1", "events.jsonl");
	rmSync(eventsPath, { force: true });
	mkdirSync(eventsPath);

	for (const wrapper of WRAPPERS) {
		assertDenied(wrapper, runHook(wrapper, healthy, "{not json"), FAIL_CLOSED, "malformed stdin");
		assertDenied(wrapper, runHook(wrapper, healthy, ""), FAIL_CLOSED, "empty stdin");
		assertDenied(wrapper, runHook(wrapper, healthy, JSON.stringify({ tool_input: { command: "ls" } })), FAIL_CLOSED, "payload without tool name");
		assertDenied(wrapper, runHook(wrapper, badBinding, write("src/a.js")), /UNSUPPORTED_WORKSPACE_SCHEMA.*fail-closed/s, "schema-invalid .heli/workspace.json");
		assertDenied(wrapper, runHook(wrapper, badLock, bash("git status")), /INVALID_HELI_LOCK.*fail-closed/s, "evaluator throws (unreadable heli.lock)");
		const failed = runHook(wrapper, badLock, bash("git status"));
		assert.match(failed.stderr, FAIL_CLOSED, `${wrapper.name}: fail-closed reason must also go to stderr`);

		const eisdirOut = runHook(wrapper, eisdir, write("src/x.ts"), { HELI_SESSION_ID: "observer" });
		assertDenied(wrapper, eisdirOut, /not write|mode/i, "receipt write fails after deny (EISDIR)");
		assert.match(eisdirOut.stderr, /decision receipt failed/i, `${wrapper.name}: side-effect failure must be reported on stderr`);

		// Healthy workspace: no false denials.
		assertAllowed(wrapper, runHook(wrapper, healthy, write("notes.txt")), "healthy Write");
		assertAllowed(wrapper, runHook(wrapper, healthy, bash("git status")), "healthy Bash");

		// The stub is the process the host actually runs. If the shared wrapper it
		// imports cannot load (broken or half-updated plugin install) the stub itself
		// must still deny, with the same contract the wrapper uses.
		const pristine = copyPluginHooks(wrapper, `${wrapper.name}-pristine`);
		assertAllowed(pristine, runHook(pristine, healthy, write("notes.txt")), "unbroken plugin copy (control)");
		const wrapperDeny = runHook(wrapper, healthy, "{not json");
		for (const variant of UNLOADABLE_WRAPPER) {
			const stub = copyPluginHooks(wrapper, `${wrapper.name}-${variant.label}`);
			for (const file of ["claude-style-pre-tool-use.mjs", "grok-style-pre-tool-use.mjs"]) variant.breakFile(join(stub.sharedDir, file));
			const out = runHook(stub, healthy, bash("git status"));
			const label = `stub with ${variant.label} shared wrapper`;
			assertDenied(stub, out, FAIL_CLOSED, label);
			if (variant.detail) assert.match(out.body.hookSpecificOutput.permissionDecisionReason, variant.detail, `${wrapper.name} ${label}`);
			assert.match(out.stderr, FAIL_CLOSED, `${wrapper.name} ${label}: reason must also go to stderr`);
			assert.equal(denyShape(out.body), denyShape(wrapperDeny.body), `${wrapper.name} ${label}: must emit the wrapper's deny contract`);
		}
	}

	// Antigravity's hook configs used to run the shared wrappers directly, with no stub in
	// between, so a missing or broken PreToolUse wrapper crashed the hook (= allow). Both configs
	// must run the stubs, and the configured PreToolUse command, run the way a host runs it (from
	// the workspace root), must deny once every copy of the shared wrapper is gone.
	const antigravity = WRAPPERS.find((wrapper) => wrapper.name === "antigravity");
	const concurrentBase = workspace("antigravity-concurrent", {
		".heli-harness/HARNESS.md": "# Heli\n",
		".heli-harness/workspace/schema.json": JSON.stringify({ schemaVersion: 1, mode: "concurrent" }),
	});
	for (const configRel of ["hooks.json", "hooks/hooks.json"]) {
		const tag = configRel.replace("/", "-");
		const preCommands = antigravityCommands(configRel, "PreToolUse");
		const sessionCommands = antigravityCommands(configRel, "SessionStart");
		assert.deepEqual(
			preCommands,
			["node .heli-harness/adapters/antigravity-plugin/hooks/heli-pre-tool-use.mjs"],
			`antigravity-plugin/${configRel}: PreToolUse must run the fail-closed stub, not the shared wrapper directly`,
		);
		assert.deepEqual(
			sessionCommands,
			["node .heli-harness/adapters/antigravity-plugin/hooks/heli-session-start.mjs"],
			`antigravity-plugin/${configRel}: SessionStart must run its stub too, so both hooks report the same host`,
		);
		const entry = { ...antigravity, script: preCommands[0].replace(/^node /, "") };
		const label = `configured entry point of antigravity-plugin/${configRel}`;

		const embedded = embeddedAntigravity(`antigravity-${tag}`, healthy);
		assertAllowed(entry, runHook(entry, embedded, write("notes.txt")), `${label} (control)`);
		assertDenied(entry, runHook(entry, embedded, bash("git push origin main")), /git push/, `${label} (control: policy deny)`);
		const adapters = join(embedded, ".heli-harness", "adapters");
		for (const dir of [join(adapters, "shared"), join(adapters, "antigravity-plugin", "shared")]) rmSync(join(dir, "claude-style-pre-tool-use.mjs"));
		const out = runHook(entry, embedded, bash("git status"));
		assertDenied(entry, out, FAIL_CLOSED, `${label} with every copy of the shared wrapper deleted`);
		assert.match(out.body.hookSpecificOutput.permissionDecisionReason, /ERR_MODULE_NOT_FOUND/, label);
		assert.match(out.stderr, FAIL_CLOSED, `${label}: reason must also go to stderr`);

		// Same host: SessionStart creates the session and PreToolUse looks it up, and both the
		// runtime evidence and the external-id lookup are host-namespaced. If the two hooks
		// reported different hosts (the shared wrappers default to "claude-style"), PreToolUse
		// evidence would read HOST_MISMATCH and the session would not resolve.
		const startSession = (cwd, env = {}) => {
			const started = spawnSync(process.execPath, [sessionCommands[0].replace(/^node /, "")], { cwd, encoding: "utf8", env: { ...baseEnv, ...env } });
			assert.equal(started.status, 0, `${label}: SessionStart exited ${started.status}: ${started.stderr}`);
		};
		const observed = embeddedAntigravity(`antigravity-host-${tag}`, concurrentBase);
		startSession(observed);
		assertAllowed(entry, runHook(entry, observed, bash("git status")), `${label} after SessionStart`);
		const explained = spawnSync(process.execPath, [join(root, "bin", "heli.mjs"), "explain", "capabilities", observed, "--json"], { cwd: observed, encoding: "utf8", env: baseEnv });
		assert.equal(explained.status, 0, explained.stderr);
		const capabilities = JSON.parse(explained.stdout).data;
		assert.equal(capabilities.host, "antigravity", `${label}: the session must carry the antigravity host`);
		assert.equal(capabilities.selectedAdapter?.id, "antigravity", `${label}: the antigravity adapter must be selected`);
		for (const capability of ["session_start", "pre_tool", "structured_tool_input"]) {
			assert.equal(capabilities.observations[capability]?.freshness?.reason, "CURRENT", `${label}: ${capability} evidence must be current for the session's host`);
		}

		const external = embeddedAntigravity(`antigravity-extid-${tag}`, concurrentBase);
		const externalEnv = { HELI_EXTERNAL_HOST_SESSION_ID: "ext-1" };
		startSession(external, externalEnv);
		createTask(external, { taskId: "t1", repositoryId: "demo", worktreePath: external }); // a task ends the zero-task bootstrap window, so a write needs a resolved session
		assertDenied(entry, runHook(entry, external, write("src/a.txt"), externalEnv), /session is not bound to a task/, `${label}: PreToolUse must resolve the session SessionStart created for the external id`);
	}
	console.log("hook fail-closed smoke ok");
} finally {
	rmSync(scratch, { recursive: true, force: true });
}
