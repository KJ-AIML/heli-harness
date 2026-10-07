#!/usr/bin/env node
/**
 * Real-host golden flow for flow-first governance.
 *
 * Isolated workspace only. Codex writes one repo and exits. OpenCode writes a
 * different repo. A live overlapping mutation is then held by the branch gate
 * and a real OpenCode edit of that same file must not land.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { linkProject } from "../lib/cli/link.mjs";
import { createSession } from "../lib/concurrency/session.mjs";
import { evaluatePreToolUse } from "../.heli-harness/adapters/shared/hook-core.mjs";
import {
	continuationForWorktree,
	listMutationLeases,
	readResourceLeaseForWorktree,
} from "../lib/concurrency/index.mjs";

const codexAuth = join(homedir(), ".codex", "auth.json");
if (!existsSync(codexAuth)) {
	console.log("skip: no codex auth");
	process.exit(0);
}

const root = process.cwd();
const scratch = mkdtempSync(join(tmpdir(), "heli-v011-golden-"));
const workspace = join(scratch, "workspace");
const frontend = join(workspace, "repos", "frontend");
const backend = join(workspace, "repos", "backend");
const codexHome = join(scratch, "codex-home");
const config = join(scratch, "heli-config");
const data = join(scratch, "heli-data");

function git(cwd, args) {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" });
	assert.equal(result.status, 0, result.stderr || result.stdout);
}

function initRepo(dir) {
	mkdirSync(dir, { recursive: true });
	git(dir, ["init", "-q"]);
	writeFileSync(join(dir, "notes.txt"), "baseline\n");
	git(dir, ["add", "."]);
	git(dir, ["-c", "user.name=Heli Test", "-c", "user.email=heli@example.invalid", "commit", "-qm", "baseline"]);
}

const env = {
	...process.env,
	HELI_CONFIG_DIR: config,
	HELI_DATA_DIR: data,
	HELI_YOLO: "0",
	HELI_GUARDS: "on",
	PWD: frontend,
	OLDPWD: frontend,
};
delete env.HELI_SESSION_ID;
delete env.HELI_EXTERNAL_HOST_SESSION_ID;

try {
	initRepo(frontend);
	initRepo(backend);
	mkdirSync(codexHome, { recursive: true });
	copyFileSync(codexAuth, join(codexHome, "auth.json"));
	Object.assign(process.env, { HELI_CONFIG_DIR: config, HELI_DATA_DIR: data, HELI_YOLO: "0", HELI_GUARDS: "on" });
	delete process.env.HELI_SESSION_ID;

	const parent = linkProject(root, workspace);
	const front = linkProject(root, frontend);
	const back = linkProject(root, backend);
	assert.equal(front.workspaceId, parent.workspaceId);
	assert.equal(back.workspaceId, parent.workspaceId);
	assert.equal(front.nestedRepositoryRegistered, true);
	assert.equal(back.nestedRepositoryRegistered, true);

	const pluginRoot = join(root, ".heli-harness", "adapters", "codex-plugin");
	const codexEnv = { ...env, CODEX_HOME: codexHome, PWD: frontend };
	const marketplace = spawnSync("codex", ["plugin", "marketplace", "add", pluginRoot], { env: codexEnv, encoding: "utf8" });
	assert.equal(marketplace.status, 0, marketplace.stderr || marketplace.stdout);
	const pluginAdd = spawnSync("codex", ["plugin", "add", "heli-harness@heli-harness"], { env: codexEnv, encoding: "utf8" });
	assert.equal(pluginAdd.status, 0, pluginAdd.stderr || pluginAdd.stdout);
	const codex = spawnSync("codex", [
		"exec",
		"Modify notes.txt so its only text is: from real codex. Use a file-editing tool only. Do not run git, shell, network, or package-manager commands. Reply CODEX_WRITE_DONE.",
		"--sandbox", "workspace-write", "--skip-git-repo-check", "--dangerously-bypass-hook-trust",
	], { cwd: frontend, env: codexEnv, encoding: "utf8", timeout: 120_000 });
	const codexOut = `${codex.stdout || ""}\n${codex.stderr || ""}`;
	assert.equal(codex.status, 0, codexOut);
	assert.equal(readFileSync(join(frontend, "notes.txt"), "utf8").trim(), "from real codex");
	assert.equal(readResourceLeaseForWorktree(workspace, frontend), null, "Codex exit must release frontend authority");
	const codexContinuation = continuationForWorktree(workspace, frontend);
	assert.equal(codexContinuation?.provenance?.lastHost, "codex");
	assert.equal(codexContinuation.leaseId, undefined);

	cpSync(join(root, ".heli-harness", "adapters", "opencode-plugin"), join(backend, ".opencode", "plugins"), { recursive: true });
	const openEnv = { ...env, PWD: backend, OLDPWD: backend };
	const open = spawnSync("opencode", ["run", "Use the edit or write tool to change notes.txt so its only text is: from real opencode. Do not run bash, git, or network. Reply OPENCODE_WRITE_DONE."], {
		cwd: backend,
		env: openEnv,
		encoding: "utf8",
		timeout: 180_000,
	});
	const openOut = `${open.stdout || ""}\n${open.stderr || ""}`;
	assert.equal(open.status, 0, openOut);
	assert.equal(readFileSync(join(backend, "notes.txt"), "utf8").trim(), "from real opencode");
	assert.equal(readResourceLeaseForWorktree(workspace, backend), null);
	const openContinuation = continuationForWorktree(workspace, backend);
	assert.equal(openContinuation?.provenance?.lastHost, "opencode");
	assert.notEqual(openContinuation.continuationId, codexContinuation.continuationId);

	const holder = createSession(workspace, { host: "codex", mode: "write", worktreePath: frontend, externalHostSessionId: "live-overlap-holder" });
	const held = evaluatePreToolUse({
		cwd: frontend,
		host: "codex",
		env: openEnv,
		toolName: "Write",
		toolInput: { file_path: join(frontend, "notes.txt"), content: "from real codex\n" },
		hookPayload: { session_id: "live-overlap-holder", toolUseId: "hold-frontend-notes" },
	});
	assert.equal(held.deny, false, held.reason);
	assert.ok(listMutationLeases(workspace).some((lease) => lease.sessionId === holder.sessionId));

	cpSync(join(root, ".heli-harness", "adapters", "opencode-plugin"), join(frontend, ".opencode", "plugins"), { recursive: true });
	const clashEnv = { ...env, PWD: frontend, OLDPWD: frontend };
	const clash = spawnSync("opencode", ["run", "Use the edit or write tool to change notes.txt so its only text is: overlap should fail. Do not use bash. If the write is denied, reply CONFLICT_SEEN and stop."], {
		cwd: frontend,
		env: clashEnv,
		encoding: "utf8",
		timeout: 180_000,
	});
	const clashOut = `${clash.stdout || ""}\n${clash.stderr || ""}`;
	const notes = readFileSync(join(frontend, "notes.txt"), "utf8").trim();
	assert.notEqual(notes, "overlap should fail", `overlapping OpenCode write landed while Codex held the file\n${clashOut}`);
	assert.match(clashOut, /Active write conflict|MUTATION_CONFLICT|CONFLICT_SEEN/i, clashOut.slice(-2000));

	console.log("v0.11 golden flow:");
	console.log("  codex frontend write + release: PASS");
	console.log("  opencode backend non-overlapping write: PASS");
	console.log("  continuation authority inherited: 0");
	console.log("  real overlapping write blocked: PASS");
	console.log("v0.11 golden flow ok");
} finally {
	rmSync(scratch, { recursive: true, force: true });
}
