#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	createSession,
	observeRuntimeCapability,
} from "../lib/concurrency/index.mjs";
import { linkProject } from "../lib/cli/link.mjs";
import { status } from "../lib/cli/status.mjs";

const scratch = mkdtempSync(join(tmpdir(), "heli-runtime-status-"));
const workspace = join(scratch, "workspace");
const home = join(scratch, "home");
const config = join(scratch, "config");
const data = join(scratch, "data");
const prior = {
	HOME: process.env.HOME,
	USERPROFILE: process.env.USERPROFILE,
	HELI_CONFIG_DIR: process.env.HELI_CONFIG_DIR,
	HELI_DATA_DIR: process.env.HELI_DATA_DIR,
};
Object.assign(process.env, {
	HOME: home,
	USERPROFILE: home,
	HELI_CONFIG_DIR: config,
	HELI_DATA_DIR: data,
});

try {
	mkdirSync(workspace, { recursive: true });
	mkdirSync(home, { recursive: true });
	linkProject(process.cwd(), workspace);

	const active = createSession(workspace, {
		sessionId: "codex-active",
		externalHostSessionId: "codex-host-active",
		host: "codex",
		worktreePath: workspace,
	});
	observeRuntimeCapability(workspace, active.sessionId, {
		host: "codex",
		capability: "session_start",
		source: "test",
	});
	observeRuntimeCapability(workspace, active.sessionId, {
		host: "codex",
		capability: "pre_tool",
		source: "test",
	});

	const sessionOnly = createSession(workspace, {
		sessionId: "pi-session-only",
		externalHostSessionId: "pi-host-session",
		host: "pi",
		worktreePath: workspace,
	});
	observeRuntimeCapability(workspace, sessionOnly.sessionId, {
		host: "pi",
		capability: "session_start",
		source: "test",
	});

	createSession(workspace, {
		sessionId: "claude-unobserved",
		externalHostSessionId: "claude-host-unobserved",
		host: "claude",
		worktreePath: workspace,
	});

	const result = status(workspace);
	const byHost = Object.fromEntries(result.runtimeHosts.map((item) => [item.host, item]));
	assert.equal(byHost.codex.state, "active");
	assert.equal(byHost.codex.sessionStart.current, true);
	assert.equal(byHost.codex.preTool.current, true);

	assert.equal(byHost.pi.state, "session-only");
	assert.equal(byHost.pi.sessionStart.current, true);
	assert.equal(byHost.pi.preTool.current, false);
	assert.equal(byHost.pi.preTool.reason, "NOT_OBSERVED");

	assert.equal(byHost.claude.state, "inactive");
	assert.equal(byHost.claude.sessionStart.current, false);
	assert.equal(byHost.claude.preTool.current, false);

	console.log("smoke-runtime-status: active/session-only/inactive truthfulness passed");
} finally {
	for (const [key, value] of Object.entries(prior)) {
		if (value == null) delete process.env[key];
		else process.env[key] = value;
	}
	rmSync(scratch, { recursive: true, force: true });
}
