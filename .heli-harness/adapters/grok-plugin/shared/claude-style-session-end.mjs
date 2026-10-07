#!/usr/bin/env node
/**
 * Claude/Codex-style SessionEnd hook.
 *
 * SessionEnd is cleanup only. Resolve by the exact external host session id
 * supplied by the host, then close only that matching active Heli session.
 * Do not use worktree "latest" or host-binding heuristics during cleanup.
 */
import {
	closeSession,
	findSessionByExternalId,
} from "./concurrency/session.mjs";
import { extractExternalHostSessionId } from "./concurrency/resolve.mjs";
import { findWorkspaceRoot } from "./concurrency/paths.mjs";

let input = "";
for await (const chunk of process.stdin) input += chunk;
let hookPayload = null;
if (input.trim()) {
	try {
		const parsed = JSON.parse(input);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) hookPayload = parsed;
	} catch {
		// Unparseable end payload cannot safely identify a foreign session.
	}
}

const host = process.env.HELI_ADAPTER_ID || "claude-style";
const workspaceRoot = findWorkspaceRoot(process.cwd());
const externalHostSessionId = extractExternalHostSessionId(hookPayload || {}, process.env);

if (workspaceRoot && externalHostSessionId) {
	const session = findSessionByExternalId(workspaceRoot, externalHostSessionId, { host });
	if (process.env.HELI_SESSION_END_DEBUG) {
		process.stderr.write(JSON.stringify({
			workspaceRoot,
			externalHostSessionId,
			host,
			foundSessionId: session?.sessionId || null,
		}) + "\n");
	}
	if (session?.sessionId) closeSession(workspaceRoot, session.sessionId);
}
