#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import {
  continuationForWorktree,
  listActiveSessions,
  listSessions,
  readResourceLeaseForWorktree,
} from "../lib/concurrency/index.mjs";
import { linkProject } from "../lib/cli/link.mjs";

const root = process.cwd();
const scratch = mkdtempSync(join(tmpdir(), "heli-pi-lifecycle-"));
const workspace = join(scratch, "workspace");
const repoDir = join(workspace, "repos", "app");
const home = join(scratch, "home");
const config = join(scratch, "config");
const data = join(scratch, "data");
const previousCwd = process.cwd();
const prior = {
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  HELI_CONFIG_DIR: process.env.HELI_CONFIG_DIR,
  HELI_DATA_DIR: process.env.HELI_DATA_DIR,
  HELI_SESSION_ID: process.env.HELI_SESSION_ID,
};

Object.assign(process.env, {
  HOME: home,
  USERPROFILE: home,
  HELI_CONFIG_DIR: config,
  HELI_DATA_DIR: data,
});
delete process.env.HELI_SESSION_ID;

function git(args, cwd = repoDir) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

try {
  mkdirSync(repoDir, { recursive: true });
  mkdirSync(home, { recursive: true });
  git(["init", "-q"]);
  writeFileSync(join(repoDir, "notes.txt"), "baseline\n");
  git(["add", "."]);
  git(["-c", "user.name=Heli Test", "-c", "user.email=heli@example.invalid", "commit", "-qm", "baseline"]);

  const parent = linkProject(root, workspace);
  const nested = linkProject(root, repoDir);
  assert.equal(nested.workspaceId, parent.workspaceId);
  assert.equal(nested.nestedRepositoryRegistered, true);

  process.chdir(repoDir);

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

  const governed = await import(pathToFileURL(join(root, "extensions", "pi-governed.js")).href);
  governed.default(pi);

  const names = events.map((event) => event.name);
  assert.ok(names.includes("session_start"), "Pi must register session_start");
  assert.ok(names.includes("before_agent_start"), "Pi must register before_agent_start");
  assert.ok(names.includes("tool_call"), "Pi must register tool_call");
  assert.ok(names.includes("session_shutdown"), "Pi must register session_shutdown");
  assert.ok(commands.length > 0, "Pi commands must remain registered");

  const sessionStart = events.find((event) => event.name === "session_start").handler;
  const beforeAgentStart = events.find((event) => event.name === "before_agent_start").handler;
  const toolCall = events.find((event) => event.name === "tool_call").handler;
  const sessionShutdown = events.find((event) => event.name === "session_shutdown").handler;

  await sessionStart({ sessionId: "pi-host-session-1" }, ctx);
  const firstPrompt = await beforeAgentStart({ systemPrompt: "base prompt" }, ctx);
  assert.match(firstPrompt?.systemPrompt || "", /Heli linked project detected/, "nested repo must inherit linked parent workspace context");
  assert.match(firstPrompt?.systemPrompt || "", /Heli Linked Session|Heli Concurrent Session/, "nested repo must receive shared Heli session context");

  let sessions = listActiveSessions(workspace);
  assert.equal(sessions.length, 1, "session_start must create one active Heli session");
  const firstSession = sessions[0];
  assert.equal(firstSession.host, "pi");
  assert.equal(firstSession.externalHostSessionId, "pi-host-session-1");
  assert.equal(firstSession.taskId, null, "taskless host work must not invent a task");
  assert.equal(firstSession.runtimeAttestation?.observedCapabilities?.session_start?.observed, true);

  const writeDecision = await toolCall(
    { toolName: "write", input: { path: "notes.txt", content: "from pi\n" } },
    ctx,
  );
  assert.ok(!writeDecision?.block, `normal harmless Pi write must be allowed: ${writeDecision?.reason || ""}`);
  writeFileSync(join(repoDir, "notes.txt"), "from pi\n");

  sessions = listActiveSessions(workspace);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].runtimeAttestation?.observedCapabilities?.pre_tool?.observed, true);

  const authority = readResourceLeaseForWorktree(workspace, repoDir);
  assert.ok(authority, "normal write must acquire resource writer authority");
  assert.equal(authority.sessionId, firstSession.sessionId);

  const continuation = continuationForWorktree(workspace, repoDir);
  assert.ok(continuation, "normal taskless write must create durable continuation");
  assert.equal(continuation.provenance.lastHost, "pi");

  await sessionShutdown({}, ctx);
  assert.equal(readResourceLeaseForWorktree(workspace, repoDir), null, "session_shutdown must release Pi writer authority");
  assert.equal(listActiveSessions(workspace).length, 0, "session_shutdown must close the active Pi session");

  const closed = listSessions(workspace).find((session) => session.sessionId === firstSession.sessionId);
  assert.equal(closed?.status, "closed");
  assert.ok(continuationForWorktree(workspace, repoDir), "continuation must survive session shutdown");

  await sessionStart({ sessionId: "pi-host-session-2" }, ctx);
  const resumedPrompt = await beforeAgentStart({ systemPrompt: "base prompt" }, ctx);
  assert.match(resumedPrompt?.systemPrompt || "", /Durable continuation available/, "next Pi host session must receive durable continuation context");
  assert.match(resumedPrompt?.systemPrompt || "", /Previous host: pi/, "continuation context must identify the previous Pi host");
  const resumed = listActiveSessions(workspace);
  assert.equal(resumed.length, 1);
  assert.equal(resumed[0].externalHostSessionId, "pi-host-session-2");
  assert.notEqual(resumed[0].sessionId, firstSession.sessionId);

  const resumedContinuation = continuationForWorktree(workspace, repoDir);
  assert.equal(resumedContinuation?.continuationId, continuation.continuationId);
  assert.equal(resumedContinuation?.provenance?.lastHost, "pi");

  console.log("smoke-pi-session-lifecycle: session -> normal write -> continuation -> shutdown/release -> resume passed");
} finally {
  process.chdir(previousCwd);
  for (const [key, value] of Object.entries(prior)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(scratch, { recursive: true, force: true });
}
