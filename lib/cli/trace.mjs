import { existsSync, readFileSync } from "node:fs";
import { findWorkspaceRoot, taskPaths } from "../concurrency/paths.mjs";
import { resolveExecutionContext } from "../concurrency/resolve.mjs";
import { parseEventJsonl } from "../protocol/events.mjs";
import { protocolOk, protocolError } from "../protocol/result.mjs";
import { wantsJson, stripOutputFlags, printProtocolResult } from "./output.mjs";

function parseArgs(args) {
	const json = wantsJson(args);
	const clean = stripOutputFlags(args);
	const sub = clean[0] || "show";
	let taskId = null;
	const positional = [];
	for (let i = 1; i < clean.length; i += 1) {
		if (clean[i] === "--task" && clean[i + 1]) taskId = clean[++i];
		else if (!clean[i].startsWith("--")) positional.push(clean[i]);
	}
	return { json, sub, taskId, cwd: positional[0] || process.cwd() };
}

export function runTrace(args = []) {
	const { json, sub, taskId: explicitTaskId, cwd } = parseArgs(args);
	if (sub !== "show") {
		const result = protocolError("trace", "UNKNOWN_TRACE_COMMAND", `Unknown trace command: ${sub}`);
		if (json) printProtocolResult(result);
		else console.log(result.errors[0].message);
		process.exitCode = 1;
		return result;
	}
	const workspaceRoot = findWorkspaceRoot(cwd);
	if (!workspaceRoot) {
		const result = protocolError("trace.show", "WORKSPACE_NOT_FOUND", `No Heli workspace found from ${cwd}`);
		if (json) printProtocolResult(result);
		else console.log(result.errors[0].message);
		process.exitCode = 1;
		return result;
	}
	const ctx = resolveExecutionContext({ cwd, host: "cli", createIfMissing: false, refreshLeaseOnResolve: false });
	const taskId = explicitTaskId || ctx.taskId || null;
	if (!taskId) {
		const result = protocolError("trace.show", "TASK_REQUIRED", "No task is bound; pass --task <id>");
		if (json) printProtocolResult(result);
		else console.log(result.errors[0].message);
		process.exitCode = 1;
		return result;
	}
	const path = taskPaths(workspaceRoot, taskId).eventsJsonl;
	const parsed = existsSync(path) ? parseEventJsonl(readFileSync(path, "utf8")) : { events: [], warnings: [] };
	const data = { workspaceRoot, taskId, eventPath: path, events: parsed.events };
	const result = protocolOk("trace.show", data, { warnings: parsed.warnings });
	if (json) printProtocolResult(result);
	else if (!parsed.events.length) console.log(`No events for task ${taskId}.`);
	else {
		for (const event of parsed.events) {
			const session = event.sessionId ? ` session=${event.sessionId}` : "";
			console.log(`${event.at || "?"} ${event.type || "event"}${session}`);
		}
	}
	return result;
}
