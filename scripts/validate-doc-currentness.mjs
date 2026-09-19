#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const currentVersion = pkg.version;
const currentTag = `v${currentVersion}`;

let failures = 0;
let checked = 0;

function fail(path, message) {
	failures += 1;
	console.error(`  ❌ ${path}: ${message}`);
}

function pass(message) {
	console.log(`  ✅ ${message}`);
}

function walk(dir, out = []) {
	for (const name of readdirSync(dir)) {
		if ([".git", "node_modules", "temp"].includes(name)) continue;
		const path = join(dir, name);
		const st = statSync(path);
		if (st.isDirectory()) walk(path, out);
		else if (st.isFile() && /\.mdx?$/i.test(name)) out.push(path);
	}
	return out;
}

function rel(path) {
	return relative(root, path).replaceAll("\\", "/");
}

const canonicalRfc = "docs/superpowers/specs/2026-09-18-heli-v1-architecture-convergence.md";

function historicalPath(path) {
	if (path === "CHANGELOG.md") return true;
	if (path.startsWith(".superpowers/")) return true;
	if (path.startsWith("docs/reports/")) return true;
	if (path.startsWith("docs/research/")) return true;
	if (path.startsWith("docs/design/")) return true;
	if (path === "docs/PONYTAIL_PARITY_AUDIT.md") return true;
	if (path.startsWith("docs/decisions/") && path !== "docs/decisions/0002-portable-governance-kernel.md") return true;
	if (path.startsWith("docs/superpowers/plans/")) return true;
	if (path.startsWith("docs/superpowers/specs/") && path !== canonicalRfc) return true;
	return false;
}

const stalePhrases = [
	/do not install globally/i,
	/workspace harness is the primary install mode/i,
	/Heli-Harness is parent-workspace scoped, not a global user-level/i,
	/source of truth for this parent workspace/i,
	/Status:\s*implementation design for v0\.[0-9]/i,
	/Status:\s*Active implementation plan/i,
	/Proposed convergence contract/i,
	/Use the v0\.\d+\.\d+ tag after release/i,
];

const historicalLineMarker = /(historical|history|superseded|precursor|compatib|older|retained|provenance|shipped|introduced|before|since|baseline comparison)/i;
const oldVersion = /\bv0\.(?:[0-9])(?:\.\d+|\.x)?\b/g;

for (const abs of walk(root)) {
	const path = rel(abs);
	const text = readFileSync(abs, "utf8");
	if (historicalPath(path)) continue;
	checked += 1;

	for (const pattern of stalePhrases) {
		if (pattern.test(text)) fail(path, `stale current-facing phrase matches ${pattern}`);
	}

	const lines = text.replace(/\r\n/g, "\n").split("\n");
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		const matches = [...line.matchAll(oldVersion)].map((m) => m[0]);
		for (const match of matches) {
			if (match === currentTag) continue;
			if (!historicalLineMarker.test(line)) {
				fail(path, `line ${index + 1} references ${match} without historical/compatibility context`);
			}
		}
	}
}

const requiredCurrent = [
	"README.md",
	"INSTALL.md",
	"ROADMAP.md",
	"docs/architecture/README.md",
	"docs/architecture/governance-model.md",
	"docs/ENFORCEMENT_MATRIX.md",
	"docs/ADAPTER_SUPPORT_MATRIX.md",
	canonicalRfc,
	".heli-harness/README.md",
	".heli-harness/INSTALL.md",
	".heli-harness/state/README.md",
	".heli-harness/workspace/README.md",
	".heli-harness/adapters/pi/README.md",
];

for (const path of requiredCurrent) {
	const text = readFileSync(join(root, path), "utf8");
	if (!text.includes(currentTag) && !text.includes(currentVersion)) {
		fail(path, `must identify current release ${currentTag}`);
	}
}

for (const path of [
	"README.md",
	"INSTALL.md",
	"ROADMAP.md",
	"docs/ENFORCEMENT_MATRIX.md",
	"docs/ADAPTER_SUPPORT_MATRIX.md",
]) {
	const text = readFileSync(join(root, path), "utf8");
	if (!/architecture\/README\.md/.test(text)) {
		fail(path, "must link to the canonical current architecture index");
	}
}

const rfc = readFileSync(join(root, canonicalRfc), "utf8");
if (!/Accepted architecture contract/i.test(rfc) || !rfc.includes(currentTag)) {
	fail(canonicalRfc, `must be accepted and bound to current baseline ${currentTag}`);
}

const architectureDocs = [
	"docs/architecture/governance-model.md",
	"docs/architecture/cloud-sync.md",
	"docs/architecture/evidence-governed-autonomy.md",
	"docs/architecture/acp-governance-proxy.md",
];
for (const path of architectureDocs) {
	const text = readFileSync(join(root, path), "utf8");
	if (!/(Current baseline|Current release|Status:\*\* Historical|Status:\*\* Experimental|\*\*Status:\*\* Historical|\*\*Status:\*\* Experimental)/i.test(text)) {
		fail(path, "architecture document must declare current/historical/experimental status");
	}
	if (!/architecture|Current Heli architecture|Governance Model/i.test(text)) {
		fail(path, "architecture document must point back to current architecture context");
	}
}

for (const path of [
	"docs/superpowers/plans/2026-09-15-heli-agent-governance-protocol.md",
	"docs/superpowers/specs/2026-09-15-heli-agent-governance-protocol-design.md",
	"docs/superpowers/plans/2026-09-18-heli-v0.9-convergence-stabilization.md",
	"docs/design/heli-vnext-root-cause-evidence-gated-autonomy.md",
	"docs/PONYTAIL_PARITY_AUDIT.md",
	"docs/decisions/0001-heli-as-governance-harness.md",
]) {
	const text = readFileSync(join(root, path), "utf8");
	if (!/(historical|superseded|precursor)/i.test(text.slice(0, 1200))) {
		fail(path, "older design/plan must be explicitly marked historical or superseded near the top");
	}
}

if (failures) {
	console.error(`\ndocument-currentness: FAIL (${failures} issue(s), ${checked} current-facing Markdown files scanned)`);
	process.exit(1);
}

pass(`documentation currentness: ${checked} current-facing Markdown files scanned against ${currentTag}`);
