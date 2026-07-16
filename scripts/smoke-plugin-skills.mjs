#!/usr/bin/env node
/**
 * Packaging + discovery smoke for the canonical Heli skill library and host plugins.
 * Non-live: no provider calls.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync, mkdtempSync, rmSync, cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);

function listSkillDirs(skillsRoot) {
	if (!existsSync(skillsRoot)) return [];
	return readdirSync(skillsRoot)
		.filter((name) => statSync(join(skillsRoot, name)).isDirectory())
		.filter((name) => existsSync(join(skillsRoot, name, "SKILL.md")))
		.sort();
}

function listFiles(dir, acc = [], base = dir) {
	if (!existsSync(dir)) return acc;
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) listFiles(p, acc, base);
		else acc.push(p.slice(base.length + 1).replaceAll("\\", "/"));
	}
	return acc.sort();
}

// 1) sync --check must pass (frontmatter + parity)
{
	const r = spawnSync(process.execPath, [join(root, "scripts", "sync-plugin-skills.mjs"), "--check"], {
		cwd: root,
		encoding: "utf8",
	});
	assert.equal(r.status, 0, `sync-plugin-skills --check failed:\n${r.stdout}\n${r.stderr}`);
}

const canonical = join(root, ".heli-harness", "skills");
const skills = listSkillDirs(canonical);
assert.ok(skills.includes("using-heli-skills"), "using-heli-skills must exist in canonical library");
assert.ok(skills.includes("heli-governance"), "heli-governance must be in canonical library");
assert.ok(skills.includes("verify-premise"), "verify-premise must be in canonical library");
assert.ok(skills.length >= 24, `expected full skill library (>=24), got ${skills.length}`);

// unique names
assert.equal(new Set(skills).size, skills.length, "skill directory names must be unique");

// frontmatter Use when + name match
const nameRe = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
for (const skill of skills) {
	const text = readFileSync(join(canonical, skill, "SKILL.md"), "utf8");
	const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
	assert.ok(fm, `${skill}: missing frontmatter`);
	const nameLine = /^name:\s*(.+)$/m.exec(fm[1]);
	const descLine = /^description:\s*(.+)$/m.exec(fm[1]);
	assert.ok(nameLine, `${skill}: missing name`);
	assert.equal(nameLine[1].trim().replace(/^["']|["']$/g, ""), skill, `${skill}: name/dir mismatch`);
	assert.ok(nameRe.test(skill), `${skill}: invalid name form`);
	assert.ok(descLine, `${skill}: missing description`);
	assert.match(descLine[1], /\buse when\b/i, `${skill}: description should use "Use when"`);
}

// 2) plugin inventories match canonical
const plugins = [
	".heli-harness/adapters/codex-plugin/skills",
	".heli-harness/adapters/claude-plugin/skills",
	".heli-harness/adapters/grok-plugin/skills",
	".heli-harness/adapters/antigravity-plugin/skills",
	".heli-harness/adapters/cursor-plugin/plugins/heli-harness/skills",
];
for (const rel of plugins) {
	const dest = join(root, rel);
	assert.deepEqual(listSkillDirs(dest), skills, `${rel} skill set must match canonical`);
	for (const skill of skills) {
		const a = readFileSync(join(canonical, skill, "SKILL.md"));
		const b = readFileSync(join(dest, skill, "SKILL.md"));
		assert.ok(a.equals(b), `${rel}/${skill}/SKILL.md stale`);
	}
}

// 3) Codex manifest points at local skills/
const codexManifest = JSON.parse(
	readFileSync(join(root, ".heli-harness", "adapters", "codex-plugin", ".codex-plugin", "plugin.json"), "utf8"),
);
assert.equal(codexManifest.skills, "./skills/");

// 4) operational state is not packaged as skills
for (const bad of ["tasks", "sessions", "bindings", "locks", "current-task"]) {
	assert.ok(!skills.includes(bad), `operational name ${bad} must not be a skill`);
}
assert.ok(!existsSync(join(canonical, "tasks")), "skills/ must not contain tasks/");

// 5) clean install preserves plugin skills from package tree
{
	const { install } = await import("../lib/cli/install.mjs");
	const parentDir = mkdtempSync(join(tmpdir(), "heli-skill-install-"));
	try {
		install(join(root, ".heli-harness"), parentDir);
		const installed = listSkillDirs(join(parentDir, ".heli-harness", "skills"));
		assert.deepEqual(installed, skills, "clean install must copy full workspace skill library");
		const codexInstalled = listSkillDirs(
			join(parentDir, ".heli-harness", "adapters", "codex-plugin", "skills"),
		);
		assert.deepEqual(codexInstalled, skills, "clean install must copy full Codex plugin skills");
		const claudeInstalled = listSkillDirs(
			join(parentDir, ".heli-harness", "adapters", "claude-plugin", "skills"),
		);
		assert.deepEqual(claudeInstalled, skills, "clean install must copy full Claude plugin skills");
	} finally {
		rmSync(parentDir, { recursive: true, force: true });
	}
}

// 6) drift detection: --check fails when a plugin skill is removed
{
	const tmp = mkdtempSync(join(tmpdir(), "heli-skill-drift-"));
	try {
		const probeRoot = join(tmp, "pkg");
		mkdirSync(probeRoot, { recursive: true });
		// Minimal tree: copy only what sync needs
		cpSync(join(root, ".heli-harness", "skills"), join(probeRoot, ".heli-harness", "skills"), {
			recursive: true,
		});
		for (const p of [
			"codex-plugin",
			"claude-plugin",
			"grok-plugin",
			"antigravity-plugin",
		]) {
			cpSync(
				join(root, ".heli-harness", "adapters", p, "skills"),
				join(probeRoot, ".heli-harness", "adapters", p, "skills"),
				{ recursive: true },
			);
		}
		mkdirSync(join(probeRoot, ".heli-harness", "adapters", "cursor-plugin", "plugins", "heli-harness"), {
			recursive: true,
		});
		cpSync(
			join(root, ".heli-harness", "adapters", "cursor-plugin", "plugins", "heli-harness", "skills"),
			join(probeRoot, ".heli-harness", "adapters", "cursor-plugin", "plugins", "heli-harness", "skills"),
			{ recursive: true },
		);
		mkdirSync(join(probeRoot, ".heli-harness", "adapters", "codex-plugin", ".codex-plugin"), {
			recursive: true,
		});
		cpSync(
			join(root, ".heli-harness", "adapters", "codex-plugin", ".codex-plugin", "plugin.json"),
			join(probeRoot, ".heli-harness", "adapters", "codex-plugin", ".codex-plugin", "plugin.json"),
		);
		// Corrupt: delete one skill from codex plugin only
		rmSync(join(probeRoot, ".heli-harness", "adapters", "codex-plugin", "skills", "debug"), {
			recursive: true,
			force: true,
		});
		const r = spawnSync(process.execPath, [join(root, "scripts", "sync-plugin-skills.mjs"), "--check"], {
			cwd: probeRoot,
			encoding: "utf8",
		});
		assert.notEqual(r.status, 0, "sync --check must fail on plugin skill drift");
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
}

// silence unused
void require;
void listFiles;

console.log(`plugin skills smoke ok: ${skills.length} skills, parity + frontmatter + install + drift checks`);
