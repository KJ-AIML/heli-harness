#!/usr/bin/env node
/**
 * Grok Build PreToolUse hook.
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

const event = input.trim() ? JSON.parse(input) : {};
const toolName = String(event?.tool_name ?? event?.toolName ?? "");
const toolInput = event?.tool_input ?? event?.toolInput ?? {};
const result = evaluatePreToolUse({
	cwd: process.cwd(),
	toolName,
	toolInput,
	host: "grok",
	hookPayload: event,
});

if (result.deny) {
	process.stdout.write(
		JSON.stringify({
			decision: "deny",
			reason: result.reason,
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "deny",
				permissionDecisionReason: result.reason,
			},
		}),
	);
	process.exit(2);
}
