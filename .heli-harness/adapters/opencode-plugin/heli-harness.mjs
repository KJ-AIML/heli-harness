/**
 * OpenCode local plugin for Heli-Harness.
 * Uses shared hook-core evaluatePreToolUse / buildSessionContext.
 *
 * Copy to: .opencode/plugins/heli-harness.mjs
 * (prefer loading from .heli-harness/adapters/opencode-plugin when possible)
 */

import { evaluatePreToolUse, buildSessionContext } from "./shared/hook-core.mjs";

export const HeliHarness = async (ctx) => {
	const directory = ctx?.directory || process.cwd();
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
				host: "opencode",
				hookPayload: { tool_name: tool, tool_input: toolInput },
			});
			if (result.deny) throw new Error(result.reason);
		},
		"experimental.session.compacting": async (_input, output) => {
			if (output && Array.isArray(output.context)) {
				output.context.push(buildSessionContext(directory, { host: "opencode" }));
			}
		},
	};
};

export default HeliHarness;
export const heliHarness = HeliHarness;
