#!/usr/bin/env node
/**
 * Keep host plugin skill trees identical to the canonical Heli skill library.
 *
 * Canonical source: .heli-harness/skills/
 * Plugin destinations receive a full copy so cached plugins are self-contained
 * (no imports from the source checkout at runtime).
 *
 * Run:  node scripts/sync-plugin-skills.mjs
 * Check: node scripts/sync-plugin-skills.mjs --check
 */
import assert from "node:assert/strict";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";

const root = process.cwd();
const canonical = join(root, ".heli-harness", "skills");
const check = process.argv.includes("--check");
const inventoryOut = process.argv.includes("--write-inventory");

/** Plugins that expose a native skills/ directory for host discovery. */
const PLUGIN_SKILL_TARGETS = [
	{ id: "codex-plugin", skillsDir: join(root, ".heli-harness", "adapters", "codex-plugin", "skills") },
	{ id: "claude-plugin", skillsDir: join(root, ".heli-harness", "adapters", "claude-plugin", "skills") },
	{ id: "grok-plugin", skillsDir: join(root, ".heli-harness", "adapters", "grok-plugin", "skills") },
	{ id: "antigravity-plugin", skillsDir: join(root, ".heli-harness", "adapters", "antigravity-plugin", "skills") },
	{
		id: "cursor-plugin",
		skillsDir: join(root, ".heli-harness", "adapters", "cursor-plugin", "plugins", "heli-harness", "skills"),
	},
];

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const USE_WHEN_RE = /\buse when\b/i;

function listFiles(dir, acc = [], base = dir) {
	if (!existsSync(dir)) return acc;
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) listFiles(p, acc, base);
		else acc.push(relative(base, p).replaceAll("\\", "/"));
	}
	return acc.sort();
}

function listSkillDirs(skillsRoot) {
	if (!existsSync(skillsRoot)) return [];
	return readdirSync(skillsRoot)
		.filter((name) => statSync(join(skillsRoot, name)).isDirectory())
		.filter((name) => existsSync(join(skillsRoot, name, "SKILL.md")))
		.sort();
}

