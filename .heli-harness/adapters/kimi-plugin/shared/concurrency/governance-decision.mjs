import { appendTaskEvent } from "./events.mjs";
import { newDecisionId } from "./ids.mjs";

export const GOVERNANCE_DECISION_SCHEMA_VERSION = 1;
export const GOVERNANCE_DECISION_EFFECTS = Object.freeze([
	"allow",
	"deny",
	"require-approval",
	"reroute",
]);

const EFFECTS = new Set(GOVERNANCE_DECISION_EFFECTS);

export function makeGovernanceDecision({
	decisionId = null,
	code,
	effect,
	rule = null,
	source = null,
	host = null,
	taskId = null,
	sessionId = null,
	toolName = null,
	reason = null,
	coverage = null,
	at = null,
	details = null,
} = {}) {
	if (typeof code !== "string" || !code.trim()) {
		const error = new Error("decision code must be a non-empty string");
		error.code = "INVALID_DECISION_CODE";
		throw error;
	}
	if (!EFFECTS.has(effect)) {
		const error = new Error(`invalid decision effect: ${effect}`);
		error.code = "INVALID_DECISION_EFFECT";
		throw error;
	}
	const decision = {
		decisionSchemaVersion: GOVERNANCE_DECISION_SCHEMA_VERSION,
		decisionId: decisionId || null,
		code: code.trim(),
		effect,
		rule: rule || null,
		source: source || null,
		host: host || null,
		taskId: taskId || null,
		sessionId: sessionId || null,
		toolName: toolName || null,
		reason: reason || null,
		coverage: coverage || null,
		at: at || null,
	};
	if (details != null) decision.details = details;
	return decision;
}

export function structuredGuardDecision(result, {
	host = "unknown",
	toolName = null,
	source = "pre_tool",
	at = new Date().toISOString(),
} = {}) {
	const legacy = result && typeof result === "object" ? result : {};
	return makeGovernanceDecision({
		decisionId: newDecisionId(),
		code: legacy.code || (legacy.deny ? "GOVERNANCE_DENIED" : "ALLOW"),
		effect: legacy.deny ? "deny" : "allow",
		rule: legacy.code || null,
		source,
		host,
		taskId: legacy.ctx?.taskId || null,
		sessionId: legacy.ctx?.sessionId || null,
		toolName: toolName || null,
		reason: legacy.reason || null,
		coverage: legacy.coverage || null,
		at,
		details: {
			bootstrap: Boolean(legacy.bootstrap),
			renewalRequired: Boolean(legacy.renewalRequired),
		},
	});
}

/**
 * Denials are durable receipts. Allows are returned to callers but are not
 * appended by default, so task trace completeness remains explicitly partial.
 */
export function recordGuardDecision(result, options = {}) {
	const decision = structuredGuardDecision(result, options);
	if (result && typeof result === "object") result.decision = decision;
	if (decision.effect !== "deny" || !result?.ctx?.workspaceRoot || !decision.taskId) return decision;
	appendTaskEvent(result.ctx.workspaceRoot, decision.taskId, "guard.decision", {
		sessionId: decision.sessionId,
		decision,
	});
	return decision;
}
