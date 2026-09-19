#!/usr/bin/env node

import assert from "node:assert/strict";
import {
	HELI_DECISION_CODES,
	makeDecision,
	withStructuredDecision,
} from "../lib/protocol/decision.mjs";

assert.ok(HELI_DECISION_CODES.includes("NO_SESSION"));
assert.ok(HELI_DECISION_CODES.includes("NO_LEASE"));
assert.ok(HELI_DECISION_CODES.includes("TIER_APPROVAL_REQUIRED"));

const deny = withStructuredDecision(
	{
		deny: true,
		code: "NO_LEASE",
		reason: "claim write first",
		ctx: { taskId: "task-a", sessionId: "hs-a" },
	},
	{ rule: "ownership", source: "ownership_gate" },
);
assert.equal(deny.deny, true);
assert.equal(deny.reason, "claim write first");
assert.equal(deny.code, "NO_LEASE");
assert.deepEqual(deny.decision, {
	decisionSchemaVersion: 1,
	decisionId: null,
	code: "NO_LEASE",
	effect: "deny",
	rule: "ownership",
	source: "ownership_gate",
	host: null,
	taskId: "task-a",
	sessionId: "hs-a",
	toolName: null,
	reason: "claim write first",
	coverage: null,
	at: null,
});

const allow = withStructuredDecision({ deny: false, ctx: {} }, { source: "pre_tool" });
assert.equal(allow.decision.code, "ALLOW");
assert.equal(allow.decision.effect, "allow");

const unknownFutureCode = makeDecision({
	code: "FUTURE_HOST_CODE",
	effect: "reroute",
	source: "future-host",
});
assert.equal(unknownFutureCode.code, "FUTURE_HOST_CODE", "protocol must remain forward-compatible");

assert.throws(
	() => makeDecision({ code: "", effect: "deny" }),
	(error) => error?.code === "INVALID_DECISION_CODE",
);
assert.throws(
	() => makeDecision({ code: "NO_LEASE", effect: "maybe" }),
	(error) => error?.code === "INVALID_DECISION_EFFECT",
);

console.log("smoke-protocol-decisions: ok");
