#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { linkProject } from "../lib/cli/link.mjs";
import { setupHeli } from "../lib/cli/setup.mjs";
import { createTask, listTasks } from "../lib/concurrency/task.mjs";
import { pathsFor } from "../lib/concurrency/paths.mjs";
import {
	linkedWorkspaceExecutionsDir,
	readProjectBinding,
	unregisterWorkspace,
} from "../lib/concurrency/project-binding.mjs";
import { acquireResourceWriteAuthority, resourceIdForWorktree } from "../lib/concurrency/resource-authority.mjs";
import { createSession } from "../lib/concurrency/session.mjs";
import { writeBinding } from "../lib/concurrency/binding.mjs";
import { evaluateOwnershipGate, resolveExecutionContext } from "../lib/concurrency/resolve.mjs";
import { evaluatePreToolUse } from "../.heli-harness/adapters/shared/hook-core.mjs";

const repoScripts = dirname(fileURLToPath(import.meta.url));
const packageRoot = dirname(repoScripts);
const scratch = mkdtempSync(join(tmpdir(), "heli-workspace-tasks-"));
const checkoutA = join(scratch, "checkout-a");
const checkoutB = join(scratch, "checkout-b");
const embedded = join(scratch, "embedded");
const config = join(scratch, "config");
const data = join(scratch, "data");
const env = { ...process.env, HELI_CONFIG_DIR: config, HELI_DATA_DIR: data };
delete env.HELI_SESSION_ID;
const oldConfig = process.env.HELI_CONFIG_DIR;
const oldData = process.env.HELI_DATA_DIR;
process.env.HELI_CONFIG_DIR = config;
process.env.HELI_DATA_DIR = data;
delete process.env.HELI_SESSION_ID;

