import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export function currentVersion(root) {
	return JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
}

export function assertCurrentVersion(root, actual, label) {
	assert.equal(actual, currentVersion(root), `${label} version must match package.json`);
}

// Current-facing files that embed the release version. scripts/smoke-release-npm.mjs
// fails when a tracked file names the current version but is missing here.
const CURRENT_FACING_VERSION_FILES = Object.freeze([
	"package.json", "manifest.json", ".heli-harness/manifest.json", ".heli-harness/adapters/adapters.json",
	"README.md", "ROADMAP.md", "INSTALL.md", "docs/INSTALL_MATRIX.md", "docs/ADAPTER_SUPPORT_MATRIX.md",
	".heli-harness/README.md", ".heli-harness/INSTALL.md", ".heli-harness/HARNESS.md",
	".heli-harness/state/README.md", ".heli-harness/workspace/README.md",
	".heli-harness/safety/command-tiers.md", ".heli-harness/safety/secrets.md",
	".heli-harness/skills/heli-install/SKILL.md",
	".heli-harness/adapters/pi/README.md",
	".heli-harness/adapters/kimi/KIMI.md", ".heli-harness/adapters/grok/GROK.md",
	".heli-harness/adapters/claude/CLAUDE.md", ".heli-harness/adapters/codex/AGENTS.md",
	".heli-harness/adapters/opencode/OPENCODE.md", ".heli-harness/adapters/antigravity/ANTIGRAVITY.md",
	"docs/architecture/README.md", "docs/architecture/governance-model.md",
	"docs/ENFORCEMENT_MATRIX.md", "docs/superpowers/specs/2026-09-18-heli-v1-architecture-convergence.md",
	"scripts/smoke-claude-plugin.mjs", "scripts/smoke-codex-plugin.mjs", "scripts/smoke-cursor-plugin.mjs",
]);

function walk(dir) {
	const files = [];
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) files.push(...walk(path));
		else files.push(path);
	}
	return files;
}

/** Every file whose embedded current version `scripts/release.mjs` rewrites. */
export function releaseVersionFiles(root) {
	const adapterFiles = walk(join(root, ".heli-harness", "adapters"))
		.map((path) => relative(root, path).replaceAll("\\", "/"))
		.filter((path) =>
			path.endsWith("plugin.json") ||
			path.endsWith("marketplace.json") ||
			path.endsWith("/skills/heli-install/SKILL.md") ||
			path.endsWith("/install.md"),
		);
	return [...new Set([
		...CURRENT_FACING_VERSION_FILES,
		...adapterFiles,
		// Root Codex marketplace has no embedded version string today; keep it staged with releases when present.
		...(existsSync(join(root, ".agents", "plugins", "marketplace.json")) ? [".agents/plugins/marketplace.json"] : []),
	])];
}
