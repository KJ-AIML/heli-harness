#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { linkProject } from "../lib/cli/link.mjs";
import { setupHeli } from "../lib/cli/setup.mjs";
import {
	consumeApplicableGrant,
	grantStorePaths,
	issueGrant,
	listGrants,
} from "../lib/concurrency/grant.mjs";
import { projectWorkspaceKey } from "../lib/concurrency/project-binding.mjs";
import { writeJsonAtomic } from "../lib/concurrency/fs-atomic.mjs";
import { userPolicyPath } from "../lib/concurrency/policy-composition.mjs";
import { evaluatePreToolUse } from "../.heli-harness/adapters/shared/hook-core.mjs";

const root = mkdtempSync(join(tmpdir(), "heli-grants-"));
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

	const denied = evaluatePreToolUse({
		cwd: project,
		host: "test",
		env,
		toolName: "Bash",
		toolInput: { command: "git push origin main" },
	});
	assert.equal(denied.deny, true);
	assert.equal(denied.code, "REMOTE_PUSH_DENIED");

	// Looking for a grant is a read: it must not create per-workspace grant-store
	// directories (tests used to litter the real ~/.heli/grants this way).
	const grantStoreDir = grantStorePaths(project, { env }).dir;
	assert.equal(existsSync(grantStoreDir), false, "a denied hook call must not create the grant store");
	assert.equal(consumeApplicableGrant(project, { action: "git.push", env }), null);
	assert.equal(existsSync(grantStoreDir), false, "consuming with no grants must not create the grant store");

	const once = issueGrant(project, {
		action: "git.push",
		scope: "once",
		resource: { type: "workspace", id: projectWorkspaceKey(project, { env }) },
		env,
	});
	assert.match(once.grantId, /^heli-grant-/);
	assert.equal(once.remainingUses, 1);
	assert.equal(listGrants(project, { activeOnly: true, env }).length, 1);

	const allowedOnce = evaluatePreToolUse({
		cwd: project,
		host: "test",
		env,
		toolName: "Bash",
		toolInput: { command: "git push origin main" },
	});
	assert.equal(allowedOnce.deny, false);
	assert.equal(allowedOnce.grants[0].grantId, once.grantId);

	const deniedAgain = evaluatePreToolUse({
		cwd: project,
		host: "test",
		env,
		toolName: "Bash",
		toolInput: { command: "git push origin main" },
	});
	assert.equal(deniedAgain.deny, true, "allow-once must be atomically consumed");

	const t5 = issueGrant(project, {
		action: "command.approval.git-tag",
		scope: "once",
		resource: { type: "workspace", id: projectWorkspaceKey(project, { env }) },
		env,
	});
	const tagAllowed = evaluatePreToolUse({
		cwd: project,
		host: "test",
		env,
		toolName: "Bash",
		toolInput: { command: "git tag v1.0.0" },
	});
	assert.equal(tagAllowed.deny, false);
	assert.equal(tagAllowed.grants[0].grantId, t5.grantId);

	issueGrant(project, {
		action: "command.approval.destructive-delete",
		scope: "workspace",
		resource: { type: "workspace", id: projectWorkspaceKey(project, { env }) },
		env,
	});
	const hardDenied = evaluatePreToolUse({
		cwd: project,
		host: "test",
		env,
		toolName: "Bash",
		toolInput: { command: "rm -rf tmp" },
	});
	assert.equal(hardDenied.deny, true);
	assert.equal(hardDenied.code, "TIER_BLOCKED");
	assert.equal(hardDenied.hardDeny, true);

	writeJsonAtomic(userPolicyPath(env), {
		schemaVersion: 1,
		grantableActions: null,
		denyActions: ["git.push"],
		preferences: {},
	});
	assert.throws(
		() => issueGrant(project, {
			action: "git.push",
			scope: "once",
			resource: { type: "workspace", id: projectWorkspaceKey(project, { env }) },
			env,
		}),
		(error) => error.code === "GRANT_NOT_PERMITTED",
		"trusted user ceiling must not be widened by project/request",
	);

	// Default grant model (issue #35): a grant is workspace-wide; executionId is
	// null unless the issuer pins one explicitly.
	assert.equal(listGrants(project, { activeOnly: false, env })[0].executionId, null);
	console.log("scoped grants smoke ok");
} finally {
	if (oldConfig == null) delete process.env.HELI_CONFIG_DIR;
	else process.env.HELI_CONFIG_DIR = oldConfig;
	if (oldData == null) delete process.env.HELI_DATA_DIR;
	else process.env.HELI_DATA_DIR = oldData;
	rmSync(root, { recursive: true, force: true });
}
