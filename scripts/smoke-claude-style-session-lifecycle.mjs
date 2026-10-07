#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import {
  continuationForWorktree,
  listActiveSessions,
  listSessions,
  readResourceLeaseForWorktree,
} from "../lib/concurrency/index.mjs";
import { linkProject } from "../lib/cli/link.mjs";

const root = process.cwd();
const prior = {
  HELI_CONFIG_DIR: process.env.HELI_CONFIG_DIR,
  HELI_DATA_DIR: process.env.HELI_DATA_DIR,
  HELI_SESSION_ID: process.env.HELI_SESSION_ID,
  HELI_EXTERNAL_HOST_SESSION_ID: process.env.HELI_EXTERNAL_HOST_SESSION_ID,
  HELI_YOLO: process.env.HELI_YOLO,
  HELI_GUARDS: process.env.HELI_GUARDS,
};

function git(repoDir, args) {
  const result = spawnSync("git", args, { cwd: repoDir, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function runHook(path, cwd, env, payload) {
  const result = spawnSync(process.execPath, [path], {
    cwd,
    env,
    input: JSON.stringify(payload),
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(
    result.status,
    0,
    "hook failed: " + path + "\nstdout:\n" + result.stdout + "\nstderr:\n" + result.stderr,
  );
  return result;
}

async function verifyHost(host) {
  const scratch = mkdtempSync(join(tmpdir(), "heli-" + host + "-session-lifecycle-"));
  const workspace = join(scratch, "workspace");
  const repoDir = join(workspace, "repos", "app");
  const config = join(scratch, "config");
  const data = join(scratch, "data");
  const plugin = join(root, ".heli-harness", "adapters", host + "-plugin");
  const hooks = join(plugin, "hooks");

  try {
    mkdirSync(repoDir, { recursive: true });
    git(repoDir, ["init", "-q"]);
    writeFileSync(join(repoDir, "notes.txt"), "baseline\n");
    git(repoDir, ["add", "."]);
    git(repoDir, ["-c", "user.name=Heli Test", "-c", "user.email=heli@example.invalid", "commit", "-qm", "baseline"]);

    Object.assign(process.env, {
      HELI_CONFIG_DIR: config,
      HELI_DATA_DIR: data,
      HELI_YOLO: "0",
      HELI_GUARDS: "on",
    });
    delete process.env.HELI_SESSION_ID;
    delete process.env.HELI_EXTERNAL_HOST_SESSION_ID;

    const parent = linkProject(root, workspace);
    const nested = linkProject(root, repoDir);
    assert.equal(nested.workspaceId, parent.workspaceId);
    assert.equal(nested.nestedRepositoryRegistered, true);

    const env = {
      ...process.env,
      HELI_CONFIG_DIR: config,
      HELI_DATA_DIR: data,
      HELI_YOLO: "0",
      HELI_GUARDS: "on",
    };
    delete env.HELI_SESSION_ID;
    delete env.HELI_EXTERNAL_HOST_SESSION_ID;

    const externalId = host + "-host-session-1";
    const start = runHook(join(hooks, "heli-session-start.mjs"), repoDir, env, {
      session_id: externalId,
      cwd: repoDir,
      hook_event_name: "SessionStart",
      source: "startup",
    });
    const startOutput = JSON.parse(start.stdout);
    assert.equal(startOutput.hookSpecificOutput?.hookEventName, "SessionStart");

    let sessions = listActiveSessions(workspace);
    assert.equal(sessions.length, 1, host + ": SessionStart must create one active Heli session");
    const session = sessions[0];
    assert.equal(session.host, host);
    assert.equal(session.externalHostSessionId, externalId);
    assert.equal(session.taskId, null, host + ": taskless host start must not invent a task");
    assert.equal(session.runtimeAttestation?.observedCapabilities?.session_start?.observed, true);

    const pre = runHook(join(hooks, "heli-pre-tool-use.mjs"), repoDir, env, {
      session_id: externalId,
      cwd: repoDir,
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: {
        file_path: join(repoDir, "notes.txt"),
        content: "from " + host + "\n",
      },
    });
    if (pre.stdout.trim()) {
      const decision = JSON.parse(pre.stdout);
      assert.notEqual(
        decision.hookSpecificOutput?.permissionDecision,
        "deny",
        host + ": normal harmless write must not be denied: " + pre.stdout,
      );
    }
    writeFileSync(join(repoDir, "notes.txt"), "from " + host + "\n");

    sessions = listActiveSessions(workspace);
    assert.equal(sessions[0].runtimeAttestation?.observedCapabilities?.pre_tool?.observed, true);
    const authority = readResourceLeaseForWorktree(workspace, repoDir);
    assert.ok(authority, host + ": normal write must acquire resource writer authority");
    assert.equal(authority.sessionId, session.sessionId);

    const continuation = continuationForWorktree(workspace, repoDir);
    assert.ok(continuation, host + ": normal write must create durable continuation");
    assert.equal(continuation.provenance?.lastHost, host);

    const pluginPaths = await import(join(plugin, "shared", "concurrency", "paths.mjs"));
    const pluginSessions = await import(join(plugin, "shared", "concurrency", "session.mjs"));
    const pluginWorkspaceRoot = pluginPaths.findWorkspaceRoot(repoDir);
    assert.equal(pluginWorkspaceRoot, realpathSync(workspace), host + ": plugin findWorkspaceRoot must resolve parent linked workspace");
    const pluginExactSession = pluginSessions.findSessionByExternalId(pluginWorkspaceRoot, externalId, { host });
    assert.ok(pluginExactSession, host + ": plugin session store must find exact external host session before SessionEnd");
    assert.equal(pluginExactSession.sessionId, session.sessionId);

    runHook(join(hooks, "heli-session-end.mjs"), repoDir, env, {
      session_id: externalId,
      cwd: repoDir,
      hook_event_name: "SessionEnd",
      reason: "other",
    });

    assert.equal(
      listActiveSessions(workspace).filter((entry) => entry.host === host).length,
      0,
      host + ": SessionEnd must close active Heli session",
    );
    assert.equal(
      readResourceLeaseForWorktree(workspace, repoDir),
      null,
      host + ": SessionEnd must release resource writer authority",
    );
    const closed = listSessions(workspace).find((entry) => entry.sessionId === session.sessionId);
    assert.equal(closed?.status, "closed");
    assert.equal(
      continuationForWorktree(workspace, repoDir)?.continuationId,
      continuation.continuationId,
      host + ": SessionEnd must preserve continuation evidence",
    );

    const externalId2 = host + "-host-session-2";
    const resumeStart = runHook(join(hooks, "heli-session-start.mjs"), repoDir, env, {
      session_id: externalId2,
      cwd: repoDir,
      hook_event_name: "SessionStart",
      source: "startup",
    });
    const resumedOutput = JSON.parse(resumeStart.stdout);
    assert.ok(
      (resumedOutput.hookSpecificOutput?.additionalContext || "").includes(continuation.continuationId),
      host + ": next session context must surface durable continuation",
    );

    const resumed = listActiveSessions(workspace);
    assert.equal(resumed.length, 1);
    assert.equal(resumed[0].externalHostSessionId, externalId2);
    assert.notEqual(resumed[0].sessionId, session.sessionId);

    runHook(join(hooks, "heli-session-end.mjs"), repoDir, env, {
      session_id: externalId2,
      cwd: repoDir,
      hook_event_name: "SessionEnd",
      reason: "other",
    });

    console.log("smoke-" + host + "-session-lifecycle: start -> normal write -> continuation -> SessionEnd/release -> resume passed");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

try {
  await verifyHost("codex");
  await verifyHost("claude");
} finally {
  for (const [key, value] of Object.entries(prior)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
}
