#!/usr/bin/env node
import assert from "node:assert/strict";
import { join } from "node:path";
import {
	planHostInstall,
	planHostRemove,
	inspectHosts,
} from "../lib/cli/host.mjs";

const root = process.cwd();
const env = {
	...process.env,
	HELI_ANTIGRAVITY_PLUGIN_DIR: join(root, ".test-antigravity-plugins"),
};

for (const id of ["codex", "pi", "claude", "grok", "opencode", "kimi", "cursor", "axga", "antigravity"]) {
	const installPlan = planHostInstall(root, id, { env });
	assert.ok(Array.isArray(installPlan) && installPlan.length > 0, `${id} must have a managed install plan`);
	const removePlan = planHostRemove(root, id, { env });
	assert.ok(Array.isArray(removePlan) && removePlan.length > 0, `${id} must have a managed remove plan`);
}

assert.deepEqual(planHostInstall(root, "codex", { env })[0].slice(0, 4), ["codex", "plugin", "marketplace", "add"]);
assert.match(planHostInstall(root, "pi", { env })[0][2], /heli-harness@v0\.10\./);
assert.match(planHostInstall(root, "claude", { env })[0].join(" "), /claude-plugin/);
assert.match(planHostInstall(root, "grok", { env })[0].join(" "), /install-user-hooks\.mjs/);
assert.match(planHostInstall(root, "kimi", { env })[0].join(" "), /install-user-hooks\.mjs/);
assert.equal(planHostInstall(root, "opencode", { env })[0][0], "opencode-install");
assert.equal(planHostInstall(root, "cursor", { env })[0][0], "copy-dir");
assert.match(planHostInstall(root, "antigravity", { env })[0][2], /heli-harness$/);

assert.deepEqual(planHostInstall(root, "generic", { env }), []);
assert.deepEqual(planHostRemove(root, "generic", { env }), []);

const hosts = inspectHosts(root, { env });
for (const id of ["codex", "pi", "claude", "grok", "opencode", "kimi", "cursor", "axga", "antigravity", "generic"]) {
	assert.ok(hosts.some((item) => item.id === id), `host inventory missing ${id}`);
}
assert.equal(hosts.find((item) => item.id === "antigravity").automatic, "conditional");
assert.equal(hosts.find((item) => item.id === "generic").lifecycleState, "manual");

console.log("host manager smoke ok");
