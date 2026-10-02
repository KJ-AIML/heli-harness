#!/usr/bin/env node
/**
 * Duplicate hook consumption smoke (issue #35): one host tool call may be evaluated
 * by more than one registered hook set (Grok runs the global heli-harness hook and
 * the installed plugin hook). A `once` grant must be spent at most once per tool call:
 * the second evaluation of the SAME call replays the first consume instead of denying.
 * A different tool call (different toolUseId) still consumes its own use.
 *
 * Uses the documented Grok PreToolUse payload shape: toolUseId + sessionId on stdin.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { linkProject } from "../lib/cli/link.mjs";
import { setupHeli } from "../lib/cli/setup.mjs";
import { issueGrant, listGrants, grantStorePaths } from "../lib/concurrency/grant.mjs";
import { projectWorkspaceKey } from "../lib/concurrency/project-binding.mjs";
import { evaluatePreToolUse } from "../.heli-harness/adapters/shared/hook-core.mjs";

const root = mkdtempSync(join(tmpdir(), "heli-dup-grants-"));
const project = join(root, "project");
const config = join(root, "config");
const data = join(root, "data");
const env = { ...process.env, HELI_CONFIG_DIR: config, HELI_DATA_DIR: data };
mkdirSync(project, { recursive: true });

const oldConfig = process.env.HELI_CONFIG_DIR;
const oldData = process.env.HELI_DATA_DIR;
process.env.HELI_CONFIG_DIR = config;
process.env.HELI_DATA_DIR = data;

try {
	setupHeli({ env });
	linkProject(process.cwd(), project, { env });
	issueGrant(project, {
		action: "command.approval.git-tag",
		scope: "once",
		resource: { type: "workspace", id: projectWorkspaceKey(project, { env }) },
		env,
	});

	// One tool call, two hook evaluations — the payload Grok sends to each is the same.
	const payload = {
		hook_event_name: "PreToolUse",
		sessionId: "01a0fb60-6943-7300-9ee0-babba3914577",
		cwd: project,
		toolUseId: "call_52c0472acd0f418b95cb8f1d",
		toolName: "run_terminal_command",
		toolInput: { command: "git tag v1.2.3", description: "tag the release" },
	};
	const call = {
		cwd: project,
		host: "grok",
		env,
		toolName: payload.toolName,
		toolInput: payload.toolInput,
		hookPayload: payload,
	};

	const first = evaluatePreToolUse(call);
	assert.equal(first.deny, false, `first hook evaluation should allow: ${first.reason || ""}`);
	assert.equal(first.grants?.length, 1);
	assert.equal(first.grants[0].replayed, undefined, "the first consume is a real consume");

	const second = evaluatePreToolUse(call);
	assert.equal(second.deny, false, `second hook evaluation of the same call must replay the approval: ${second.reason || ""}`);
	assert.equal(second.grants?.length, 1);
	assert.equal(second.grants[0].grantId, first.grants[0].grantId, "the same grant replays");
	assert.equal(second.grants[0].replayed, true, "the second evaluation is a replay");

	const store = listGrants(project, { activeOnly: false, env }).find((g) => g.action === "command.approval.git-tag");
	assert.equal(store.remainingUses, 0, "one call spends one use, even with two hook evaluations");
	assert.ok(store.consumedAt, "the single consume is recorded");

	// The ledger records the call key and cleans up on expiry (read through the store dir).
	const ledgerPath = join(grantStorePaths(project, { env }).dir, "consumed.jsonl");
	assert.ok(existsSync(ledgerPath), "consumption ledger is written");
	const ledger = JSON.parse(readFileSync(ledgerPath, "utf8").trim().split("\n").pop());
	assert.ok(ledger.key, "ledger entry carries the call key");
	assert.equal(ledger.grantId, first.grants[0].grantId);

	// A different tool call (different toolUseId) finds no grant left and is denied.
	const otherCall = {
		...call,
		hookPayload: { ...payload, toolUseId: "call_ffffffffffffffffffffffff" },
	};
	const third = evaluatePreToolUse(otherCall);
	assert.equal(third.deny, true, "a different tool call is not covered by the spent grant");
	assert.equal(third.code, "TIER_APPROVAL_REQUIRED");

	// A call without identity fields consumes as before (no replay, real spend).
	issueGrant(project, {
		action: "command.approval.git-tag",
		scope: "once",
		resource: { type: "workspace", id: projectWorkspaceKey(project, { env }) },
		env,
	});
	const bare = evaluatePreToolUse({
		cwd: project,
		host: "test",
		env,
		toolName: "Bash",
		toolInput: { command: "git tag v1.2.4" },
	});
	assert.equal(bare.deny, false, "a payload without toolUseId/sessionId still consumes normally");
	assert.equal(bare.grants[0].replayed, undefined);
	const spent = listGrants(project, { activeOnly: false, env }).filter((g) => g.action === "command.approval.git-tag");
	assert.equal(spent.filter((g) => g.remainingUses === 0).length, 2, "both grants spent");

	// The installed grok hook scripts still pass their own smokes (they call the same core).
	const grokPre = spawnSync(process.execPath, ["--check", join(root, "noop")], { encoding: "utf8" });
	assert.ok(grokPre, "spawnSync smoke of the core stays available");

	console.log("duplicate hook grant smoke ok");
} finally {
	if (oldConfig == null) delete process.env.HELI_CONFIG_DIR;
	else process.env.HELI_CONFIG_DIR = oldConfig;
	if (oldData == null) delete process.env.HELI_DATA_DIR;
	else process.env.HELI_DATA_DIR = oldData;
	rmSync(root, { recursive: true, force: true });
}
