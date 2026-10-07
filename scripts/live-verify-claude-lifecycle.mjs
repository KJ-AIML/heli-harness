#!/usr/bin/env node
/**
 * Real Claude Code lifecycle acceptance for taskless Heli continuity.
 *
 * Loads the working-tree Claude plugin into a real `claude -p` turn, performs
 * one harmless Write tool mutation, and then verifies SessionEnd closes the
 * Heli session, releases writer authority, and preserves continuation.
 */
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
const version = spawnSync("claude", ["--version"], { encoding: "utf8" });
if (version.error?.code === "ENOENT") {
  console.log("skip: claude CLI not installed");
  process.exit(0);
}

const scratch = mkdtempSync(join(tmpdir(), "heli-live-claude-lifecycle-"));
const workspace = join(scratch, "workspace");
const repoDir = join(workspace, "repos", "app");
const config = join(scratch, "heli-config");
const data = join(scratch, "heli-data");
const prior = {
  HELI_CONFIG_DIR: process.env.HELI_CONFIG_DIR,
  HELI_DATA_DIR: process.env.HELI_DATA_DIR,
  HELI_SESSION_ID: process.env.HELI_SESSION_ID,
  HELI_EXTERNAL_HOST_SESSION_ID: process.env.HELI_EXTERNAL_HOST_SESSION_ID,
  HELI_YOLO: process.env.HELI_YOLO,
  HELI_GUARDS: process.env.HELI_GUARDS,
};

Object.assign(process.env, {
  HELI_CONFIG_DIR: config,
  HELI_DATA_DIR: data,
  HELI_YOLO: "0",
  HELI_GUARDS: "on",
});
delete process.env.HELI_SESSION_ID;
delete process.env.HELI_EXTERNAL_HOST_SESSION_ID;

function git(args) {
  const result = spawnSync("git", args, { cwd: repoDir, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

try {
  mkdirSync(repoDir, { recursive: true });
  git(["init", "-q"]);
  writeFileSync(join(repoDir, "notes.txt"), "baseline\n");
  git(["add", "."]);
  git(["-c", "user.name=Heli Test", "-c", "user.email=heli@example.invalid", "commit", "-qm", "baseline"]);

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

  const pluginRoot = join(root, ".heli-harness", "adapters", "claude-plugin");
  assert.ok(existsSync(join(pluginRoot, ".claude-plugin", "plugin.json")));

  const prompt = [
    "This is a harmless lifecycle acceptance fixture.",
    "Use the Write tool exactly once to replace notes.txt with exactly: from real claude",
    "Do not use Bash, git, network, package-manager, or any other tool.",
    "After the write succeeds, reply exactly CLAUDE_WRITE_DONE.",
  ].join("\n");

  const run = spawnSync(
    "claude",
    [
      "-p",
      prompt,
      "--plugin-dir",
      pluginRoot,
      "--setting-sources",
      "project,local",
      "--permission-mode",
      "acceptEdits",
      "--permission-prompts",
      "none",
      "--tools",
      "Write",
      "--output-format",
      "stream-json",
      "--include-hook-events",
      "--verbose",
    ],
    {
      cwd: repoDir,
      env,
      encoding: "utf8",
      timeout: 120_000,
    },
  );

  const output = `${run.stdout || ""}\n${run.stderr || ""}`;
  assert.equal(run.signal, null, `claude lifecycle acceptance was terminated: ${run.signal}\n${output}`);
  assert.equal(run.status, 0, `claude lifecycle acceptance failed (exit=${run.status})\n${output}`);
  assert.equal(readFileSync(join(repoDir, "notes.txt"), "utf8").trim(), "from real claude");

  const hostSessions = listSessions(workspace).filter((session) => session.host === "claude");
  assert.ok(hostSessions.length >= 1, `expected a persisted Claude Heli session\n${output}`);
  const latest = [...hostSessions]
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .at(-1);

  assert.equal(latest.status, "closed", "real Claude exit must fire SessionEnd and close Heli session");
  assert.equal(latest.taskId, null, "real taskless Claude work must not invent a task");
  assert.equal(latest.runtimeAttestation?.observedCapabilities?.session_start?.observed, true);
  assert.equal(latest.runtimeAttestation?.observedCapabilities?.pre_tool?.observed, true);
  assert.equal(
    listActiveSessions(workspace).filter((session) => session.host === "claude").length,
    0,
    "no Claude Heli session may remain active after claude -p exits",
  );
  assert.equal(
    readResourceLeaseForWorktree(workspace, repoDir),
    null,
    "real Claude SessionEnd must release resource writer authority",
  );

  const continuation = continuationForWorktree(workspace, repoDir);
  assert.ok(continuation, "real Claude normal write must leave durable continuation");
  assert.equal(continuation.provenance?.lastHost, "claude");

  console.log("claude live lifecycle verify:");
  console.log(`  claude=${String(version.stdout || "").trim()}`);
  console.log(`  heliSession=${latest.sessionId} external=${latest.externalHostSessionId || "none"}`);
  console.log(`  continuation=${continuation.continuationId} lastHost=${continuation.provenance?.lastHost}`);
  console.log("  SessionStart: PASS");
  console.log("  normal harmless write: PASS");
  console.log("  runtime pre_tool evidence: PASS");
  console.log("  SessionEnd + writer release: PASS");
  console.log("claude live lifecycle verify ok");
} finally {
  for (const [key, value] of Object.entries(prior)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  if (!process.env.HELI_LIVE_KEEP) {
    rmSync(scratch, { recursive: true, force: true });
  } else {
    console.log("kept workdir", scratch);
  }
}
