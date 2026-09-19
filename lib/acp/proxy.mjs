import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { evaluatePreToolUse } from "../../.heli-harness/adapters/shared/hook-core.mjs";
import { resolveExecutionContext } from "../../.heli-harness/adapters/shared/concurrency/resolve.mjs";
import { observeRuntimeCapability } from "../../.heli-harness/adapters/shared/concurrency/attestation.mjs";
import { recordGuardDecision } from "../../.heli-harness/adapters/shared/concurrency/governance-decision.mjs";

const SESSION_METHODS = new Set(["session/new", "session/load", "session/prompt"]);

function requestKey(id) {
	return `${typeof id}:${String(id)}`;
}

function object(value) {
	return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function toolNameForKind(kind) {
	switch (String(kind || "").toLowerCase()) {
		case "edit":
		case "delete":
		case "move":
			return "edit";
		case "execute":
			return "bash";
		case "read":
			return "read";
		case "search":
			return "search";
		case "fetch":
			return "fetch";
		default:
			return String(kind || "acp-tool");
	}
}

export function acpToolInput(toolCall = {}) {
	const raw = toolCall?.rawInput;
	const input = object(raw);
	const locations = Array.isArray(toolCall?.locations) ? toolCall.locations : [];
	const firstPath = locations.map((location) => location?.path).find((path) => typeof path === "string" && path);
	const normalized = { ...input };
	if (firstPath && normalized.path == null && normalized.file_path == null && normalized.filePath == null) {
		normalized.path = firstPath;
		normalized.file_path = firstPath;
	}
	if (typeof raw === "string") {
		if (String(toolCall?.kind || "").toLowerCase() === "execute") normalized.command = raw;
		else normalized.description = raw;
	}
	return normalized;
}

function rejectionOutcome(options = []) {
	const reject = options.find((option) => /^(reject|deny)/i.test(String(option?.kind || "")));
	if (reject?.optionId) return { outcome: "selected", optionId: reject.optionId };
	return { outcome: "cancelled" };
}

function observe(ctx, capability, details = null) {
	if (!ctx?.workspaceRoot || !ctx?.sessionId) return;
	observeRuntimeCapability(ctx.workspaceRoot, ctx.sessionId, {
		host: "acp",
		capability,
		source: "acp-v1-proxy",
		details,
	});
}

export function registerAcpSession({ cwd = process.cwd(), sessionId, env = process.env } = {}) {
	if (!sessionId) return null;
	const ctx = resolveExecutionContext({
		cwd,
		environment: env,
		hookPayload: { sessionId },
		host: "acp",
		createIfMissing: true,
	});
	observe(ctx, "session_start", { acpSessionId: sessionId, protocolVersion: 1 });
	return ctx;
}

/**
 * Evaluate a stable ACP v1 session/request_permission request through Heli's
 * existing deterministic PreToolUse guard. Missing rawInput is never guessed;
 * available kind/location metadata is still used for ownership/path checks.
 */
export function evaluateAcpPermission({ cwd = process.cwd(), params = {}, env = process.env } = {}) {
	const toolCall = object(params.toolCall);
	const toolInput = acpToolInput(toolCall);
	const toolName = toolNameForKind(toolCall.kind);
	const result = evaluatePreToolUse({
		cwd,
		toolName,
		toolInput,
		host: "acp",
		hookPayload: {
			sessionId: params.sessionId,
			tool_name: toolName,
			tool_input: toolInput,
		},
		env,
	});
	observe(result.ctx, "permission_request", { acpSessionId: params.sessionId || null, toolCallId: toolCall.toolCallId || null });
	if (toolCall.rawInput != null) observe(result.ctx, "structured_tool_input", { acpSessionId: params.sessionId || null, toolCallId: toolCall.toolCallId || null });
	const decision = recordGuardDecision(result, { host: "acp", toolName, source: "session/request_permission" });
	return {
		deny: !!result.deny,
		reason: result.reason || null,
		decision,
		ctx: result.ctx,
		outcome: result.deny ? rejectionOutcome(Array.isArray(params.options) ? params.options : []) : null,
	};
}

function parseFrame(line, side) {
	let message;
	try {
		message = JSON.parse(line);
	} catch (error) {
		const wrapped = new Error(`ACP ${side} emitted invalid JSON: ${error.message}`);
		wrapped.code = "ACP_INVALID_JSON";
		throw wrapped;
	}
	if (!message || typeof message !== "object" || message.jsonrpc !== "2.0") {
		const error = new Error(`ACP ${side} frame must be a JSON-RPC 2.0 object`);
		error.code = "ACP_INVALID_FRAME";
		throw error;
	}
	return message;
}

/**
 * Experimental stable-v1 NDJSON governance proxy.
 * Client stdin/stdout remain ACP wire channels; all Heli diagnostics go stderr.
 */
export function runAcpGovernanceProxy({
	command,
	args = [],
	cwd = process.cwd(),
	env = process.env,
	stdin = process.stdin,
	stdout = process.stdout,
	stderr = process.stderr,
} = {}) {
	if (!command) throw new Error("ACP proxy requires an agent command");
	const child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
	const pending = new Map();
	let failed = false;

	function fail(error) {
		if (failed) return;
		failed = true;
		stderr.write(`[heli-acp] ${error.code || "ACP_PROXY_ERROR"}: ${error.message}\n`);
		try { child.kill(); } catch { /* ignore */ }
	}

	child.stderr.on("data", (chunk) => stderr.write(chunk));
	child.on("error", fail);

	const clientLines = createInterface({ input: stdin, crlfDelay: Infinity });
	clientLines.on("line", (line) => {
		if (failed || !line.trim()) return;
		try {
			const message = parseFrame(line, "client");
			if (message.method && Object.prototype.hasOwnProperty.call(message, "id")) {
				pending.set(requestKey(message.id), { method: message.method, params: object(message.params) });
			}
			if (SESSION_METHODS.has(message.method) && message.params?.sessionId) {
				registerAcpSession({ cwd, sessionId: message.params.sessionId, env });
			}
			child.stdin.write(`${JSON.stringify(message)}\n`);
		} catch (error) {
			fail(error);
		}
	});
	clientLines.on("close", () => {
		if (!child.stdin.destroyed) child.stdin.end();
	});

	const agentLines = createInterface({ input: child.stdout, crlfDelay: Infinity });
	agentLines.on("line", (line) => {
		if (failed || !line.trim()) return;
		try {
			const message = parseFrame(line, "agent");
			if (message.method === "session/request_permission" && Object.prototype.hasOwnProperty.call(message, "id")) {
				const verdict = evaluateAcpPermission({ cwd, params: object(message.params), env });
				if (verdict.deny) {
					child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { outcome: verdict.outcome } })}\n`);
					stderr.write(`[heli-acp] denied permission request ${message.params?.toolCall?.toolCallId || message.id}: ${verdict.reason || verdict.decision?.code || "governance denied"}\n`);
					return;
				}
			}
			if (Object.prototype.hasOwnProperty.call(message, "id") && (message.result != null || message.error != null)) {
				const request = pending.get(requestKey(message.id));
				if (request) {
					pending.delete(requestKey(message.id));
					if (request.method === "session/new" && message.result?.sessionId) {
						registerAcpSession({ cwd, sessionId: message.result.sessionId, env });
					}
				}
			}
			stdout.write(`${JSON.stringify(message)}\n`);
		} catch (error) {
			fail(error);
		}
	});

	return new Promise((resolve) => {
		child.on("close", (code, signal) => {
			clientLines.close();
			agentLines.close();
			resolve({ code: failed ? 2 : (code ?? 1), signal: signal || null });
		});
	});
}
