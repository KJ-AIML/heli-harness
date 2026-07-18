#!/usr/bin/env node
/**
 * Prove the npm pack tarball is a clean distributable artifact:
 * required distribution assets present; operational dogfood absent.
 */
import assert from "node:assert/strict";
import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const root = process.cwd();
const staging = mkdtempSync(join(tmpdir(), "heli-pack-smoke-"));
const extractDir = join(staging, "extract");
mkdirSync(extractDir, { recursive: true });

function walk(dir, out = []) {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		const st = statSync(p);
		if (st.isDirectory()) walk(p, out);
		else out.push(p);
	}
	return out;
}

try {
	const pack = spawnSync("npm", ["pack", "--pack-destination", staging], {
		cwd: root,
		encoding: "utf8",
		shell: true,
		stdio: ["ignore", "pipe", "pipe"],
	});
	assert.equal(pack.status, 0, `npm pack failed: ${pack.stderr || pack.stdout}`);
	const tgzName = (pack.stdout || "")
		.trim()
		.split(/\r?\n/)
		.filter(Boolean)
		.pop();
	assert.ok(tgzName && tgzName.endsWith(".tgz"), `unexpected pack output: ${pack.stdout}`);
	const tgzPath = join(staging, tgzName);
	assert.ok(existsSync(tgzPath), `tarball missing: ${tgzPath}`);

	const extract = spawnSync("tar", ["-xzf", tgzPath, "-C", extractDir], {
		encoding: "utf8",
		shell: true,
		stdio: ["ignore", "pipe", "pipe"],
	});
	assert.equal(extract.status, 0, `tar extract failed: ${extract.stderr}`);

	const pkgRoot = join(extractDir, "package");
	assert.ok(existsSync(join(pkgRoot, "package.json")), "package.json in tarball");
	const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));
	const expectedVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
	assert.equal(pkg.version, expectedVersion, "packed package.json version must match source package.json");
	assert.ok(
		existsSync(join(pkgRoot, ".agents", "plugins", "marketplace.json")),
		"repo-root Codex marketplace manifest must be packed for Git marketplace installs",
	);

	const required = [
		"bin/heli.mjs",
		"lib/cli/install.mjs",
		"lib/cli/seed-workspace.mjs",
		"lib/concurrency/index.mjs",
		".heli-harness/HARNESS.md",
		".heli-harness/manifest.json",
		".heli-harness/adapters/adapters.json",
		".heli-harness/adapters/shared/hook-core.mjs",
		".heli-harness/adapters/shared/concurrency/lease.mjs",
		".heli-harness/adapters/codex-plugin/shared/hook-core.mjs",
		".heli-harness/adapters/claude-plugin/shared/hook-core.mjs",
		".heli-harness/skills/engineering/SKILL.md",
		".heli-harness/skills/using-heli-skills/SKILL.md",
		".heli-harness/skills/heli-governance/SKILL.md",
		".heli-harness/adapters/codex-plugin/skills/using-heli-skills/SKILL.md",
		".heli-harness/adapters/codex-plugin/skills/verify-premise/SKILL.md",
		".heli-harness/adapters/claude-plugin/skills/using-heli-skills/SKILL.md",
		".heli-harness/adapters/claude-plugin/skills/debug/SKILL.md",
		".heli-harness/policies/engineering.md",
		".heli-harness/safety/command-rules.json",
		".heli-harness/templates/current-task.md",
		".heli-harness/state/current-task.md",
		".heli-harness/workspace/target.json",
		"install.sh",
		"install.ps1",
		"README.md",
		"CHANGELOG.md",
	];
	for (const rel of required) {
		assert.ok(existsSync(join(pkgRoot, rel)), `missing required asset: ${rel}`);
	}

	const forbiddenDirs = [
		".heli-harness/sessions",
		".heli-harness/tasks",
		".heli-harness/bindings",
		".heli-harness/locks",
		"temp",
		"research",
		"worktrees",
		"tasks",
		"sessions",
	];
	for (const rel of forbiddenDirs) {
		const p = join(pkgRoot, rel);
		if (!existsSync(p)) continue;
		const entries = readdirSync(p);
		assert.equal(entries.length, 0, `forbidden operational dir non-empty: ${rel}`);
	}

	assert.ok(!existsSync(join(pkgRoot, ".heli-harness/state/plan.md")), "plan.md must not ship");
	assert.ok(!existsSync(join(pkgRoot, ".heli-harness/state/yolo.json")), "yolo.json must not ship");

	const task = readFileSync(join(pkgRoot, ".heli-harness/state/current-task.md"), "utf8");
	assert.match(task, /idle/i);
	assert.doesNotMatch(task, /docs-overhaul|Documentation overhaul/i);

	const target = JSON.parse(readFileSync(join(pkgRoot, ".heli-harness/workspace/target.json"), "utf8"));
	assert.equal(target.targetRepo, "");

	const files = walk(pkgRoot);

	// Operational tree only — test scripts may intentionally name pollution markers.
	const operationalRoots = [
		join(pkgRoot, ".heli-harness", "state"),
		join(pkgRoot, ".heli-harness", "workspace"),
		join(pkgRoot, ".heli-harness", "sessions"),
		join(pkgRoot, ".heli-harness", "tasks"),
		join(pkgRoot, ".heli-harness", "bindings"),
		join(pkgRoot, ".heli-harness", "locks"),
	];
	const operationalFiles = files.filter((f) =>
		operationalRoots.some((r) => f === r || f.startsWith(r + "\\") || f.startsWith(r + "/")),
	);
	const operationalText = operationalFiles
		.map((f) => {
			try {
				return readFileSync(f, "utf8");
			} catch {
				return "";
			}
		})
		.join("\n");

	const markers = [
		"docs-overhaul",
		"Documentation overhaul",
		"DOCS_OVERHAUL_POLLUTION_MARKER",
		"Self-dogfood default for this repository checkout",
		"heli-ses-pollution",
		"heli-lease-pollution",
		"C:/fake/machine/path/pollution",
	];
	for (const m of markers) {
		assert.ok(!operationalText.includes(m), `operational package seed contains pollution marker: ${m}`);
	}

	// Absolute host paths / session IDs in operational JSON (sessions/bindings) must not appear.
	const operationalJson = files.filter((f) =>
		/[\\/]\.heli-harness[\\/](sessions|bindings|tasks|locks)[\\/]/.test(f),
	);
	assert.equal(
		operationalJson.length,
		0,
		`operational runtime files in pack: ${operationalJson.map((f) => relative(pkgRoot, f)).join(", ")}`,
	);

	const runtimeJsonText = operationalFiles
		.filter((f) => /\.json$/i.test(f))
		.map((f) => readFileSync(f, "utf8"))
		.join("\n");
	assert.ok(!/heli-ses-[0-9a-f-]{8,}/i.test(runtimeJsonText), "operational JSON embeds session id");
	assert.ok(!/heli-lease-[0-9a-f-]{8,}/i.test(runtimeJsonText), "operational JSON embeds lease id");
	// Source-machine absolute paths (built without embedding the literal path string in this file).
	const absPathRe = /[A-Za-z]:[\\/](?:KJ|Users|home)[\\/][^\s"']{8,}/i;
	assert.ok(!absPathRe.test(runtimeJsonText), "operational JSON embeds absolute host path");
	assert.ok(
		!/worktrees[\\/]+heli-harness-v0\.5\.24-concurrency/i.test(runtimeJsonText),
		"operational JSON embeds feature worktree path",
	);

	const sha = createHash("sha256").update(readFileSync(tgzPath)).digest("hex");
	const meta = {
		filename: tgzName,
		version: pkg.version,
		fileCount: files.length,
		sizeBytes: statSync(tgzPath).size,
		sha256: sha,
	};
	writeFileSync(join(staging, "meta.json"), JSON.stringify(meta, null, 2));
	console.log("smoke-pack-artifact: ok", meta);
} finally {
	rmSync(staging, { recursive: true, force: true });
}