function parseFrontmatter(text) {
	const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
	if (!m) return { ok: false, error: "missing YAML frontmatter" };
	const block = m[1];
	const fields = {};
	let currentKey = null;
	for (const line of block.split(/\r?\n/)) {
		const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
		if (kv) {
			currentKey = kv[1];
			fields[currentKey] = kv[2].replace(/^["']|["']$/g, "").trim();
			continue;
		}
		// ignore list items under multi-line keys for validation purposes
		if (/^\s+-\s+/.test(line) && currentKey) continue;
	}
	return { ok: true, fields, body: text.slice(m[0].length) };
}

function validateSkill(skillName, skillMdPath) {
	const errors = [];
	const text = readFileSync(skillMdPath, "utf8");
	const fm = parseFrontmatter(text);
	if (!fm.ok) {
		errors.push(fm.error);
		return { errors, name: skillName, description: "", wordCount: 0, keywords: [] };
	}
	const name = fm.fields.name || skillName;
	const description = fm.fields.description || "";
	if (!fm.fields.name) errors.push("missing frontmatter name");
	if (fm.fields.name && fm.fields.name !== skillName) {
		errors.push(`frontmatter name "${fm.fields.name}" != directory "${skillName}"`);
	}
	if (!NAME_RE.test(name)) errors.push(`invalid name "${name}" (expect lowercase hyphenated)`);
	if (!description) errors.push("missing description");
	if (description && !USE_WHEN_RE.test(description)) {
		errors.push('description should include "Use when" trigger form');
	}
	if (description.length > 320) errors.push(`description too long (${description.length} chars; keep concise)`);
	const words = text.trim().split(/\s+/).filter(Boolean);
	const keywords = [...description.matchAll(/\b[a-z][a-z0-9-]{2,}\b/gi)].map((x) => x[0].toLowerCase());
	// Broken relative refs: [text](path) that is not http(s) or #
	const refRe = /\[[^\]]*\]\(([^)]+)\)/g;
	let rm;
	const skillDir = dirname(skillMdPath);
	while ((rm = refRe.exec(text))) {
		const href = rm[1].trim();
		if (!href || href.startsWith("#") || /^https?:\/\//i.test(href) || href.startsWith("mailto:")) continue;
		const target = join(skillDir, href.split("#")[0]);
		if (!existsSync(target)) errors.push(`broken reference: ${href}`);
	}
	return {
		errors,
		name,
		description,
		wordCount: words.length,
		keywords: [...new Set(keywords)].slice(0, 24),
	};
}

function assertNoOutsideSkillRefs(skillsDir) {
	const files = listFiles(skillsDir).filter((f) => f.endsWith(".md"));
	for (const rel of files) {
		const text = readFileSync(join(skillsDir, rel), "utf8");
		// Plugin skills must not tell the host to import runtime from a source checkout path
		if (/adapters\/shared\/|from\s+['"]\.\.\/\.\.\/\.\.\/lib\//.test(text)) {
			throw new Error(`${skillsDir}/${rel} appears to import outside the plugin skill tree`);
		}
	}
}

function syncOne(dest) {
	if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
	mkdirSync(dirname(dest), { recursive: true });
	cpSync(canonical, dest, { recursive: true });
}

function checkOne(dest, pluginId) {
	assert.ok(existsSync(dest), `${pluginId} skills dir missing — run: node scripts/sync-plugin-skills.mjs`);
	const srcSkills = listSkillDirs(canonical);
	const destSkills = listSkillDirs(dest);
	assert.deepEqual(
		destSkills,
		srcSkills,
		`${pluginId}: skill set differs from canonical\n  canonical: ${srcSkills.join(", ")}\n  plugin: ${destSkills.join(", ")}`,
	);
	const srcFiles = listFiles(canonical);
	const destFiles = listFiles(dest);
	assert.deepEqual(destFiles, srcFiles, `${pluginId}: skill file list differs from canonical`);
	for (const rel of srcFiles) {
		const a = readFileSync(join(canonical, rel));
		const b = readFileSync(join(dest, rel));
		assert.ok(a.equals(b), `${pluginId}/${rel} is stale vs canonical — run sync-plugin-skills.mjs`);
	}
	assertNoOutsideSkillRefs(dest);
	console.log(`ok: ${pluginId} skills match canonical (${destSkills.length} skills)`);
}

function buildInventory() {
	const skills = listSkillDirs(canonical);
	const rows = [];
	const nameSet = new Set();
	for (const skill of skills) {
		const skillPath = join(canonical, skill, "SKILL.md");
		const v = validateSkill(skill, skillPath);
		if (nameSet.has(v.name)) v.errors.push(`duplicate name ${v.name}`);
		nameSet.add(v.name);
		const packed = {};
		for (const t of PLUGIN_SKILL_TARGETS) {
			const p = join(t.skillsDir, skill, "SKILL.md");
			packed[t.id] = existsSync(p);
		}
		rows.push({
			name: v.name,
			description: v.description,
			canonicalPath: `.heli-harness/skills/${skill}/SKILL.md`,
			codexPath: `.heli-harness/adapters/codex-plugin/skills/${skill}/SKILL.md`,
			claudePath: `.heli-harness/adapters/claude-plugin/skills/${skill}/SKILL.md`,
			packedStatus: packed,
			wordCount: v.wordCount,
			triggerKeywords: v.keywords,
			validationStatus: v.errors.length ? "fail" : "pass",
			validationErrors: v.errors,
		});
	}
	return rows;
}

assert.ok(existsSync(canonical), "canonical .heli-harness/skills missing");

// Always validate canonical frontmatter (both sync and check)
const inventory = buildInventory();
const failed = inventory.filter((r) => r.validationStatus === "fail");
if (failed.length) {
	for (const f of failed) {
		console.error(`INVALID ${f.name}: ${f.validationErrors.join("; ")}`);
	}
	process.exitCode = 1;
	throw new Error(`${failed.length} canonical skill(s) failed validation`);
}

if (check) {
	for (const t of PLUGIN_SKILL_TARGETS) checkOne(t.skillsDir, t.id);
	// Manifest pointers
	const codexManifest = JSON.parse(
		readFileSync(join(root, ".heli-harness", "adapters", "codex-plugin", ".codex-plugin", "plugin.json"), "utf8"),
	);
	assert.equal(codexManifest.skills, "./skills/", "Codex plugin.json must point skills at ./skills/");
	console.log(`sync-plugin-skills --check: ok (${inventory.length} skills)`);
} else {
	for (const t of PLUGIN_SKILL_TARGETS) {
		syncOne(t.skillsDir);
		console.log(`synced ${t.id} skills (${listSkillDirs(t.skillsDir).length})`);
	}
	console.log("sync-plugin-skills: done");
}

if (inventoryOut || check) {
	const outDir = join(root, "temp", "heli-v0.5.24-skill-improvement");
	// Prefer workspace temp if present (parent lab), else skip write under package
	// Always write inventory next to report root when env set, else under cwd/temp if exists
	const candidates = [
		join(dirname(root), "temp", "heli-v0.5.24-skill-improvement"),
		join(root, "..", "..", "temp", "heli-v0.5.24-skill-improvement"),
		join(process.env.HELI_LAB_ROOT || "", "temp", "heli-v0.5.24-skill-improvement"),
	].filter(Boolean);
	// Worktree is .../heli-lab/worktrees/... so lab root is two levels up from worktree root? 
	// Actually workspace is heli-lab, worktree is heli-lab/worktrees/heli-harness-...
	const labTemp = join(root, "..", "..", "temp", "heli-v0.5.24-skill-improvement");
	const writeTo = existsSync(dirname(labTemp)) ? labTemp : null;
	if (writeTo && (inventoryOut || process.env.HELI_WRITE_SKILL_INVENTORY === "1")) {
		mkdirSync(writeTo, { recursive: true });
		writeFileSync(join(writeTo, "SKILL_INVENTORY.json"), JSON.stringify(inventory, null, 2));
		console.log(`wrote ${join(writeTo, "SKILL_INVENTORY.json")}`);
	}
}

export { PLUGIN_SKILL_TARGETS, listSkillDirs, buildInventory, validateSkill, canonical };
