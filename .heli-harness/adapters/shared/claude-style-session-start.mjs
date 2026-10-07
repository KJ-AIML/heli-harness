#!/usr/bin/env node
/**
 * Claude/Codex-style SessionStart hook wrapper around shared hook-core.
 *
 * Preserve the host's external session id in Heli's durable session binding so
 * later PreToolUse and SessionEnd events resolve the exact same Heli session.
 */
import { buildSessionContext } from "./hook-core.mjs";

let input = "";
for await (const chunk of process.stdin) input += chunk;
let hookPayload = null;
if (input.trim()) {
	try {
		const parsed = JSON.parse(input);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) hookPayload = parsed;
	} catch {
		// Malformed host payload still gets normal workspace context, but without
		// an external host-session binding that could target the wrong session.
	}
}

const host = process.env.HELI_ADAPTER_ID || "claude-style";
const cwd = hookPayload?.cwd || process.cwd();
const context = buildSessionContext(cwd, {
	host,
	hookPayload,
	recordSessionStart: true,
	sessionStartSource: "SessionStart",
});

process.stdout.write(
	JSON.stringify({
		hookSpecificOutput: {
			hookEventName: "SessionStart",
			additionalContext: context,
		},
	}),
);
