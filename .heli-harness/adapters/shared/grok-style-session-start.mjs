#!/usr/bin/env node
/**
 * Grok Build SessionStart hook.
 * Grok documents passive events as stdout-ignored; still emit Claude-compat
 * payload for dual-compat loading paths and smoke coverage.
 */

import { buildSessionContext } from "./hook-core.mjs";

const context = buildSessionContext(process.cwd());

process.stdout.write(JSON.stringify({
	hookSpecificOutput: {
		hookEventName: "SessionStart",
		additionalContext: context,
	},
	// Some hosts may surface additionalContext; Grok may ignore stdout on passive events.
	additionalContext: context,
}));
