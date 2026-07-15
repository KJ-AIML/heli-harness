#!/usr/bin/env node
/**
 * Grok Build SessionStart hook.
 */
import { buildSessionContext } from "./hook-core.mjs";

const context = buildSessionContext(process.cwd(), { host: "grok" });

process.stdout.write(
	JSON.stringify({
		hookSpecificOutput: {
			hookEventName: "SessionStart",
			additionalContext: context,
		},
		additionalContext: context,
	}),
);
