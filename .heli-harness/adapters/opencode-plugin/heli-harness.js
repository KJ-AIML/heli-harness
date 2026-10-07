/**
 * OpenCode local plugin for Heli-Harness.
 * Uses shared hook-core evaluatePreToolUse / buildSessionContext.
 *
 * Install: copy this whole directory's contents into .opencode/plugins/
 * (OpenCode auto-loads .js/.ts files from that directory; .mjs is NOT
 * auto-discovered, so keep this entry file named heli-harness.js).
 */

import { evaluatePreToolUse, buildSessionContext, resolveExecutionContext } from "./shared/hook-core.mjs";
import { closeSession } from "./shared/concurrency/session.mjs";
import { observeRuntimeCapability } from "./shared/concurrency/attestation.mjs";
import { recordGuardDecision } from "./shared/concurrency/governance-decision.mjs";

export const HeliHarness = async (ctx) => {
	const directory = ctx?.directory || process.cwd();
	const host = "opencode";
	const opened = new Set();
	const remember = (resolved) => {
		if (!resolved?.workspaceRoot || !resolved?.sessionId) return resolved;
		opened.add(`${resolved.workspaceRoot}\n${resolved.sessionId}`);
		return resolved;
	};
	// OpenCode does not always emit session.deleted before a one-shot process
	// exits. Release only the sessions this process opened.
	process.once("exit", () => {
		for (const key of opened) {
			const splitAt = key.indexOf("\n");
			const workspaceRoot = key.slice(0, splitAt);
			const sessionId = key.slice(splitAt + 1);
			try {
				closeSession(workspaceRoot, sessionId);
			} catch {
				// Process exit cannot recover a close failure. TTL remains the backstop.
			}
		}
	});
	const externalSessionId = (input) =>
		input?.sessionID ??
		input?.sessionId ??
		input?.session_id ??
		input?.session?.id ??
		input?.properties?.sessionID ??
		input?.properties?.info?.id ??
		null;

	const ensureSession = (sessionID, source) => {
		const payload = sessionID ? { session_id: sessionID } : null;
		const existing = resolveExecutionContext({
			cwd: directory,
			host,
			hookPayload: payload,
			createIfMissing: false,
			refreshLeaseOnResolve: false,
		});
		if (existing.sessionId) return remember(existing);
		buildSessionContext(directory, {
			host,
			hookPayload: payload,
			recordSessionStart: true,
			sessionStartSource: source,
		});
		return remember(resolveExecutionContext({
			cwd: directory,
			host,
			hookPayload: payload,
			createIfMissing: false,
			refreshLeaseOnResolve: false,
		}));
	};

	return {
		event: async ({ event }) => {
			const sessionID = externalSessionId(event);
			if (event?.type === "session.created") {
				ensureSession(sessionID, "session.created");
			} else if (event?.type === "session.deleted" && sessionID) {
				const resolved = resolveExecutionContext({
					cwd: directory,
					host,
					hookPayload: { session_id: sessionID },
					createIfMissing: false,
					refreshLeaseOnResolve: false,
				});
				if (resolved.workspaceRoot && resolved.sessionId) closeSession(resolved.workspaceRoot, resolved.sessionId);
			}
		},
		"experimental.chat.system.transform": async (input, output) => {
			const sessionID = externalSessionId(input);
			ensureSession(sessionID, "experimental.chat.system.transform");
			if (output && Array.isArray(output.system)) {
				output.system.push(
					buildSessionContext(directory, {
						host,
						hookPayload: sessionID ? { session_id: sessionID } : null,
						recordSessionStart: false,
					}),
				);
			}
		},
		"tool.execute.before": async (input, output) => {
			const sessionID = externalSessionId(input);
			// OpenCode can execute a tool even when the event bus did not deliver
			// session.created. Bind exactly once by stable host session id before
			// evaluating governance; never mint one session per tool call.
			ensureSession(sessionID, "tool.execute.before:fallback");
			const tool = String(input?.tool ?? "");
			const args = output?.args ?? input?.args ?? {};
			const toolInput = {
				...args,
				command: args.command ?? args.cmd,
				file_path: args.filePath ?? args.file_path ?? args.path,
				path: args.path ?? args.filePath ?? args.file_path,
			};
			const result = evaluatePreToolUse({
				cwd: directory,
				toolName: tool,
				toolInput,
				host,
				hookPayload: {
					tool_name: tool,
					tool_input: toolInput,
					session_id: sessionID,
				},
			});
			if (result.ctx?.workspaceRoot && result.ctx?.sessionId) {
				observeRuntimeCapability(result.ctx.workspaceRoot, result.ctx.sessionId, { host, capability: "pre_tool", source: "tool.execute.before" });
				observeRuntimeCapability(result.ctx.workspaceRoot, result.ctx.sessionId, { host, capability: "structured_tool_input", source: "tool.execute.before" });
			}
			recordGuardDecision(result, { host, toolName: tool, source: "tool.execute.before" });
			if (result.deny) throw new Error(result.reason);
		},
		"experimental.session.compacting": async (input, output) => {
			if (output && Array.isArray(output.context)) {
				output.context.push(buildSessionContext(directory, { host }));
				const resolved = resolveExecutionContext({
					cwd: directory,
					host,
					hookPayload: { session_id: externalSessionId(input) },
					createIfMissing: false,
					refreshLeaseOnResolve: false,
				});
				if (resolved.workspaceRoot && resolved.sessionId) {
					observeRuntimeCapability(resolved.workspaceRoot, resolved.sessionId, { host, capability: "compaction", source: "experimental.session.compacting" });
				}
			}
		},
	};
};

export default HeliHarness;
export const heliHarness = HeliHarness;
