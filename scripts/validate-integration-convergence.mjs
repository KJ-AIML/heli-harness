#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const pkg = json("package.json");
const version = pkg.version;

function text(rel) {
	return readFileSync(join(root, rel), "utf8");
}

function json(rel) {
	return JSON.parse(text(rel));
}

function walk(dir) {
	if (!existsSync(dir)) return [];
	const result = [];
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) result.push(...walk(path));
		else result.push(path);
	}
	return result;
}

// Canonical architecture metadata must not contradict linked/global behavior.
const rootManifest = json("manifest.json");
const embeddedManifest = json(".heli-harness/manifest.json");
assert.equal(rootManifest.version, version);
assert.equal(rootManifest.install_mode, "global-linked");
assert.equal(rootManifest.source_of_truth, "docs/architecture/README.md");
assert.equal(rootManifest.project_binding, ".heli/");
assert.equal(rootManifest.compatibility_harness, ".heli-harness/");
assert.equal(embeddedManifest.version, version);
assert.equal(embeddedManifest.install_mode, "embedded-compatibility");
assert.equal(embeddedManifest.scope, "compatibility-only");
assert.equal(embeddedManifest.primary_topology, "global-linked");

// Release-train artifacts carrying their own top-level version must converge.
const versioned = [
	"manifest.json",
	".heli-harness/manifest.json",
	".heli-harness/adapters/adapters.json",
];
for (const path of walk(join(root, ".heli-harness", "adapters"))) {
	const name = basename(path);
	if (!["plugin.json", "package.json", "marketplace.json"].includes(name)) continue;
	const rel = relative(root, path).replaceAll("\\", "/");
	let value;
	try {
		value = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		continue;
	}
	if (typeof value.version === "string") versioned.push(rel);
}
for (const rel of [...new Set(versioned)]) {
	const value = json(rel);
	assert.equal(value.version, version, `${rel} version must match package.json (${version})`);
}

// Primary onboarding must not regress to project-local adapter paths.
for (const rel of ["INSTALL.md", "docs/INSTALL_MATRIX.md"]) {
	const value = text(rel);
	for (const forbidden of [
		"claude plugin install .heli-harness/adapters/claude-plugin",
		"node .heli-harness/adapters/grok-plugin/install-user-hooks.mjs",
		"node .heli-harness/adapters/kimi-plugin/install-user-hooks.mjs",
		"Use .heli-harness/adapters/cursor-plugin/",
	]) {
		assert.equal(value.includes(forbidden), false, `${rel} contains legacy default onboarding: ${forbidden}`);
	}
	assert.match(value, /heli host install/);
	assert.match(value, /heli host update/);
	assert.match(value, /heli host remove/);
}

// Pi modern install is project linking; local harness is explicitly legacy only.
const pi = text("extensions/pi-extension.js");
assert.match(pi, /registerCommand\("heli-install", \{ description: "Link current project to the globally installed Heli runtime"/);
assert.match(pi, /registerCommand\("heli-legacy-install"/);
assert.match(pi, /linkProject\(getPackageRoot\(\), cwd\)/);
assert.doesNotMatch(pi, /Install Heli-Harness workspace harness into current folder\?/);
assert.doesNotMatch(pi, /This will create \.heli-harness\/ and adapter pointer files/);

// Support claims must be dimensioned rather than hidden behind one aggregate status.
const matrix = text("docs/ADAPTER_SUPPORT_MATRIX.md");
for (const heading of [
	"Runtime integration",
	"Fresh install",
	"Global discovery",
	"Linked project",
	"Update / repair",
	"Remove",
	"Automated E2E",
	"Live-host proof",
	"Distribution current",
]) {
	assert.ok(matrix.includes(heading), `adapter support matrix missing lifecycle dimension: ${heading}`);
}

// Host manager must expose the full lifecycle and the generic/manual boundary.
const host = text("lib/cli/host.mjs");
for (const command of ['sub === "install"', 'sub === "update"', 'sub === "repair"', 'sub === "remove" || sub === "uninstall"']) {
	assert.ok(host.includes(command), `host manager missing lifecycle branch: ${command}`);
}
assert.match(host, /generic: \{ label: "Generic adapter"/);

console.log(`integration convergence validation ok (v${version})`);
