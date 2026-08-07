#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveNpmCheckInvocation } from "./lib/release-npm.mjs";

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

console.log("release npm invocation smoke ok");
