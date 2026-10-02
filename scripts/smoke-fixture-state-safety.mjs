#!/usr/bin/env node
import assert from "node:assert/strict";
import { runFixtureStateSafetyRegression } from "./lib/fixture-state-safety.mjs";

assert.equal(runFixtureStateSafetyRegression(), true);
console.log("fixture state safety smoke ok");
