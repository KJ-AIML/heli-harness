#!/usr/bin/env node
// Fail-closed entry point. Hosts treat a crashed hook as "allow", so when the shared
// wrapper cannot load (broken or half-updated plugin install) this stub prints the
// same deny the wrapper would. The handler is inline on purpose: the shared modules
// are exactly what may have failed. Keep it identical across the per-host stubs.
try {
	process.env.HELI_ADAPTER_ID = "grok";
	await import("../shared/grok-style-pre-tool-use.mjs");
} catch (error) {
	const detail = `${error?.code ? `${error.code}: ` : ""}${error?.message || String(error)}`;
	const reason = `Heli-Harness could not evaluate this action (${detail}); denying (fail-closed). Run \`heli doctor\`.`;
	process.stderr.write(`${reason}\n`);
	process.stdout.write(
		JSON.stringify({
			decision: "deny",
			reason,
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "deny",
				permissionDecisionReason: reason,
			},
		}),
	);
	// Grok's deny channel is exit code 2 (set, not process.exit, so stdout is flushed).
	process.exitCode = 2;
}
