#!/usr/bin/env node
/**
 * Claude/Codex/Kimi-style PreToolUse hook wrapper around shared hook-core.
 */
import { stdin } from "node:process";
import { evaluatePreToolUse } from "./hook-core.mjs";
import { observeRuntimeCapability } from "./concurrency/attestation.mjs";
import { recordGuardDecision } from "./concurrency/governance-decision.mjs";

const input = await new Promise((resolve) => {
	let data = "";
	stdin.setEncoding("utf8");
	stdin.on("data", (chunk) => {
		data += chunk;
	});
	stdin.on("end", () => resolve(data));
});

function deny(reason) {
	process.stdout.write(
		JSON.stringify({
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "deny",
				permissionDecisionReason: reason,
			},
		}),
	);
}

const host = process.env.HELI_ADAPTER_ID || "claude-style";
const event = input.trim() ? JSON.parse(input) : {};
const toolName = String(event?.tool_name ?? event?.toolName ?? "");
const toolInput = event?.tool_input ?? event?.toolInput ?? {};
const result = evaluatePreToolUse({
	cwd: process.cwd(),
	toolName,
	toolInput,
	host,
	hookPayload: event,
});
if (result.ctx?.workspaceRoot && result.ctx?.sessionId) {
	observeRuntimeCapability(result.ctx.workspaceRoot, result.ctx.sessionId, { host, capability: "pre_tool", source: "PreToolUse" });
	observeRuntimeCapability(result.ctx.workspaceRoot, result.ctx.sessionId, { host, capability: "structured_tool_input", source: "PreToolUse" });
}
recordGuardDecision(result, { host, toolName, source: "PreToolUse" });
if (result.deny) deny(result.reason);
