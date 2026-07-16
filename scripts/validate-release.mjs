/**
 * validate-release.mjs — Local release validation for Heli-Harness.
 *
 * Checks:
 *   - package.json parses and version is expected
 *   - manifest.json parses and version matches package version
 *   - .heli-harness/manifest.json parses and version matches
 *   - .heli-harness/safety/command-rules.json parses
 *   - .heli-harness/workspace/index.json parses (if present)
 *   - .heli-harness/workspace/target.json parses (if present)
 *   - 23 bundled skill frontmatters are valid
 *   - no exact legacy references
 *   - docs current-baseline / install examples use current package version
 *   - no obvious conflict markers
 *   - benchmark pack presence
 *   - adapter wiring verification
 *
 * Dependency-free. Runnable with Node.
 * Exit 0 on pass, 1 on any failure.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, "..");

// ── Helpers ──────────────────────────────────────────────────────────────────

let passCount = 0;
let failCount = 0;
let warnCount = 0;

function pass(label) {
	passCount++;
	console.log(`  ✅ ${label}`);
}

function fail(label, detail) {
	failCount++;
	console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
}

function warn(label, detail) {
	warnCount++;
	console.log(`  ⚠️  ${label}${detail ? ` — ${detail}` : ""}`);
}

function section(title) {
	console.log(`\n▸ ${title}`);
}

function safeReadJson(path) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
}

function safeReadText(path) {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return null;
	}
}

function isFile(p) {
	try {
		return statSync(p).isFile();
	} catch {
		return false;
	}
}

function isDir(p) {
	try {
		return statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function rel(p) {
	return p.replace(root, "").replace(/^[/\\]/, "").split("\\").join("/");
}

function walkFiles(dir, predicate = () => true) {
	const out = [];
	if (!isDir(dir)) return out;
	for (const name of readdirSync(dir).sort()) {
		const path = join(dir, name);
		if (isDir(path)) out.push(...walkFiles(path, predicate));
		else if (isFile(path) && predicate(path)) out.push(path);
	}
	return out;
}

function normalizeText(text) {
	return String(text || "").replace(/\r\n/g, "\n");
}

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasHeading(text, heading) {
	return new RegExp(`^#{1,6}\\s+${escapeRegExp(heading)}\\s*$`, "im").test(text);
}

function getSectionBody(text, heading) {
	const normalized = normalizeText(text);
	const match = new RegExp(`^#{1,6}\\s+${escapeRegExp(heading)}\\s*$`, "im").exec(normalized);
	if (!match) return "";
	const rest = normalized.slice(match.index + match[0].length);
	const nextHeading = /\n#{1,6}\s+/m.exec(rest);
	return (nextHeading ? rest.slice(0, nextHeading.index) : rest).trim();
}

function sectionHasContent(text, heading) {
	return /[a-z0-9]/i.test(getSectionBody(text, heading));
}

function sectionHasEvidence(text, heading) {
	const body = getSectionBody(text, heading);
	return /`[^`]+`/.test(body) || /(evidence path|package\.json|readme|agents\.md|claude\.md|docs\/|\/|\\)/i.test(body);
}

function isExplicitNoExceptions(body) {
	return /\bnone currently approved\b|\bno exceptions\b/i.test(body);
}

const COMMAND_RULE_TIERS = new Set(["T0", "T1", "T2", "T3", "T4", "T5", "T6"]);

function validateCommandRules(config) {
	const warnings = [];
	if (!config || typeof config !== "object" || Array.isArray(config)) {
		return { valid: false, warnings: ["command-rules.json must be an object"] };
	}
	if (config.version !== 1) warnings.push("version must be 1");
	if (!Array.isArray(config.rules)) {
		warnings.push("rules must be an array");
	} else {
		const ids = new Set();
		for (const [index, rule] of config.rules.entries()) {
			const label = `rules[${index}]`;
			if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
				warnings.push(`${label} must be an object`);
				continue;
			}
			if (typeof rule.id !== "string" || !rule.id.trim()) {
				warnings.push(`${label}.id must be a non-empty string`);
			} else if (ids.has(rule.id)) {
				warnings.push(`${label}.id duplicates "${rule.id}"`);
			} else {
				ids.add(rule.id);
			}
			if (typeof rule.match !== "string" || !rule.match.trim()) {
				warnings.push(`${label}.match must be a non-empty string`);
			}
			if (typeof rule.tier !== "string" || !COMMAND_RULE_TIERS.has(rule.tier)) {
				warnings.push(`${label}.tier must be T0-T6`);
			}
			if (typeof rule.reason !== "string" || !rule.reason.trim()) {
				warnings.push(`${label}.reason must be a non-empty string`);
			}
		}
	}
	return { valid: warnings.length === 0, warnings };
}

// ── 1. JSON / version checks ────────────────────────────────────────────────

section("JSON and version checks");

const pkg = safeReadJson(join(root, "package.json"));
if (!pkg) {
	fail("package.json", "failed to parse");
} else {
	pass(`package.json parses (version ${pkg.version})`);
}

const manifest = safeReadJson(join(root, "manifest.json"));
if (!manifest) {
	fail("manifest.json", "failed to parse");
} else if (pkg && manifest.version !== pkg.version) {
	fail(
		"manifest.json version",
		`expected ${pkg.version}, got ${manifest.version}`,
	);
} else {
	pass(`manifest.json version matches (${manifest.version})`);
}

const harnessManifest = safeReadJson(
	join(root, ".heli-harness", "manifest.json"),
);
if (!harnessManifest) {
	fail(".heli-harness/manifest.json", "failed to parse");
} else if (pkg && harnessManifest.version !== pkg.version) {
	fail(
		".heli-harness/manifest.json version",
		`expected ${pkg.version}, got ${harnessManifest.version}`,
	);
} else {
	pass(
		`.heli-harness/manifest.json version matches (${harnessManifest.version})`,
	);
}

const commandRules = safeReadJson(
	join(root, ".heli-harness", "safety", "command-rules.json"),
);
if (!commandRules) {
	fail(".heli-harness/safety/command-rules.json", "failed to parse");
} else {
	pass(".heli-harness/safety/command-rules.json parses");
	const commandRuleValidation = validateCommandRules(commandRules);
	if (commandRuleValidation.valid) {
		pass(".heli-harness/safety/command-rules.json schema valid");
	} else {
		fail(".heli-harness/safety/command-rules.json schema", commandRuleValidation.warnings.join("; "));
	}
}

const indexPath = join(root, ".heli-harness", "workspace", "index.json");
if (isFile(indexPath)) {
	const idx = safeReadJson(indexPath);
	if (!idx) {
		fail(".heli-harness/workspace/index.json", "failed to parse");
	} else {
		pass(".heli-harness/workspace/index.json parses");
	}
} else {
	warn(".heli-harness/workspace/index.json", "not present (optional)");
}

const targetPath = join(root, ".heli-harness", "workspace", "target.json");
if (isFile(targetPath)) {
	const tgt = safeReadJson(targetPath);
	if (!tgt) {
		fail(".heli-harness/workspace/target.json", "failed to parse");
	} else {
		pass(".heli-harness/workspace/target.json parses");
	}
} else {
	warn(".heli-harness/workspace/target.json", "not present (optional)");
}

// ── 2. Skill frontmatter validation ─────────────────────────────────────────

section("Skill frontmatter validation");

const skillsDir = join(root, ".heli-harness", "skills");
const skillFiles = [];
if (isDir(skillsDir)) {
	for (const skillName of readdirSync(skillsDir).sort()) {
		const skillMd = join(skillsDir, skillName, "SKILL.md");
		if (isFile(skillMd)) skillFiles.push(skillMd);
	}
}

if (skillFiles.length === 0) {
	fail("skill frontmatters", "no SKILL.md files found");
} else {
	let validCount = 0;
	const invalid = [];
	for (const file of skillFiles) {
		const text = safeReadText(file);
		if (text && text.startsWith("---")) {
			validCount++;
		} else {
			invalid.push(file.replace(root, ""));
		}
	}
	if (invalid.length > 0) {
		fail(
			`skill frontmatters`,
			`${invalid.length} invalid: ${invalid.join(", ")}`,
		);
	} else {
		pass(`${validCount}/${skillFiles.length} skill frontmatters valid`);
	}
	if (skillFiles.length !== 23) {
		warn(`expected 23 bundled skills, found ${skillFiles.length}`);
	}
}

// ── 3. Legacy reference audit ───────────────────────────────────────────────

section("Legacy reference audit");

const LEGACY_PATTERNS = [
	"Helicopter-Harness",
	"helicopter-harness",
	".helicopter-harness",
	"/helicopter-install",
	"KJ-AIML/helicopter-harness",
];

let legacyFound = false;
for (const pattern of LEGACY_PATTERNS) {
	const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	let output = "";
	try {
		output = execSync(`rg -n --glob "!.git" --glob "!scripts/validate-release.mjs" "${escaped}" .`, {
			cwd: root,
			encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
	} catch (error) {
		// rg exits 1 when this specific pattern has no matches.
		if (error && error.status === 1) continue;
		throw error;
	}
	if (output) {
		legacyFound = true;
		fail(
			`legacy reference: ${pattern}`,
			output.split("\n").slice(0, 3).join("; "),
		);
	}
}
if (!legacyFound) {
	pass("zero legacy references found");
}

// ── 4. Docs / version consistency ───────────────────────────────────────────

section("Docs / version consistency");

const currentVersion = pkg ? pkg.version : null;
if (!currentVersion) {
	fail(
		"docs consistency",
		"cannot determine current version from package.json",
	);
} else {
	// README: look for "latest stable" or "v0.X.Y" in install examples
	const readme = safeReadText(join(root, "README.md"));
	if (readme) {
		const readmeStale = [];
		// Check install examples reference current version
		const installExamplePattern = /(?:checkout|@)\s*v?(\d+\.\d+\.\d+)/g;
		let match;
		while ((match = installExamplePattern.exec(readme)) !== null) {
			if (match[1] !== currentVersion) {
				readmeStale.push(`found v${match[1]}`);
			}
		}
		// Check "latest stable" or "current supported" lines
		const latestStablePattern =
			/(?:latest stable|current supported|current baseline)[^\n]*v?(\d+\.\d+\.\d+)/gi;
		while ((match = latestStablePattern.exec(readme)) !== null) {
			if (match[1] !== currentVersion) {
				readmeStale.push(`latest stable says v${match[1]}`);
			}
		}
		if (readmeStale.length > 0) {
			fail("README.md", `stale version references: ${readmeStale.join("; ")}`);
		} else {
			pass("README.md install examples and baseline use current version");
		}
	}

	// INSTALL.md
	const installMd = safeReadText(join(root, "INSTALL.md"));
	if (installMd) {
		const installStale = [];
		const installPattern = /(?:checkout|@)\s*v?(\d+\.\d+\.\d+)/g;
		let match;
		while ((match = installPattern.exec(installMd)) !== null) {
			if (match[1] !== currentVersion) {
				installStale.push(`found v${match[1]}`);
			}
		}
		if (installStale.length > 0) {
			fail(
				"INSTALL.md",
				`stale version references: ${installStale.join("; ")}`,
			);
		} else {
			pass("INSTALL.md install examples use current version");
		}
	}

	// ROADMAP.md: current baseline should match
	const roadmap = safeReadText(join(root, "ROADMAP.md"));
	if (roadmap) {
		const baselineMatch = /Current Baseline:\s*v?(\d+\.\d+\.\d+)/i.exec(
			roadmap,
		);
		if (baselineMatch && baselineMatch[1] !== currentVersion) {
			fail(
				"ROADMAP.md",
				`current baseline says v${baselineMatch[1]}, expected v${currentVersion}`,
			);
		} else if (baselineMatch) {
			pass("ROADMAP.md current baseline matches");
		} else {
			warn("ROADMAP.md", "no 'Current Baseline' line found");
		}

		// Check latest stable line
		const latestMatch = /Latest stable release:\s*`?v?(\d+\.\d+\.\d+)`?/i.exec(
			roadmap,
		);
		if (latestMatch && latestMatch[1] !== currentVersion) {
			fail(
				"ROADMAP.md",
				`latest stable says v${latestMatch[1]}, expected v${currentVersion}`,
			);
		} else if (latestMatch) {
			pass("ROADMAP.md latest stable matches");
		}
	}

	// docs/INSTALL_MATRIX.md
	const matrix = safeReadText(join(root, "docs", "INSTALL_MATRIX.md"));
	if (matrix) {
		const matrixStale = [];
		const matrixPattern = /@v?(\d+\.\d+\.\d+)/g;
		let match;
		while ((match = matrixPattern.exec(matrix)) !== null) {
			if (match[1] !== currentVersion) {
				matrixStale.push(`found v${match[1]}`);
			}
		}
		if (matrixStale.length > 0) {
			fail(
				"docs/INSTALL_MATRIX.md",
				`stale version references: ${matrixStale.join("; ")}`,
			);
		} else {
			pass("docs/INSTALL_MATRIX.md uses current version");
		}
	}

	// CHANGELOG.md: the top entry should be the current version
	const changelog = safeReadText(join(root, "CHANGELOG.md"));
	if (changelog) {
		const firstVersionMatch = /^## v?(\d+\.\d+\.\d+)/m.exec(changelog);
		if (firstVersionMatch && firstVersionMatch[1] !== currentVersion) {
			fail(
				"CHANGELOG.md",
				`first entry is v${firstVersionMatch[1]}, expected v${currentVersion}`,
			);
		} else if (firstVersionMatch) {
			pass("CHANGELOG.md first entry matches current version");
		}
	}
}

// ── 5. Conflict markers ─────────────────────────────────────────────────────

section("Expanded current-doc audit");

if (!currentVersion) {
	fail("expanded current-doc audit", "cannot determine current version from package.json");
} else {
	const currentTag = `v${currentVersion}`;
	const currentFiles = [
		join(root, "README.md"),
		join(root, "INSTALL.md"),
		join(root, "docs", "INSTALL_MATRIX.md"),
		join(root, "docs", "architecture", "governance-model.md"),
		join(root, ".heli-harness", "README.md"),
		join(root, ".heli-harness", "INSTALL.md"),
		join(root, "extensions", "pi-extension.js"),
		...walkFiles(join(root, ".heli-harness", "adapters"), (path) => path.endsWith(".md")),
	];
	const staleVersionPattern = /\bv(0\.(?:3|4)\.\d|0\.5\.0)\b/g;
	let staleCurrentDocs = 0;
	for (const file of currentFiles) {
		const text = safeReadText(file);
		if (!text) continue;
		const stale = [...text.matchAll(staleVersionPattern)]
			.map((match) => match[0])
			.filter((tag) => tag !== currentTag);
		const staleSkillCount = /\b17 skills\b/i.test(text);
		if (stale.length || staleSkillCount) {
			staleCurrentDocs++;
			fail(rel(file), [
				stale.length ? `stale tags: ${[...new Set(stale)].join(", ")}` : "",
				staleSkillCount ? "stale skill count: 17 skills" : "",
			].filter(Boolean).join("; "));
		}
	}
	if (staleCurrentDocs === 0) {
		pass("current docs, adapter docs, internal install docs, and extension strings are current");
	}
}

section("Shipped defaults lint");

const PROFILE_REQUIRED_SECTIONS = [
	"Policy references",
	"Observed stack",
	"Existing patterns",
	"Recommended conventions",
	"Known tech debt",
	"Forbidden patterns",
	"Safer alternatives",
	"Command tiers",
	"Repo risks",
	"Exceptions",
	"Evidence paths",
];

const profilesDir = join(root, ".heli-harness", "profiles");
const activeProfiles = walkFiles(profilesDir, (path) => path.endsWith(".md") && rel(path) !== ".heli-harness/profiles/README.md");
if (activeProfiles.length === 0) {
	fail("active repo profiles", "no active .md profiles found");
} else {
	let profileWarnings = 0;
	for (const file of activeProfiles) {
		const text = normalizeText(safeReadText(file));
		for (const sectionName of PROFILE_REQUIRED_SECTIONS) {
			if (!hasHeading(text, sectionName)) {
				profileWarnings++;
				fail(rel(file), `missing section "${sectionName}"`);
			}
		}
		if (sectionHasContent(text, "Existing patterns") && !sectionHasEvidence(text, "Existing patterns") && !sectionHasContent(text, "Evidence paths")) {
			profileWarnings++;
			fail(rel(file), "existing patterns section has no evidence paths");
		}
		if (sectionHasContent(text, "Recommended conventions") && !sectionHasEvidence(text, "Recommended conventions") && !sectionHasContent(text, "Evidence paths")) {
			profileWarnings++;
			fail(rel(file), "recommended conventions section has no evidence paths");
		}
		if (sectionHasContent(text, "Known tech debt") && !sectionHasContent(text, "Safer alternatives")) {
			profileWarnings++;
			fail(rel(file), "known tech debt has no safer alternatives");
		}
	}
	if (profileWarnings === 0) pass(`${activeProfiles.length} active profile(s) satisfy required taxonomy`);
}

const expectedProfile = join(root, ".heli-harness", "profiles", "heli-harness.md");
if (isFile(expectedProfile)) pass("active heli-harness profile exists");
else fail(".heli-harness/profiles/heli-harness.md", "missing active dogfood profile");

const strayAgentProfile = join(root, ".heli-harness", "profiles", "agent-native-backend.md");
if (isFile(strayAgentProfile)) fail(rel(strayAgentProfile), "unrelated active profile should be an example");
else pass("unrelated agent-native-backend profile is not active");

const policiesDir = join(root, ".heli-harness", "policies");
const policyFiles = walkFiles(policiesDir, (path) => path.endsWith(".md"));
let policyWarnings = 0;
for (const file of policyFiles) {
	const text = normalizeText(safeReadText(file));
	const exceptions = getSectionBody(text, "Exceptions");
	if (!sectionHasContent(text, "Exceptions")) {
		policyWarnings++;
		fail(rel(file), "Exceptions section is empty");
	} else if (!isExplicitNoExceptions(exceptions) && !/(scope:|condition:|approval:|justification:)/i.test(exceptions)) {
		policyWarnings++;
		fail(rel(file), "Exceptions section must say none approved or record scope/approval/justification");
	}
}
if (policyFiles.length > 0 && policyWarnings === 0) pass(`${policyFiles.length} policy exception section(s) are explicit`);

const shippedIndex = safeReadJson(join(root, ".heli-harness", "workspace", "index.json"));
if (!shippedIndex || shippedIndex.schemaVersion !== 1 || !shippedIndex.workspaceRoot || !Array.isArray(shippedIndex.repos)) {
	fail(".heli-harness/workspace/index.json", "must have schemaVersion, workspaceRoot, and repos array");
} else if (shippedIndex.repos.length > 0) {
	fail(
		".heli-harness/workspace/index.json",
		"package seed must ship empty repos[] (no selected source repository target metadata)",
	);
} else {
	pass(".heli-harness/workspace/index.json is clean empty-seed");
}

const shippedTarget = safeReadJson(join(root, ".heli-harness", "workspace", "target.json"));
if (!shippedTarget || shippedTarget.schemaVersion !== 1) {
	fail(".heli-harness/workspace/target.json", "must parse with schemaVersion 1");
} else if (shippedTarget.targetRepo || shippedTarget.targetGitRoot || shippedTarget.activeProfile) {
	fail(
		".heli-harness/workspace/target.json",
		"package seed must not select a target (distributable artifact must be idle)",
	);
} else {
	pass(".heli-harness/workspace/target.json is clean empty-seed");
}

section("Package operational seed cleanliness");

const idleTask = safeReadText(join(root, ".heli-harness", "state", "current-task.md")) || "";
if (!/idle|none — idle|Current status: complete/i.test(idleTask)) {
	fail(".heli-harness/state/current-task.md", "package seed must be idle");
} else if (/docs-overhaul|Documentation overhaul|Failed attempts count: [1-9]/i.test(idleTask)) {
	fail(".heli-harness/state/current-task.md", "package seed contains dogfood operational markers");
} else {
	pass(".heli-harness/state/current-task.md is idle package seed");
}

if (isFile(join(root, ".heli-harness", "state", "plan.md"))) {
	fail(".heli-harness/state/plan.md", "package must not ship operational plan.md");
} else {
	pass("no operational plan.md in package seed");
}

if (isFile(join(root, ".heli-harness", "state", "yolo.json"))) {
	fail(".heli-harness/state/yolo.json", "package must not ship yolo.json");
} else {
	pass("no yolo.json in package seed");
}

for (const dirName of ["sessions", "tasks", "bindings", "locks"]) {
	const dir = join(root, ".heli-harness", dirName);
	if (isDir(dir)) {
		const entries = readdirSync(dir).filter((n) => n !== ".gitkeep");
		if (entries.length > 0) {
			fail(`.heli-harness/${dirName}/`, `must be empty for packaging (found: ${entries.slice(0, 3).join(", ")})`);
		} else {
			pass(`.heli-harness/${dirName}/ empty or absent`);
		}
	} else {
		pass(`.heli-harness/${dirName}/ absent`);
	}
}

const pollutionMarkers = [
	"docs-overhaul",
	"DOCS_OVERHAUL_POLLUTION_MARKER",
	"heli-ses-pollution",
	"heli-lease-pollution",
	"C:/fake/machine/path/pollution",
	"Self-dogfood default for this repository checkout",
];
const seedScanPaths = [
	join(root, ".heli-harness", "state", "current-task.md"),
	join(root, ".heli-harness", "state", "decisions.md"),
	join(root, ".heli-harness", "workspace", "target.json"),
	join(root, ".heli-harness", "workspace", "index.json"),
];
let seedPollution = 0;
for (const p of seedScanPaths) {
	const text = safeReadText(p) || "";
	for (const marker of pollutionMarkers) {
		if (text.includes(marker)) {
			seedPollution++;
			fail(rel(p), `contains pollution marker: ${marker}`);
		}
	}
}
if (seedPollution === 0) pass("package operational seed files free of known pollution markers");

section("Benchmark evidence wording");

const benchmarkExample = safeReadText(join(root, "benchmarks", "examples", "openmesh-style-ab.md")) || "";
if (!/Illustrative \/ hypothetical example\s+.\s+not a measured benchmark result/i.test(benchmarkExample)) {
	fail("benchmarks/examples/openmesh-style-ab.md", "missing illustrative/hypothetical label");
} else {
	pass("benchmark example is labeled as illustrative, not measured");
}
if (/(^|\n)## Expected Results\b/.test(benchmarkExample) || /\*\*Likely outcome:\*\*/.test(benchmarkExample)) {
	fail("benchmarks/examples/openmesh-style-ab.md", "hypothetical outcomes should not read as measured expected results");
} else {
	pass("benchmark example outcome wording is hypothetical");
}

