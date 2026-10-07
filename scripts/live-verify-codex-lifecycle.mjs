#!/usr/bin/env node
/**
 * Real Codex lifecycle acceptance for taskless Heli continuity.
 *
 * Uses an isolated CODEX_HOME with the working-tree codex plugin, then drives
 * a real `codex exec` harmless write. After the host exits, Heli must have
 * closed the session, released writer authority, and preserved continuation.
 */
import assert from "node:assert/strict";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
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
const realAuth = join(homedir(), ".codex", "auth.json");
const version = spawnSync("codex", ["--version"], { encoding: "utf8" });
if (version.error?.code === "ENOENT") {
  console.log("skip: codex CLI not installed");
  process.exit(0);
}
if (!existsSync(realAuth)) {
  console.log("skip: no ~/.codex/auth.json (run codex login first)");
  process.exit(0);
}

const scratch = mkdtempSync(join(tmpdir(), "heli-live-codex-lifecycle-"));
const workspace = join(scratch, "workspace");
const repoDir = join(workspace, "repos", "app");
const codexHome = join(scratch, "codex-home");
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

function runCodex(args, options = {}) {
  return spawnSync("codex", args, { encoding: "utf8", ...options });
}
function git(args) {
  const result = spawnSync("git", args, { cwd: repoDir, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

try {
  mkdirSync(repoDir, { recursive: true });
  mkdirSync(codexHome, { recursive: true });
  copyFileSync(realAuth, join(codexHome, "auth.json"));

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
    CODEX_HOME: codexHome,
    HELI_CONFIG_DIR: config,
    HELI_DATA_DIR: data,
    HELI_YOLO: "0",
    HELI_GUARDS: "on",
  };
  delete env.HELI_SESSION_ID;
  delete env.HELI_EXTERNAL_HOST_SESSION_ID;

  const pluginRoot = join(root, ".heli-harness", "adapters", "codex-plugin");
  const marketplace = runCodex(["plugin", "marketplace", "add", pluginRoot], { env });
  assert.equal(marketplace.status, 0, marketplace.stderr || marketplace.stdout);
  const pluginAdd = runCodex(["plugin", "add", "heli-harness@heli-harness"], { env });
  assert.equal(pluginAdd.status, 0, pluginAdd.stderr || pluginAdd.stdout);

  const prompt = [
    "This is a harmless lifecycle acceptance fixture.",
    "Modify notes.txt so its only text is: from real codex",
    "Use a file-editing tool only. Do not run git, shell, network, or package-manager commands.",
    "After the file write succeeds, reply exactly CODEX_WRITE_DONE.",
  ].join("\n");

  const run = runCodex(
    [
      "exec",
      prompt,
      "--sandbox",
      "workspace-write",
      "--skip-git-repo-check",
      "--dangerously-bypass-hook-trust",
    ],
    {
      cwd: repoDir,
      env,
      timeout: 120_000,
    },
  );
  const output = `${run.stdout || ""}\n${run.stderr || ""}`;
  assert.equal(run.signal, null, `codex lifecycle acceptance was terminated: ${run.signal}\n${output}`);
  assert.equal(run.status, 0, `codex lifecycle acceptance failed (exit=${run.status})\n${output}`);
  assert.equal(readFileSync(join(repoDir, "notes.txt"), "utf8").trim(), "from real codex");

  const hostSessions = listSessions(workspace).filter((session) => session.host === "codex");
  assert.ok(hostSessions.length >= 1, `expected a persisted Codex Heli session\n${output}`);
  const latest = [...hostSessions]
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .at(-1);

  assert.equal(latest.status, "closed", "real Codex exit must fire SessionEnd and close Heli session");
  assert.equal(latest.taskId, null, "real taskless Codex work must not invent a task");
  assert.equal(latest.runtimeAttestation?.observedCapabilities?.session_start?.observed, true);
  assert.equal(latest.runtimeAttestation?.observedCapabilities?.pre_tool?.observed, true);
  assert.equal(
    listActiveSessions(workspace).filter((session) => session.host === "codex").length,
    0,
    "no Codex Heli session may remain active after codex exec exits",
  );
  assert.equal(
    readResourceLeaseForWorktree(workspace, repoDir),
    null,
    "real Codex SessionEnd must release resource writer authority",
  );

  const continuation = continuationForWorktree(workspace, repoDir);
  assert.ok(continuation, "real Codex normal write must leave durable continuation");
  assert.equal(continuation.provenance?.lastHost, "codex");

  console.log("codex live lifecycle verify:");
  console.log(`  codex=${String(version.stdout || "").trim()}`);
  console.log(`  heliSession=${latest.sessionId} external=${latest.externalHostSessionId || "none"}`);
  console.log(`  continuation=${continuation.continuationId} lastHost=${continuation.provenance?.lastHost}`);
  console.log("  SessionStart: PASS");
  console.log("  normal harmless write: PASS");
  console.log("  runtime pre_tool evidence: PASS");
  console.log("  SessionEnd + writer release: PASS");
  console.log("codex live lifecycle verify ok");
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
