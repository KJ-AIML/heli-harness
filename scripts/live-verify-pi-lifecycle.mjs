#!/usr/bin/env node
/**
 * Real Pi 1.x lifecycle acceptance for taskless Heli continuity.
 *
 * Uses the installed pi binary and the working-tree governed extension.
 * The fixture is isolated to a temporary linked workspace and HELI data dirs.
 * It performs one harmless write and requires Pi's real session_shutdown event
 * to close the Heli session and release writer authority.
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
const version = spawnSync("pi", ["--version"], { encoding: "utf8" });
if (version.error?.code === "ENOENT") {
  console.log("skip: pi CLI not installed");
  process.exit(0);
}

const scratch = mkdtempSync(join(tmpdir(), "heli-live-pi-lifecycle-"));
const workspace = join(scratch, "workspace");
const repoDir = join(workspace, "repos", "app");
const sessionDir = join(scratch, "pi-sessions");
const config = join(scratch, "heli-config");
const data = join(scratch, "heli-data");
const prior = {
  HELI_CONFIG_DIR: process.env.HELI_CONFIG_DIR,
  HELI_DATA_DIR: process.env.HELI_DATA_DIR,
  HELI_SESSION_ID: process.env.HELI_SESSION_ID,
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

function git(args) {
  const result = spawnSync("git", args, { cwd: repoDir, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

try {
  mkdirSync(repoDir, { recursive: true });
  mkdirSync(sessionDir, { recursive: true });
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

  const extension = join(root, "extensions", "pi-governed.js");
  const prompt = [
    "This is a harmless lifecycle acceptance fixture.",
    "Use the write tool exactly once to overwrite notes.txt with exactly this text: from real pi",
    "Do not run shell commands, git commands, network tools, or any other tool.",
    "After the write succeeds, reply exactly PI_WRITE_DONE.",
  ].join("\n");

  const run = spawnSync(
    "pi",
    [
      "-p",
      "--no-extensions",
      "--extension", extension,
      "--no-mcp",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--no-context-files",
      "--session-dir", sessionDir,
      "--tools", "write",
      "--thinking", "minimal",
      prompt,
    ],
    {
      cwd: repoDir,
      env,
      encoding: "utf8",
      timeout: 90_000,
    },
  );

  const output = `${run.stdout || ""}\n${run.stderr || ""}`;
  assert.equal(run.signal, null, `pi lifecycle acceptance was terminated: ${run.signal}\n${output}`);
  assert.equal(run.status, 0, `pi lifecycle acceptance failed (exit=${run.status})\n${output}`);
  assert.ok(existsSync(join(repoDir, "notes.txt")), "Pi must leave notes.txt on disk");
  assert.equal(readFileSync(join(repoDir, "notes.txt"), "utf8"), "from real pi");

  const piSessions = listSessions(workspace).filter((session) => session.host === "pi");
  assert.ok(piSessions.length >= 1, `expected a persisted Pi Heli session\n${output}`);
  const latest = [...piSessions].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).at(-1);
  assert.equal(latest.status, "closed", "real Pi process exit must fire session_shutdown and close Heli session");
  assert.equal(latest.taskId, null, "real taskless Pi work must not invent a task");
  assert.equal(latest.runtimeAttestation?.observedCapabilities?.session_start?.observed, true);
  assert.equal(latest.runtimeAttestation?.observedCapabilities?.pre_tool?.observed, true);

  assert.equal(
    listActiveSessions(workspace).filter((session) => session.host === "pi").length,
    0,
    "no Pi Heli session may remain active after pi -p exits",
  );
  assert.equal(
    readResourceLeaseForWorktree(workspace, repoDir),
    null,
    "real Pi session_shutdown must release resource writer authority",
  );

  const continuation = continuationForWorktree(workspace, repoDir);
  assert.ok(continuation, "real Pi normal write must leave durable continuation");
  assert.equal(continuation.provenance?.lastHost, "pi");

  console.log("pi live lifecycle verify:");
  console.log(`  pi=${String(version.stdout || "").trim()}`);
  console.log(`  heliSession=${latest.sessionId} external=${latest.externalHostSessionId || "none"}`);
  console.log(`  continuation=${continuation.continuationId} lastHost=${continuation.provenance?.lastHost}`);
  console.log("  SessionStart: PASS");
  console.log("  normal harmless write: PASS");
  console.log("  runtime pre_tool evidence: PASS");
  console.log("  session_shutdown + writer release: PASS");
  console.log("pi live lifecycle verify ok");
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