function run(args, extra = {}) {
	const result = spawnSync(process.execPath, [join(packageRoot, "bin", "heli.mjs"), ...args], {
		encoding: "utf8",
		cwd: extra.cwd || checkoutA,
		env: { ...env, ...extra.env },
	});
	assert.equal(result.status ?? 1, extra.status ?? 0, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
	return result;
}

try {
	mkdirSync(checkoutA, { recursive: true });
	mkdirSync(checkoutB, { recursive: true });
	setupHeli({ env });
	linkProject(packageRoot, checkoutA, { env });
	cpSync(join(checkoutA, ".heli"), join(checkoutB, ".heli"), { recursive: true });
	const binding = readProjectBinding(checkoutA);
	assert.equal(readProjectBinding(checkoutB).workspaceId, binding.workspaceId);
	const rootA = pathsFor(checkoutA);
	const rootB = pathsFor(checkoutB);
	assert.notEqual(rootA.operationalRoot, rootB.operationalRoot);
	assert.equal(rootA.tasksDir, rootB.tasksDir);
	assert.equal(rootA.tasksDir.includes("executions"), false);

	const plantedDir = join(rootA.operationalRoot, "tasks", "from-execution");
	mkdirSync(plantedDir, { recursive: true });
	writeFileSync(
		join(plantedDir, "task.json"),
		JSON.stringify({ schemaVersion: 1, taskId: "from-execution", status: "active", title: "Planted" }),
	);
	const migrated = listTasks(checkoutB).map((task) => task.taskId);
	assert.deepEqual(migrated, ["from-execution"]);
	assert.equal(existsSync(join(plantedDir, "task.json")), false, "execution copy should move, not fork");
	assert.equal(existsSync(join(rootA.tasksDir, "from-execution", "task.json")), true);

	createTask(checkoutA, {
		taskId: "epic-auth",
		title: "Auth",
		repositoryId: "demo",
		worktreePath: checkoutA,
		allowDuplicate: true,
	});
	createTask(checkoutA, {
		taskId: "epic-billing",
		title: "Billing",
		repositoryId: "demo",
		worktreePath: checkoutB,
		allowDuplicate: true,
	});
	const listed = run(["task", "list"], { cwd: checkoutB }).stdout;
	assert.match(listed, /epic-auth/);
	assert.match(listed, /epic-billing/);
	assert.match(listed, /from-execution/);

	createSession(checkoutB, { sessionId: "cli-b", host: "cli", mode: "write", worktreePath: checkoutB });
	createSession(checkoutB, { sessionId: "grok-b", host: "grok", mode: "write", worktreePath: checkoutB });
	writeBinding(checkoutB, { worktreePath: checkoutB, sessionId: "grok-b", host: "grok", mode: "write" });
	const authority = acquireResourceWriteAuthority(checkoutB, { sessionId: "grok-b", worktreePath: checkoutB });
	assert.equal(authority.resource.id, resourceIdForWorktree(checkoutB));
	const leasePath = join(rootB.resourceLocksDir, `${authority.resource.id}.write.lock`, "lease.json");
	assert.equal(existsSync(leasePath), true);
	assert.equal(leasePath.includes(`${join("executions", "")}`), true);
	assert.equal(existsSync(join(rootB.sessionsDir, "grok-b.json")), true);
	assert.equal(rootB.sessionsDir.includes("executions"), true);
	assert.equal(existsSync(join(rootA.tasksDir, "grok-b.json")), false);

	const hostPayloadContext = resolveExecutionContext({
		cwd: checkoutB,
		host: "grok",
		createIfMissing: false,
		hookPayload: { session_id: "grok-b", toolUseId: "call-grok-b", tool_name: "Write" },
	});
	assert.equal(hostPayloadContext.sessionId, "grok-b", "PreToolUse session id resumes the SessionStart host binding");
	assert.equal(hostPayloadContext.identitySource, "host-binding");
	const mismatchedHostPayloadContext = resolveExecutionContext({
		cwd: checkoutB,
		host: "grok",
		createIfMissing: false,
		hookPayload: { session_id: "some-other-host-session", toolUseId: "call-mismatch", tool_name: "Write" },
	});
	assert.equal(mismatchedHostPayloadContext.sessionId, null, "an unbound session id cannot claim a worktree binding");
	const authPayloadContext = resolveExecutionContext({
		cwd: checkoutA,
		host: "grok",
		createIfMissing: false,
		hookPayload: { session_id: "fresh-host-session-a", toolUseId: "call-grok-a", tool_name: "Write" },
	});
	assert.notEqual(authPayloadContext.sessionId, hostPayloadContext.sessionId, "another worktree resolves its own host binding");

	const explained = JSON.parse(run(["explain", "authority", "--json"], {
		cwd: checkoutB,
		env: { HELI_SESSION_ID: "cli-b" },
	}).stdout).data;
	assert.equal(explained.cliSession.sessionId, "cli-b");
	assert.equal(explained.cliSession.host, "cli");
	assert.equal(explained.cliSession.mode, "write");
	assert.equal(explained.hostWriter.sessionId, "grok-b");
	assert.equal(explained.hostWriter.host, "grok");
	assert.equal(explained.hostWriter.mode, "write");
	const human = run(["explain", "authority"], { cwd: checkoutB, env: { HELI_SESSION_ID: "cli-b" } }).stdout;
	assert.match(human, /CLI session: cli-b \(host cli, mode write\)/);
	assert.match(human, /Host writer: grok-b \(host grok, mode write\)/);

	const unbound = evaluateOwnershipGate(
		resolveExecutionContext({
			cwd: checkoutB,
			host: "grok",
			createIfMissing: false,
			hookPayload: { session_id: "someone-else" },
		}),
		{ isWrite: true },
	);
	assert.equal(unbound.code, "RESOURCE_WRITER_HELD");
	assert.match(unbound.reason, /held by session grok-b/);
	assert.match(unbound.reason, new RegExp(authority.resource.id));

	const cross = evaluatePreToolUse({
		cwd: checkoutA,
		host: "grok",
		env,
		toolName: "Write",
		toolInput: { file_path: join(checkoutB, "conflict-probe.txt") },
		hookPayload: { session_id: "grok-b", toolUseId: "call-cross", tool_name: "Write" },
	});
	assert.equal(cross.deny, true, cross.reason);
	assert.equal(cross.code, "RESOURCE_WRITER_HELD");
	assert.match(cross.reason, /held by session grok-b/);
	assert.match(cross.reason, new RegExp(authority.resource.id));
	assert.equal(existsSync(join(checkoutB, "conflict-probe.txt")), false);

	const started = spawnSync(
		process.execPath,
		[join(packageRoot, ".heli-harness", "adapters", "shared", "grok-style-session-start.mjs")],
		{
			cwd: checkoutA,
			encoding: "utf8",
			input: JSON.stringify({ session_id: "fresh-host-session-a", hook_event_name: "SessionStart" }),
			env: { ...env, HELI_ADAPTER_ID: "grok" },
		},
	);
	assert.equal(started.status, 0, `${started.stdout}\n${started.stderr}`);
	const sessionFiles = readdirSync(rootA.sessionsDir).filter((name) => name.endsWith(".json"));
	const observations = sessionFiles.map((name) => JSON.parse(readFileSync(join(rootA.sessionsDir, name), "utf8")));
	const startedSession = observations.find((session) => session.runtimeAttestation?.observedCapabilities?.session_start);
	assert.ok(startedSession, "SessionStart must store session_start on the bound session");
	assert.equal(startedSession.runtimeAttestation.observedCapabilities.session_start.observed, true);
	assert.equal(startedSession.runtimeAttestation.observedCapabilities.session_start.source, "SessionStart");
	assert.ok(startedSession.runtimeAttestation.observedCapabilities.session_start.observedAt);

	mkdirSync(join(embedded, ".heli-harness", "workspace"), { recursive: true });
	writeFileSync(join(embedded, ".heli-harness", "HARNESS.md"), "# Heli\n");
	writeFileSync(
		join(embedded, ".heli-harness", "workspace", "schema.json"),
		JSON.stringify({ schemaVersion: 1, mode: "concurrent" }),
	);
	createTask(embedded, { taskId: "embedded-task", repositoryId: "demo", worktreePath: embedded, allowDuplicate: true });
	assert.equal(existsSync(join(embedded, ".heli-harness", "tasks", "embedded-task", "task.json")), true);
	assert.equal(pathsFor(embedded).tasksDir, join(embedded, ".heli-harness", "tasks"));

	const tasksDir = rootA.tasksDir;
	assert.equal(existsSync(join(tasksDir, "epic-auth", "task.json")), true);
	unregisterWorkspace(checkoutA, { env });
	assert.equal(existsSync(join(tasksDir, "epic-auth", "task.json")), true, "another execution still needs the tasks");
	assert.ok(readdirSync(linkedWorkspaceExecutionsDir(binding.workspaceId, env)).length > 0);
	rmSync(linkedWorkspaceExecutionsDir(binding.workspaceId, env), { recursive: true, force: true });
	unregisterWorkspace(checkoutB, { env });
	assert.equal(existsSync(join(tasksDir, "epic-auth", "task.json")), false, "last execution removal drops workspace tasks");

	console.log("workspace task scope smoke ok");
} finally {
	if (oldConfig == null) delete process.env.HELI_CONFIG_DIR;
	else process.env.HELI_CONFIG_DIR = oldConfig;
	if (oldData == null) delete process.env.HELI_DATA_DIR;
	else process.env.HELI_DATA_DIR = oldData;
	rmSync(scratch, { recursive: true, force: true });
}
