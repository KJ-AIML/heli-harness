#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateWorkflowProfiles, workflowProfile, defaultWorkflowFor } from "../lib/protocol/workflows.mjs";

const document = JSON.parse(readFileSync(join(process.cwd(), ".heli-harness", "workflows", "workflows.json"), "utf8"));
const validation = validateWorkflowProfiles(document);
assert.equal(validation.valid, true, validation.errors.join("\n"));
assert.ok(workflowProfile(document, "S1_FIX").required.includes("focused_verification"));
assert.equal(defaultWorkflowFor({ riskTier: "S1", intent: "fix" }), "S1_FIX");
assert.equal(defaultWorkflowFor({ riskTier: "S2", intent: "fix" }), "S2_INVESTIGATION");
assert.equal(defaultWorkflowFor({ riskTier: "S3", intent: "query" }), "S3_HIGH_RISK");
console.log("workflow profile smoke ok");
