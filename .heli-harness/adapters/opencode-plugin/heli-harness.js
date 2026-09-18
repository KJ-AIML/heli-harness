/**
 * OpenCode local plugin for Heli-Harness.
 * Uses shared hook-core evaluatePreToolUse / buildSessionContext.
 *
 * Install: copy this whole directory's contents into .opencode/plugins/
 * (OpenCode auto-loads .js/.ts files from that directory; .mjs is NOT
 * auto-discovered, so keep this entry file named heli-harness.js).
 */

import { evaluatePreToolUse, buildSessionContext, resolveExecutionContext } from "./shared/hook-core.mjs";
import { observeRuntimeCapability } from "./shared/concurrency/attestation.mjs";
import { recordGuardDecision } from "./shared/concurrency/governance-decision.mjs";

export const HeliHarness = async (ctx) => {
	const directory = ctx?.directory || process.cwd();
	const host = "opencode";
	const externalSessionId = (input) =>
		input?.sessionID ??
		input?.sessionId ??
		input?.session_id ??
		input?.session?.id ??
		null;
	return {
		"tool.execute.before": async (input, output) => {
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
					session_id: externalSessionId(input),
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
