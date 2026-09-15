import { appendTaskEvent } from "./events.mjs";

export function structuredGuardDecision(result, {
	host = "unknown",
	toolName = null,
	source = "pre_tool",
} = {}) {
	const legacy = result && typeof result === "object" ? result : {};
	return {
		code: legacy.code || (legacy.deny ? "GOVERNANCE_DENIED" : "ALLOW"),
		effect: legacy.deny ? "deny" : "allow",
		rule: legacy.code || null,
		source,
		host,
		taskId: legacy.ctx?.taskId || null,
		sessionId: legacy.ctx?.sessionId || null,
		toolName: toolName || null,
		reason: legacy.reason || null,
	};
}

/**
 * Denials are durable evidence. Allows are returned to callers but are not
 * appended by default to avoid turning the task log into tool-call telemetry.
 */
export function recordGuardDecision(result, options = {}) {
	const decision = structuredGuardDecision(result, options);
	if (result && typeof result === "object") result.decision = decision;
	if (decision.effect !== "deny" || !result?.ctx?.workspaceRoot || !decision.taskId) return decision;
	appendTaskEvent(result.ctx.workspaceRoot, decision.taskId, "guard.decision", {
		sessionId: decision.sessionId,
		decision: {
			code: decision.code,
			effect: decision.effect,
			rule: decision.rule,
			source: decision.source,
			host: decision.host,
			toolName: decision.toolName,
			reason: decision.reason,
		},
	});
	return decision;
}
