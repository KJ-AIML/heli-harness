import heliHarnessExtension from "./pi-extension.js";
import {
	appendTaskEvent,
	observeRuntimeCapability,
	resolveExecutionContext,
} from "../.heli-harness/adapters/shared/concurrency/index.mjs";

function resolvePiContext(event, { createIfMissing = false } = {}) {
	try {
		return resolveExecutionContext({
			cwd: process.cwd(),
			host: "pi",
			hookPayload: event || {},
			createIfMissing,
			refreshLeaseOnResolve: false,
		});
	} catch {
		return null;
	}
}

function observePiCapability(ctx, capability, details = null) {
	if (!ctx?.workspaceRoot || !ctx?.sessionId) return;
	try {
		observeRuntimeCapability(ctx.workspaceRoot, ctx.sessionId, {
			host: "pi",
			capability,
			source: "pi-host-hook",
			details,
		});
	} catch {
		// Runtime evidence is best-effort and must never change host behavior.
	}
}

function recordPiDenial(ctx, event, result) {
	if (!result?.block || !ctx?.workspaceRoot || !ctx?.taskId) return;
	try {
		appendTaskEvent(ctx.workspaceRoot, ctx.taskId, "guard.decision", {
			sessionId: ctx.sessionId || null,
			decision: {
				code: "PI_GUARD_BLOCKED",
				effect: "deny",
				rule: null,
				source: "pre_tool",
				host: "pi",
				toolName: event?.toolName || null,
				reason: result.reason || null,
			},
		});
	} catch {
		// Evidence persistence cannot weaken or replace the original Pi decision.
	}
}

function governedPi(pi) {
	return new Proxy(pi, {
		get(target, property, receiver) {
			if (property !== "on") {
				const value = Reflect.get(target, property, receiver);
				return typeof value === "function" ? value.bind(target) : value;
			}

			return (name, handler) => target.on(name, async (...args) => {
				const event = args[0] || {};

				if (name === "session_start") {
					const result = await handler(...args);
					const ctx = resolvePiContext(event, { createIfMissing: true });
					observePiCapability(ctx, "session_start", {
						externalHostSessionId: event?.sessionId || event?.session_id || null,
					});
					return result;
				}

				if (name === "tool_call") {
					const ctx = resolvePiContext(event, { createIfMissing: false });
					observePiCapability(ctx, "pre_tool", { toolName: event?.toolName || null });
					if (event?.input && typeof event.input === "object" && !Array.isArray(event.input)) {
						observePiCapability(ctx, "structured_tool_input", { toolName: event?.toolName || null });
					}
					const result = await handler(...args);
					recordPiDenial(ctx, event, result);
					return result;
				}

				return handler(...args);
			});
		},
	});
}

/**
 * Pi package entrypoint with runtime evidence. The legacy extension remains the
 * single implementation of commands and guards; this wrapper only observes
 * live host hooks and persists evidence without changing their return values.
 */
export default function heliHarnessGovernedExtension(pi) {
	return heliHarnessExtension(governedPi(pi));
}
