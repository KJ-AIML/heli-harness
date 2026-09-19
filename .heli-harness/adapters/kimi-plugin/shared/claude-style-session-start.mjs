#!/usr/bin/env node
/**
 * Claude/Codex-style SessionStart hook wrapper around shared hook-core.
 */
import { buildSessionContext, resolveExecutionContext } from "./hook-core.mjs";
import { observeRuntimeCapability } from "./concurrency/attestation.mjs";

const host = process.env.HELI_ADAPTER_ID || "claude-style";
const cwd = process.cwd();
const context = buildSessionContext(cwd, { host });
const ctx = resolveExecutionContext({ cwd, host, createIfMissing: false, refreshLeaseOnResolve: false });
if (ctx.workspaceRoot && ctx.sessionId) {
	observeRuntimeCapability(ctx.workspaceRoot, ctx.sessionId, {
		host,
		capability: "session_start",
		source: "SessionStart",
	});
}

process.stdout.write(
	JSON.stringify({
		hookSpecificOutput: {
			hookEventName: "SessionStart",
			additionalContext: context,
		},
	}),
);
