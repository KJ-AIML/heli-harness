#!/usr/bin/env node
/**
 * Claude/Codex-style SessionStart hook wrapper around shared hook-core.
 */
import { buildSessionContext } from "./hook-core.mjs";

const context = buildSessionContext(process.cwd(), { host: "claude-style" });

process.stdout.write(
	JSON.stringify({
		hookSpecificOutput: {
			hookEventName: "SessionStart",
			additionalContext: context,
		},
	}),
);
