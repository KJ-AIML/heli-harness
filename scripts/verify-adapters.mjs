/**
 * verify-adapters.mjs — Adapter wiring verification for Heli-Harness.
 *
 * Checks:
 *   - adapters.json exists and parses
 *   - Schema: version, adapters array, taxonomy
 *   - Each adapter has unique id, valid status, required fields
 *   - Evidence file paths exist
 *   - Docs matrix mentions every adapter id
 *   - Docs do not overclaim (e.g., "enforced" without evidence)
 *
 * Dependency-free. Runnable with Node.
 * Exit 0 on pass, 1 on any failure.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
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

// ── 1. Adapter manifest validation ──────────────────────────────────────────

section("Adapter manifest validation");

const adaptersPath = join(root, ".heli-harness", "adapters", "adapters.json");
const adapters = safeReadJson(adaptersPath);

if (!adapters) {
	fail("adapters.json parses");
	console.error("\n❌ Adapter verification failed: adapters.json missing or invalid");
	process.exit(1);
}
pass("adapters.json parses");

if (!adapters.version || typeof adapters.version !== "string") {
	fail("adapters.json has version string");
} else {
	pass("adapters.json has version string");
}

if (!adapters.taxonomy || typeof adapters.taxonomy !== "object") {
	fail("adapters.json has taxonomy object");
} else {
	pass("adapters.json has taxonomy object");
	const validStatuses = ["enforced", "wired", "documented", "planned", "unsupported"];
	for (const status of validStatuses) {
		if (!adapters.taxonomy[status]) {
			fail(`taxonomy defines "${status}" status`);
		} else {
			pass(`taxonomy defines "${status}" status`);
		}
	}
}

if (!Array.isArray(adapters.adapters) || adapters.adapters.length === 0) {
	fail("adapters.json has non-empty adapters array");
	console.error("\n❌ Adapter verification failed: adapters array empty or missing");
	process.exit(1);
}
pass("adapters.json has non-empty adapters array");

// ── 2. Adapter schema validation ────────────────────────────────────────────

section("Adapter schema validation");

const validStatuses = ["enforced", "wired", "documented", "planned", "unsupported"];
const adapterIds = new Set();

for (const adapter of adapters.adapters) {
	const id = adapter.id;

	if (!id || typeof id !== "string") {
		fail(`adapter has id string`);
		continue;
	}

	if (adapterIds.has(id)) {
		fail(`adapter "${id}" has unique id`);
		continue;
	}
	adapterIds.add(id);
	pass(`adapter "${id}" has unique id`);

	if (!adapter.name || typeof adapter.name !== "string") {
		fail(`adapter "${id}" has name string`);
	}

	if (!adapter.status || !validStatuses.includes(adapter.status)) {
		fail(`adapter "${id}" has valid status (got "${adapter.status}")`);
		continue;
	}
	pass(`adapter "${id}" has valid status: ${adapter.status}`);

	if (!Array.isArray(adapter.evidence)) {
		fail(`adapter "${id}" has evidence array`);
	} else {
		pass(`adapter "${id}" has evidence array`);
	}

	if (!Array.isArray(adapter.verification)) {
		fail(`adapter "${id}" has verification array`);
	} else {
		pass(`adapter "${id}" has verification array`);
	}

	if (!Array.isArray(adapter.limitations)) {
		fail(`adapter "${id}" has limitations array`);
	} else {
		pass(`adapter "${id}" has limitations array`);
	}
}

// ── 3. Evidence file presence ───────────────────────────────────────────────

section("Evidence file presence");

for (const adapter of adapters.adapters) {
	const id = adapter.id;

	if (!Array.isArray(adapter.evidence)) continue;

	for (const evidencePath of adapter.evidence) {
		const fullPath = join(root, evidencePath);
		if (!existsSync(fullPath)) {
			fail(`adapter "${id}" evidence file exists: ${evidencePath}`);
		} else {
			pass(`adapter "${id}" evidence file exists: ${evidencePath}`);
		}
	}
}

// ── 4. Status/evidence consistency ──────────────────────────────────────────

section("Status/evidence consistency");

for (const adapter of adapters.adapters) {
	const id = adapter.id;
	const status = adapter.status;
	const evidence = adapter.evidence || [];
	const verification = adapter.verification || [];

	if (status === "enforced") {
		if (evidence.length === 0) {
			fail(`adapter "${id}" is "enforced" but has no evidence files`);
		} else {
			pass(`adapter "${id}" is "enforced" and has evidence files`);
		}
		if (verification.length === 0) {
			fail(`adapter "${id}" is "enforced" but has no verification commands`);
		} else {
			pass(`adapter "${id}" is "enforced" and has verification commands`);
		}
	}

	if (status === "wired") {
		if (evidence.length === 0) {
			fail(`adapter "${id}" is "wired" but has no evidence files`);
		} else {
			pass(`adapter "${id}" is "wired" and has evidence files`);
		}
	}

	if (status === "documented") {
		if (evidence.length === 0) {
			warn(`adapter "${id}" is "documented" but has no evidence files`);
		} else {
			pass(`adapter "${id}" is "documented" and has evidence files`);
		}
	}

	if (status === "planned") {
		if (evidence.length > 0) {
			warn(`adapter "${id}" is "planned" but has evidence files (consider upgrading status)`);
		} else {
			pass(`adapter "${id}" is "planned" with no evidence (correct)`);
		}
	}

	if (status === "unsupported") {
		pass(`adapter "${id}" is "unsupported"`);
	}
}

// ── 5. Docs matrix consistency ──────────────────────────────────────────────

section("Docs matrix consistency");

const matrixPath = join(root, "docs", "ADAPTER_SUPPORT_MATRIX.md");
const matrixText = safeReadText(matrixPath);

if (!matrixText) {
	fail("docs/ADAPTER_SUPPORT_MATRIX.md exists");
} else {
	pass("docs/ADAPTER_SUPPORT_MATRIX.md exists");

	for (const adapter of adapters.adapters) {
		const id = adapter.id;
		const name = adapter.name;

		if (!matrixText.includes(id) && !matrixText.includes(name)) {
			fail(`adapter "${id}" mentioned in support matrix`);
		} else {
			pass(`adapter "${id}" mentioned in support matrix`);
		}
	}
}

// ── 6. Docs overclaim check ─────────────────────────────────────────────────

section("Docs overclaim check");

const docsToCheck = [
	"README.md",
	"INSTALL.md",
	"ROADMAP.md",
	"docs/INSTALL_MATRIX.md"
];

const riskyPatterns = [
	{ pattern: /supports\s+claude(?!\s+code\s+adapter)/i, claim: "supports Claude", requiredStatus: ["enforced", "wired"] },
	{ pattern: /supports\s+codex(?!\s+adapter)/i, claim: "supports Codex", requiredStatus: ["enforced", "wired"] },
	{ pattern: /supports\s+cursor(?!\s+adapter)/i, claim: "supports Cursor", requiredStatus: ["enforced", "wired"] },
	{ pattern: /(?<!no\s)(?<!not\s)opencode\s+adapter(?!\s+implementation)/i, claim: "OpenCode adapter (positive claim)", requiredStatus: ["enforced", "wired", "documented"] },
	{ pattern: /claude\s+enforced/i, claim: "Claude enforced", requiredStatus: ["enforced"] },
	{ pattern: /codex\s+enforced/i, claim: "Codex enforced", requiredStatus: ["enforced"] },
	{ pattern: /cursor\s+enforced/i, claim: "Cursor enforced", requiredStatus: ["enforced"] },
	{ pattern: /multi-agent\s+enforced/i, claim: "multi-agent enforced", requiredStatus: ["enforced"] },
	{ pattern: /adapter\s+wiring\s+complete/i, claim: "adapter wiring complete", requiredStatus: ["enforced"] }
];

for (const docPath of docsToCheck) {
	const fullPath = join(root, docPath);
	const text = safeReadText(fullPath);

	if (!text) {
		warn(`${docPath} exists`);
		continue;
	}

	for (const { pattern, claim, requiredStatus } of riskyPatterns) {
		if (pattern.test(text)) {
			const adapter = adapters.adapters.find(a => 
				claim.toLowerCase().includes(a.id) || claim.toLowerCase().includes(a.name.toLowerCase())
			);

			if (adapter && !requiredStatus.includes(adapter.status)) {
				fail(`${docPath} claims "${claim}" but adapter "${adapter.id}" status is "${adapter.status}" (required: ${requiredStatus.join(", ")})`);
			} else {
				pass(`${docPath} claim "${claim}" is consistent with adapter status`);
			}
		}
	}
}

// ── Summary ─────────────────────────────────────────────────────────────────

console.log("\n────────────────────────────────────────────────────────────");
console.log(`Results: ${passCount} passed, ${failCount} failed, ${warnCount} warnings`);
console.log("────────────────────────────────────────────────────────────\n");

if (failCount > 0) {
	console.error("❌ Adapter verification FAILED");
	process.exit(1);
}

if (warnCount > 0) {
	console.log("⚠️  Adapter verification passed with warnings");
} else {
	console.log("✅ Adapter verification PASSED");
}
