#!/usr/bin/env node
/**
 * Claude/Codex/Kimi-style PreToolUse hook wrapper around shared hook-core.
 *
 * Fail-closed contract: hosts treat a crashed or timed-out hook as "allow", so
 * every failure path here prints a JSON deny instead. The decision is written
 * BEFORE any audit/observation side effect, and each side effect is isolated
 * so it can never turn a decision into a crash. Heli modules are imported
 * inside the try block so even an import-time failure denies.
 */
import { stdin } from "node:process";

function readStdin() {
	return new Promise((resolve, reject) => {
		let data = "";
		stdin.setEncoding("utf8");
		stdin.on("data", (chunk) => {
			data += chunk;
		});
		stdin.on("end", () => resolve(data));
		stdin.on("error", reject);
	});
}

function parseHookEvent(input) {
	if (!String(input ?? "").trim()) throw new Error("empty PreToolUse payload");
	const event = JSON.parse(input);
	if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error("PreToolUse payload is not a JSON object");
	const toolName = String(event.tool_name ?? event.toolName ?? "").trim();
	if (!toolName) throw new Error("PreToolUse payload has no tool name");
	return { event, toolName, toolInput: event.tool_input ?? event.toolInput ?? {} };
}

function failClosedReason(error) {
	const detail = `${error?.code ? `${error.code}: ` : ""}${error?.message || String(error)}`;
	return `Heli-Harness could not evaluate this action (${detail}); denying (fail-closed). Run \`heli doctor\`.`;
}

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
let parsed = null;
let result = null;
try {
	parsed = parseHookEvent(await readStdin());
	const { evaluatePreToolUse } = await import("./hook-core.mjs");
	result = evaluatePreToolUse({
		cwd: process.cwd(),
		toolName: parsed.toolName,
		toolInput: parsed.toolInput,
		host,
		hookPayload: parsed.event,
	});
} catch (error) {
	const reason = failClosedReason(error);
	process.stderr.write(`${reason}\n`);
	deny(reason);
}

if (result) {
	// 1. Decision first — nothing below may change or delay it.
	if (result.deny) deny(result.reason);
	// 2. Evidence side effects, each isolated.
	const sideEffect = async (label, fn) => {
		try {
			await fn();
		} catch (error) {
			process.stderr.write(`Heli-Harness: ${label} failed after the decision was issued (${error?.code || error?.message || error}).\n`);
		}
	};
	if (result.ctx?.workspaceRoot && result.ctx?.sessionId) {
		await sideEffect("runtime observation", async () => {
			const { observeRuntimeCapability } = await import("./concurrency/attestation.mjs");
			observeRuntimeCapability(result.ctx.workspaceRoot, result.ctx.sessionId, {
				host,
				capability: "pre_tool",
				source: "PreToolUse",
				details: { decision: result.deny ? "deny" : "allow" },
			});
			observeRuntimeCapability(result.ctx.workspaceRoot, result.ctx.sessionId, { host, capability: "structured_tool_input", source: "PreToolUse" });
		});
	}
	await sideEffect("decision receipt", async () => {
		const { recordGuardDecision } = await import("./concurrency/governance-decision.mjs");
		recordGuardDecision(result, { host, toolName: parsed.toolName, source: "PreToolUse" });
	});
}
