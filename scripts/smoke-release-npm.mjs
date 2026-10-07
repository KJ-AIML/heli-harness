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

// Release workflow must not publish merely because package.json or the workflow
// changed. Automatic publication requires an actual version change; manual
// workflow_dispatch remains an explicit release request.
{
	const workflow = readFileSync(join(root, ".github", "workflows", "release.yml"), "utf8").replace(/\r\n/g, "\n");
	assert.match(
		workflow,
		/grep -Fq "\[release-retry\]"/,
		"release.yml must allow an explicit release-retry commit marker when a version is not yet published",
	);
	assert.match(
		workflow,
		/\[ "\$\{version\}" != "\$\{previous_version\}" \]/,
		"release.yml must still request automatic publication on a package version change",
	);
	assert.match(workflow, /echo "release_requested=\$\{release_requested\}" >> "\$GITHUB_OUTPUT"/);
	for (const name of [
		"Resolve npm publication state",
		"Full release gate",
		"Pack release artifact",
		"Resolve npm staged state",
		"Publish or stage on npm",
		"Await staged npm approval",
		"Build release notes",
		"Create annotated tag and GitHub release",
	]) {
		const start = workflow.indexOf(`- name: ${name}`);
		assert.ok(start >= 0, `release.yml missing step: ${name}`);
		const next = workflow.indexOf("\n      - name:", start + 1);
		const step = workflow.slice(start, next >= 0 ? next : workflow.length);
		assert.match(
			step,
			/steps\.meta\.outputs\.release_requested == 'true'/,
			`${name} must be gated by release_requested`,
		);
	}
}

// Release workflow prefers npm Trusted Publishing (OIDC) and falls back to
// staged publishing when npm has no matching trusted-publisher authorization.
// The fallback uploads the exact packed artifact but never creates the Git tag
// until a maintainer has approved the stage with 2FA.
{
	const workflow = readFileSync(join(root, ".github", "workflows", "release.yml"), "utf8").replace(/\r\n/g, "\n");
	assert.match(workflow, /id-token:\s*write/, "release.yml must grant id-token: write for npm trusted publishing");
	assert.match(
		workflow,
		/npm install --global npm@\^11\.15\.0/,
		"release.yml must install an npm version with trusted/staged publishing support",
	);

	const stagedStart = workflow.indexOf("- name: Resolve npm staged state");
	const fullGate = workflow.indexOf("- name: Full release gate");
	assert.ok(stagedStart > 0 && fullGate > stagedStart, "release.yml must detect an already-staged version before retrying");
	const stagedStep = workflow.slice(stagedStart, fullGate);
	assert.match(stagedStep, /npm stage list heli-harness --json/);
	assert.match(stagedStep, /NODE_AUTH_TOKEN="\$NPM_STAGE_TOKEN"/);

	const start = workflow.indexOf("- name: Publish or stage on npm");
	const awaitStart = workflow.indexOf("- name: Await staged npm approval");
	assert.ok(start > 0 && awaitStart > start, "release.yml must keep publish/stage before the approval fence");
	const publishStep = workflow.slice(start, awaitStart);
	assert.match(publishStep, /npm publish "\$PACKAGE_FILE" --access public --provenance/);
	assert.match(publishStep, /grep -Eq 'EOTP\|E_STAGE_REQUIRED\|E404'/);
	assert.match(publishStep, /NODE_AUTH_TOKEN="\$NPM_STAGE_TOKEN" npm stage publish "\$PACKAGE_FILE" --access public/);
	assert.doesNotMatch(
		publishStep,
		/env:\s*\n(?:\s+[^\n]+\n)*\s+NODE_AUTH_TOKEN:/,
		"OIDC direct publish must not receive NODE_AUTH_TOKEN globally",
	);

	const notesStart = workflow.indexOf("- name: Build release notes");
	const awaitStep = workflow.slice(awaitStart, notesStart);
	assert.match(awaitStep, /awaiting maintainer 2FA approval/);
	assert.match(awaitStep, /exit 1/, "staged release must stop before Git tagging");

	const tagStart = workflow.indexOf("- name: Create annotated tag and GitHub release");
	const notesStep = workflow.slice(notesStart, tagStart);
	assert.match(notesStep, /steps\.npm_meta\.outputs\.exists == 'true' \|\| steps\.npm_publish\.outputs\.status == 'published'/);
	const tagStep = workflow.slice(tagStart);
	assert.match(tagStep, /steps\.npm_meta\.outputs\.exists == 'true' \|\| steps\.npm_publish\.outputs\.status == 'published'/);
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