section("Conflict markers");

try {
	const conflictOutput = execSync(
		`rg -n "<<<<<<<|=======|>>>>>>>" --glob "!.git" --glob "!CHANGELOG.md" --glob "!scripts/validate-release.mjs" --glob "!scripts/benchmark-summary.mjs" .`,
		{ cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
	).trim();
	if (conflictOutput) {
		fail(
			"conflict markers found",
			conflictOutput.split("\n").slice(0, 5).join("; "),
		);
	} else {
		pass("no conflict markers found");
	}
} catch {
	pass("no conflict markers found");
}

// ── 6. Benchmark pack presence ─────────────────────────────────────────────

section("Benchmark pack presence");

const benchmarkDirs = [
	join(root, "benchmarks"),
	join(root, "benchmarks", "scenarios"),
	join(root, "benchmarks", "rubrics"),
	join(root, "benchmarks", "templates"),
	join(root, "benchmarks", "examples"),
];

for (const dir of benchmarkDirs) {
	if (isDir(dir)) {
		pass(`${dir.replace(root + "/", "")} exists`);
	} else {
		fail(`${dir.replace(root + "/", "")}`, "directory not found");
	}
}

const requiredBenchmarkFiles = [
	join(root, "benchmarks", "README.md"),
	join(root, "benchmarks", "scenarios", "README.md"),
	join(root, "benchmarks", "scenarios", "docs-change.md"),
	join(root, "benchmarks", "scenarios", "bugfix-small.md"),
	join(root, "benchmarks", "scenarios", "feature-small.md"),
	join(root, "benchmarks", "scenarios", "multi-repo-targeting.md"),
	join(root, "benchmarks", "scenarios", "unsafe-command.md"),
	join(root, "benchmarks", "scenarios", "tech-debt-pattern.md"),
	join(root, "benchmarks", "rubrics", "scoring-rubric.md"),
	join(root, "benchmarks", "rubrics", "metrics.md"),
	join(root, "benchmarks", "rubrics", "report-completeness.md"),
	join(root, "benchmarks", "rubrics", "safety-score.md"),
	join(root, "benchmarks", "rubrics", "target-discipline.md"),
	join(root, "benchmarks", "templates", "experiment-plan.md"),
	join(root, "benchmarks", "templates", "run-log.md"),
	join(root, "benchmarks", "templates", "scorecard.md"),
	join(root, "benchmarks", "templates", "comparison-report.md"),
	join(root, "benchmarks", "examples", "openmesh-style-ab.md"),
];

for (const file of requiredBenchmarkFiles) {
	if (isFile(file)) {
		pass(`${file.replace(root + "/", "")} exists`);
	} else {
		fail(`${file.replace(root + "/", "")}`, "file not found");
	}
}

// ── 7. Adapter wiring verification ──────────────────────────────────────────

section("Claude adapter smoke verification");

try {
	execSync("node scripts/smoke-claude-adapter.mjs", {
		cwd: root,
		encoding: "utf8",
		stdio: "inherit",
	});
	pass("Claude adapter smoke passed");
} catch (error) {
	fail("Claude adapter smoke failed", error.message);
}

section("Codex adapter smoke verification");

try {
	execSync("node scripts/smoke-codex-adapter.mjs", {
		cwd: root,
		encoding: "utf8",
		stdio: "inherit",
	});
	pass("Codex adapter smoke passed");
} catch (error) {
	fail("Codex adapter smoke failed", error.message);
}

section("Claude plugin smoke verification");

try {
	execSync("node scripts/smoke-claude-plugin.mjs", {
		cwd: root,
		encoding: "utf8",
		stdio: "inherit",
	});
	pass("Claude plugin smoke passed");
} catch (error) {
	fail("Claude plugin smoke failed", error.message);
}

section("Codex plugin smoke verification");

try {
	execSync("node scripts/smoke-codex-plugin.mjs", {
		cwd: root,
		encoding: "utf8",
		stdio: "inherit",
	});
	pass("Codex plugin smoke passed");
} catch (error) {
	fail("Codex plugin smoke failed", error.message);
}

section("Adapter wiring verification");

try {
	execSync("node scripts/verify-adapters.mjs", {
		cwd: root,
		encoding: "utf8",
		stdio: "inherit",
	});
	pass("adapter verification passed");
} catch (error) {
	fail("adapter verification failed", error.message);
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log("\n" + "─".repeat(60));
console.log(
	`Results: ${passCount} passed, ${failCount} failed, ${warnCount} warnings`,
);
console.log("─".repeat(60));

if (failCount > 0) {
	console.log("\n❌ Release validation FAILED");
	process.exit(1);
} else {
	console.log("\n✅ Release validation PASSED");
	process.exit(0);
}
