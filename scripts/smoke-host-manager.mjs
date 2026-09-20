#!/usr/bin/env node
import assert from "node:assert/strict";
import { planHostInstall, inspectHosts } from "../lib/cli/host.mjs";

const root = process.cwd();
for (const id of ["codex", "pi", "claude", "grok", "opencode", "kimi", "cursor", "axga"]) {
	const plan = planHostInstall(root, id);
	assert.ok(Array.isArray(plan) && plan.length > 0, `${id} must have an automatic install plan`);
}
assert.deepEqual(planHostInstall(root, "codex")[0].slice(0, 4), ["codex", "plugin", "marketplace", "add"]);
assert.match(planHostInstall(root, "pi")[0][2], /heli-harness@v0\.10\./);
assert.match(planHostInstall(root, "claude")[0].join(" "), /claude-plugin/);
assert.match(planHostInstall(root, "grok")[0].join(" "), /install-user-hooks\.mjs/);
assert.match(planHostInstall(root, "kimi")[0].join(" "), /install-user-hooks\.mjs/);
assert.match(planHostInstall(root, "opencode")[0].join(" "), /opencode-plugin/);
assert.match(planHostInstall(root, "cursor")[0].join(" "), /cursor-plugin/);

const hosts = inspectHosts(root);
for (const id of ["codex", "pi", "claude", "grok", "opencode", "kimi", "cursor", "axga", "antigravity"]) {
	assert.ok(hosts.some((item) => item.id === id), `host inventory missing ${id}`);
}
assert.equal(hosts.find((item) => item.id === "antigravity").automatic, false);
console.log("host manager smoke ok");
