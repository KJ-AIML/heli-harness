#!/usr/bin/env node

import assert from "node:assert/strict";
import {
	HELI_CAPABILITY_EFFECTIVE_STATES,
	HELI_CAPABILITY_NAMES,
	validateCapabilityMap,
} from "../lib/protocol/capabilities.mjs";

assert.deepEqual(HELI_CAPABILITY_NAMES, [
	"session_start",
	"pre_tool",
	"post_tool",
	"permission_request",
	"subagent_start",
	"subagent_stop",
	"compaction",
	"structured_tool_input",
	"sandbox_attestation",
	"worktree_isolation",
]);

assert.deepEqual(HELI_CAPABILITY_EFFECTIVE_STATES, [
	"unsupported",
	"documented",
	"wired",
	"observed",
	"enforced",
	"host-enforced",
]);

assert.deepEqual(
	validateCapabilityMap({
		session_start: { declared: true, observed: true, effective: "enforced" },
		sandbox_attestation: { declared: true, observed: false, effective: "host-enforced" },
	}),
	{ valid: true, errors: [] },
);

const unknownCapability = validateCapabilityMap({
	telepathy: { declared: true, observed: true, effective: "enforced" },
});
assert.equal(unknownCapability.valid, false);
assert.equal(unknownCapability.errors[0].code, "UNKNOWN_CAPABILITY");

const invalidState = validateCapabilityMap({
	pre_tool: { declared: true, observed: true, effective: "magic" },
});
assert.equal(invalidState.valid, false);
assert.equal(invalidState.errors[0].code, "INVALID_CAPABILITY_EFFECTIVE_STATE");

const invalidObserved = validateCapabilityMap({
	pre_tool: { declared: true, observed: "yes", effective: "observed" },
});
assert.equal(invalidObserved.valid, false);
assert.equal(invalidObserved.errors[0].code, "INVALID_CAPABILITY_OBSERVED_FLAG");

console.log("smoke-protocol-capabilities: ok");
