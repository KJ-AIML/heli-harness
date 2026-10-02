#!/usr/bin/env node
/**
 * Claude/Codex-style SessionStart hook wrapper around shared hook-core.
 */
import { buildSessionContext } from "./hook-core.mjs";

const host = process.env.HELI_ADAPTER_ID || "claude-style";
const cwd = process.cwd();
const context = buildSessionContext(cwd, { host, recordSessionStart: true });

process.stdout.write(
	JSON.stringify({
		hookSpecificOutput: {
			hookEventName: "SessionStart",
			additionalContext: context,
		},
	}),
);
