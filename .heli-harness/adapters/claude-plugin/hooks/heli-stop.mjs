#!/usr/bin/env node
// Stop hook entry point. Unlike PreToolUse it fails open: a hook that cannot load prints nothing and the agent stops.
process.env.HELI_ADAPTER_ID = "claude";
try {
	await import("../shared/claude-style-stop.mjs");
} catch {
	// Fail open.
}
