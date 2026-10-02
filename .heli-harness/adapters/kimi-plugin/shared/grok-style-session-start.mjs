#!/usr/bin/env node
/**
 * Grok Build SessionStart hook.
 */
import { buildSessionContext } from "./hook-core.mjs";

const host = process.env.HELI_ADAPTER_ID || "grok";
const cwd = process.cwd();
const context = buildSessionContext(cwd, { host, recordSessionStart: true });

process.stdout.write(
	JSON.stringify({
		hookSpecificOutput: {
			hookEventName: "SessionStart",
			additionalContext: context,
		},
		additionalContext: context,
	}),
);
