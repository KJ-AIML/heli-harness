#!/usr/bin/env node
/**
 * Claude/Codex/Kimi-style PreToolUse hook wrapper around shared hook-core.
 */
import { stdin } from "node:process";
import { evaluatePreToolUse } from "./hook-core.mjs";

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

const event = input.trim() ? JSON.parse(input) : {};
const toolName = String(event?.tool_name ?? event?.toolName ?? "");
const toolInput = event?.tool_input ?? event?.toolInput ?? {};
const result = evaluatePreToolUse({
	cwd: process.cwd(),
	toolName,
	toolInput,
	host: "claude-style",
	hookPayload: event,
});

if (result.deny) deny(result.reason);
