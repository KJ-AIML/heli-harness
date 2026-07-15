import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function currentVersion(root) {
	return JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
}

export function assertCurrentVersion(root, actual, label) {
	assert.equal(actual, currentVersion(root), `${label} version must match package.json`);
}
