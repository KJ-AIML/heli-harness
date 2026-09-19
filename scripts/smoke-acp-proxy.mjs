#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { install } from "../lib/cli/install.mjs";
import { createTask, createSession, readSession, acquireWriteLease } from "../lib/concurrency/index.mjs";
import { evaluateAcpPermission, registerAcpSession } from "../lib/acp/proxy.mjs";

const root = process.cwd();
const workspace = mkdtempSync(join(tmpdir(), "heli-acp-proxy-"));
const sessionId = "heli-ses-acp-smoke";

try {
	install(join(root, ".heli-harness"), workspace);
	createTask(workspace, {
		taskId: "acp-smoke",
		title: "ACP smoke",
		repositoryId: "demo",
		repositoryPath: workspace,
		worktreePath: workspace,
		allowDuplicate: true,
	});
	createSession(workspace, {
		sessionId,
		host: "acp",
		taskId: "acp-smoke",
		mode: "write",
		worktreePath: workspace,
	});
	acquireWriteLease(workspace, { taskId: "acp-smoke", sessionId, worktreePath: workspace });
	const env = { ...process.env, HELI_SESSION_ID: sessionId };

	const registered = registerAcpSession({ cwd: workspace, sessionId: "acp-session-1", env });
	assert.equal(registered.sessionId, sessionId, "explicit HELI_SESSION_ID remains authoritative");
	assert.equal(readSession(workspace, sessionId).runtimeAttestation.observedCapabilities.session_start.observed, true);

	const denied = evaluateAcpPermission({
		cwd: workspace,
		env,
		params: {
			sessionId: "acp-session-1",
			toolCall: {
				toolCallId: "tool-git-push",
				kind: "execute",
				rawInput: { command: "git push origin main" },
			},
			options: [
				{ optionId: "allow", kind: "allow_once", name: "Allow" },
				{ optionId: "reject", kind: "reject_once", name: "Reject" },
			],
		},
	});
	assert.equal(denied.deny, true);
	assert.equal(denied.outcome.outcome, "selected");
	assert.equal(denied.outcome.optionId, "reject");
	assert.equal(denied.decision.host, "acp");

	const incomplete = evaluateAcpPermission({
		cwd: workspace,
		env,
		params: {
			sessionId: "acp-session-1",
			toolCall: { toolCallId: "tool-opaque", kind: "execute" },
			options: [{ optionId: "allow", kind: "allow_once", name: "Allow" }],
		},
	});
	assert.equal(incomplete.deny, false, "proxy must not invent a denial when ACP rawInput is absent");

	const session = readSession(workspace, sessionId);
	assert.equal(session.runtimeAttestation.observedCapabilities.permission_request.observed, true);
	assert.equal(session.runtimeAttestation.observedCapabilities.structured_tool_input.observed, true);

	const events = readFileSync(join(workspace, ".heli-harness", "tasks", "acp-smoke", "events.jsonl"), "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	assert.ok(events.some((event) => event.type === "guard.decision" && event.decision?.host === "acp"));
	console.log("acp governance proxy smoke ok");
} finally {
	rmSync(workspace, { recursive: true, force: true });
}
