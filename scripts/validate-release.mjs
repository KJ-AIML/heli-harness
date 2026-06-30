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
