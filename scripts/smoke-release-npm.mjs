#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveNpmCheckInvocation } from "./lib/release-npm.mjs";
import { currentVersion, releaseVersionFiles } from "./lib/release-version.mjs";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const NODE = "/usr/bin/node";
const NODE_WIN = "C:\\Program Files\\nodejs\\node.exe";

// npm_execpath pointing at npm's JS entry — run it with the running node binary,
// never spawn npm.cmd (EINVAL under CVE-2024-27980 hardening).
{
	const posixEntry = "/usr/lib/node_modules/npm/bin/npm-cli.js";
	assert.deepEqual(
		resolveNpmCheckInvocation({ npmExecpath: posixEntry, platform: "linux", execPath: NODE }),
		{ command: NODE, args: [posixEntry, "run", "check"] },
		"posix npm-cli.js must run via execPath",
	);
	assert.deepEqual(
		resolveNpmCheckInvocation({ npmExecpath: posixEntry, platform: "win32", execPath: NODE_WIN }),
		{ command: NODE_WIN, args: [posixEntry, "run", "check"] },
		"npm-cli.js wins over platform on win32",
	);
}

{
	const winEntry = "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js";
	assert.deepEqual(
		resolveNpmCheckInvocation({ npmExecpath: winEntry, platform: "win32", execPath: NODE_WIN }),
		{ command: NODE_WIN, args: [winEntry, "run", "check"] },
		"windows-separator npm-cli.js must run via execPath",
	);
}

// npm_execpath pointing at a native launcher — cannot be fed to node; fall back
// to the platform npm name.
{
	assert.deepEqual(
		resolveNpmCheckInvocation({ npmExecpath: "C:\\Program Files\\nodejs\\npm.cmd", platform: "win32", execPath: NODE_WIN }),
		{ command: "npm.cmd", args: ["run", "check"] },
		".cmd execpath falls back to npm.cmd on win32",
	);
	assert.deepEqual(
		resolveNpmCheckInvocation({ npmExecpath: "/opt/weird/npm.cmd", platform: "linux", execPath: NODE }),
		{ command: "npm", args: ["run", "check"] },
		".cmd execpath falls back to npm on linux",
	);
	assert.deepEqual(
		resolveNpmCheckInvocation({ npmExecpath: "C:\\tools\\npm.exe", platform: "win32", execPath: NODE_WIN }),
		{ command: "npm.cmd", args: ["run", "check"] },
		".exe execpath falls back to npm.cmd on win32",
	);
	assert.deepEqual(
		resolveNpmCheckInvocation({ npmExecpath: "/opt/tools/npm.exe", platform: "linux", execPath: NODE }),
		{ command: "npm", args: ["run", "check"] },
		".exe execpath falls back to npm on linux",
	);
}

// npm_execpath unset/empty — release invoked outside `npm run`.
for (const npmExecpath of [undefined, ""]) {
	assert.deepEqual(
		resolveNpmCheckInvocation({ npmExecpath, platform: "win32", execPath: NODE_WIN }),
		{ command: "npm.cmd", args: ["run", "check"] },
		`npm_execpath=${JSON.stringify(npmExecpath)} falls back to npm.cmd on win32`,
	);
	assert.deepEqual(
		resolveNpmCheckInvocation({ npmExecpath, platform: "linux", execPath: NODE }),
		{ command: "npm", args: ["run", "check"] },
		`npm_execpath=${JSON.stringify(npmExecpath)} falls back to npm on linux`,
	);
	assert.deepEqual(
		resolveNpmCheckInvocation({ npmExecpath, platform: "darwin", execPath: NODE }),
		{ command: "npm", args: ["run", "check"] },
		`npm_execpath=${JSON.stringify(npmExecpath)} falls back to npm on darwin`,
	);
}

// The helper must stay pure: same inputs, fresh (non-shared) args array.
{
	const a = resolveNpmCheckInvocation({ npmExecpath: undefined, platform: "linux", execPath: NODE });
	const b = resolveNpmCheckInvocation({ npmExecpath: undefined, platform: "linux", execPath: NODE });
	assert.notEqual(a.args, b.args, "args array must not be shared between calls");
	a.args.push("mutated");
	assert.deepEqual(b.args, ["run", "check"], "mutating one result must not affect another");
}

// Wiring guard: release.mjs must actually use the helper, so the unit test above
// cannot silently drift away from real release behaviour.
{
	const releaseText = readFileSync(join(root, "scripts", "release.mjs"), "utf8");
	assert.match(
		releaseText,
		/import\s*\{\s*resolveNpmCheckInvocation\s*\}\s*from\s*["']\.\/lib\/release-npm\.mjs["']/,
		"release.mjs must import resolveNpmCheckInvocation from ./lib/release-npm.mjs",
	);
	assert.match(releaseText, /resolveNpmCheckInvocation\(\s*\{/, "release.mjs must call resolveNpmCheckInvocation");
	assert.doesNotMatch(
		releaseText,
		/npmEntry\.endsWith\(/,
		"release.mjs must not re-implement the npm_execpath decision inline",
	);
	assert.match(
		releaseText,
		/"scripts\/lib\/release-npm\.mjs"/,
		"release.mjs must stage scripts/lib/release-npm.mjs",
	);
}

// Release workflow: a missing NPM_TOKEN must fail the run loudly, never skip
// publication while still reporting success (0.10.x never reached npm that way).
{
	const workflow = readFileSync(join(root, ".github", "workflows", "release.yml"), "utf8").replace(/\r\n/g, "\n");
	const start = workflow.indexOf("- name: Publish to npm");
	const end = workflow.indexOf("- name: Build release notes");
	assert.ok(start > 0 && end > start, "release.yml must keep a 'Publish to npm' step before 'Build release notes'");
	const publishStep = workflow.slice(start, end);
	assert.match(publishStep, /if \[ -z "\$\{NODE_AUTH_TOKEN:-\}" \]; then\n\s*echo "::error::[^\n]*"\n\s*exit 1/, "missing NPM_TOKEN must exit 1 with an ::error:: annotation");
	assert.doesNotMatch(publishStep, /exit 0|skipped-no-token|::warning::/, "missing NPM_TOKEN must not be treated as success");
}

// Every tracked file that names the current version is rewritten by the release
// script, except history and fixtures that pin a version on purpose.
{
	const version = currentVersion(root);
	const grep = spawnSync("git", ["grep", "-l", "--fixed-strings", version], { cwd: root, encoding: "utf8" });
	if (grep.status === 0 || grep.status === 1) {
		const listed = new Set(releaseVersionFiles(root));
		const intentional = (path) =>
			path === "CHANGELOG.md" ||
			path.startsWith("docs/reports/") ||
			path.startsWith("docs/superpowers/plans/") ||
			path === "scripts/smoke-host-manager.mjs";
		const missing = grep.stdout.split(/\r?\n/).filter(Boolean).filter((path) => !intentional(path) && !listed.has(path));
		assert.deepEqual(missing, [], `scripts/release.mjs would leave ${version} behind in: ${missing.join(", ")}`);
	}
	const releaseText = readFileSync(join(root, "scripts", "release.mjs"), "utf8");
	assert.match(releaseText, /releaseVersionFiles\(root\)/, "release.mjs must use the shared version-file list");
	assert.match(releaseText, /--prepare-only/, "release.mjs must support --prepare-only");
}

console.log("release npm invocation smoke ok");
