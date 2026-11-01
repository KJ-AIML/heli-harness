/**
 * Claude-style Stop hook: keeps an agent working its approved run (see concurrency/runs.mjs runContinuation).
 *
 * Reads the Stop payload (`{ session_id, cwd, stop_hook_active, ... }`) from stdin. When the session is the one an active
 * approved run is bound to, it prints `{"decision":"block","reason":...}`, which the host takes as the next instruction
 * instead of ending the turn; otherwise it prints nothing and the agent stops. A user interrupt never reaches it. It fails
 * open: any error lets the agent stop, since keeping an agent running is never the safe default.
 */
import { findWorkspaceRoot } from "./concurrency/paths.mjs";
import { runContinuation } from "./concurrency/runs.mjs";

async function readStdin() {
	let data = "";
	for await (const chunk of process.stdin) data += chunk;
	return data;
}

try {
	const payload = JSON.parse((await readStdin()) || "{}");
	const workspaceRoot = findWorkspaceRoot(payload.cwd || process.cwd());
	if (workspaceRoot) {
		const decision = runContinuation(workspaceRoot, { externalSessionId: payload.session_id || payload.sessionId || null });
		if (decision.block) process.stdout.write(JSON.stringify({ decision: "block", reason: decision.reason }));
	}
} catch {
	// Fail open: the agent stops.
}
