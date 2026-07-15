#!/usr/bin/env node

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const nextVersion = args.shift();
const push = args.includes("--push");
const summary = args.filter((arg) => arg !== "--push").join(" ") || "Release updates";
const semver = /^(\d+)\.(\d+)\.(\d+)$/;

function fail(message) {
	console.error(`release: ${message}`);
	process.exit(1);
}

function run(command, commandArgs) {
	const result = spawnSync(command, commandArgs, { cwd: root, encoding: "utf8", stdio: "inherit" });
	if (result.status !== 0) fail(`${command} ${commandArgs.join(" ")} failed`);
}

function git(...gitArgs) {
	return spawnSync("git", ["-C", root, ...gitArgs], { encoding: "utf8" });
}

function walk(dir) {
	const files = [];
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) files.push(...walk(path));
		else files.push(path);
	}
	return files;
}

if (!nextVersion || !semver.test(nextVersion)) fail("usage: npm run release -- <x.y.z> [summary] [--push]");

const packagePath = join(root, "package.json");
const current = JSON.parse(readFileSync(packagePath, "utf8")).version;
if (!semver.test(current)) fail(`current package version is invalid: ${current}`);
if (nextVersion === current) fail(`version is already ${current}`);
const newer = (a, b) => a.split(".").map(Number).some((value, index) => value > Number(b.split(".")[index]));
if (!newer(nextVersion, current)) fail(`new version ${nextVersion} must be greater than ${current}`);

const status = git("status", "--porcelain=v1").stdout;
const dirtyPaths = status.split("\n").filter(Boolean).map((line) => line.slice(3).trim().replaceAll("\\", "/"));
const allowed = [
	"package.json", "manifest.json", ".heli-harness/manifest.json", ".heli-harness/adapters/",
	"README.md", "ROADMAP.md", "INSTALL.md", "CHANGELOG.md", "docs/INSTALL_MATRIX.md", "docs/ADAPTER_SUPPORT_MATRIX.md",
	"scripts/smoke-claude-plugin.mjs", "scripts/smoke-codex-plugin.mjs", "scripts/smoke-cursor-plugin.mjs",
	"scripts/lib/release-version.mjs", "scripts/release.mjs",
];
const isAllowed = (path) => allowed.some((prefix) => path === prefix || path.startsWith(prefix));
const unrelated = dirtyPaths.filter((path) => !isAllowed(path));
if (unrelated.length) fail(`unrelated dirty paths: ${unrelated.join(", ")}`);

const versionFiles = [
	"package.json", "manifest.json", ".heli-harness/manifest.json", ".heli-harness/adapters/adapters.json",
	"README.md", "ROADMAP.md", "INSTALL.md", "docs/INSTALL_MATRIX.md", "docs/ADAPTER_SUPPORT_MATRIX.md",
	"scripts/smoke-claude-plugin.mjs", "scripts/smoke-codex-plugin.mjs", "scripts/smoke-cursor-plugin.mjs",
	...walk(join(root, ".heli-harness", "adapters")).filter((path) => path.endsWith("plugin.json") || path.endsWith("marketplace.json")).map((path) => relative(root, path)),
];
for (const relativePath of [...new Set(versionFiles)]) {
	const path = join(root, relativePath);
	writeFileSync(path, readFileSync(path, "utf8").replaceAll(current, nextVersion));
}

const changelog = join(root, "CHANGELOG.md");
const changelogText = readFileSync(changelog, "utf8");
writeFileSync(changelog, changelogText.replace(/^# Changelog\r?\n/, `# Changelog\n\n## v${nextVersion} - ${summary}\n\n### Changed\n\n- Release metadata and validation updated.\n`));

run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "check"]);
run("git", ["diff", "--check"]);

const stagePaths = [...new Set([...versionFiles, "CHANGELOG.md", "scripts/release.mjs", "scripts/lib/release-version.mjs"])];
run("git", ["add", "--", ...stagePaths]);
run("git", ["commit", "-m", `chore(release): v${nextVersion}`]);
run("git", ["tag", "-a", `v${nextVersion}`, "-m", `Release v${nextVersion}`]);
if (push) run("git", ["push", "origin", "main", `v${nextVersion}`]);

console.log(`release: created v${nextVersion}${push ? " and pushed it" : " (not pushed; pass --push to push)"}`);
