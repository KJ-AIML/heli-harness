#!/usr/bin/env node
/**
 * Grok Build SessionStart hook.
 */
import { buildSessionContext } from "./hook-core.mjs";

const host = process.env.HELI_ADAPTER_ID || "grok";
const cwd = process.cwd();
let hookPayload = null;
if (!process.stdin.isTTY) {
	try {
		const input = await new Promise((resolve, reject) => {
			let text = "";
			process.stdin.setEncoding("utf8");
			process.stdin.on("data", (chunk) => { text += chunk; });
			process.stdin.on("end", () => resolve(text));
			process.stdin.on("error", reject);
		});
		if (input.trim()) hookPayload = JSON.parse(input);
	} catch {
		// Hosts that provide an empty or non-JSON SessionStart payload still bind
		// through their host-provided environment identity when available.
	}
}
const context = buildSessionContext(cwd, { host, hookPayload, recordSessionStart: true });

process.stdout.write(
	JSON.stringify({
		hookSpecificOutput: {
			hookEventName: "SessionStart",
			additionalContext: context,
		},
		additionalContext: context,
	}),
);
