#!/usr/bin/env node
/**
 * Adversarial quality tests for Heli guard scripts.
 * Asserts deny on known-bad actions and allow on safe control cases.
 * Also records known gaps (bypass vectors) so claims stay honest.
 *
 * Usage: node scripts/quality-guard-strictness.mjs
 * Exit 0 only if all hard asserts pass.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const results = { hardPass: 0, hardFail: 0, softGaps: [] };

function hard(label, fn) {
	try {
		fn();
		results.hardPass++;
		console.log(`  ✅ HARD  ${label}`);
	} catch (err) {
		results.hardFail++;
		console.log(`  ❌ HARD  ${label}`);
		console.log(`         ${err.message}`);
	}
}

function gap(label, detail) {
	results.softGaps.push({ label, detail });
	console.log(`  ⚠️  GAP   ${label}`);
	console.log(`         ${detail}`);
}

function runHook(relScript, sample, cwd = root) {
	const result = spawnSync(process.execPath, [join(root, relScript)], {
		cwd,
		input: JSON.stringify(sample),
		encoding: "utf8",
		stdio: ["pipe", "pipe", "pipe"],
	});
	let body = {};
	try {
		body = result.stdout.trim() ? JSON.parse(result.stdout) : {};
	} catch {
		body = { _raw: result.stdout, _parseError: true };
	}
	return { status: result.status, body, stderr: result.stderr };
}

function isDenied(out) {
	const d = out.body?.decision;
	const p = out.body?.hookSpecificOutput?.permissionDecision;
	const reason =
		out.body?.reason ||
		out.body?.hookSpecificOutput?.permissionDecisionReason ||
		"";
	const denied =
		d === "deny" ||
		p === "deny" ||
		out.status === 2;
	return { denied, reason, status: out.status };
}

function expectDeny(rel, sample, pattern, cwd) {
	const out = runHook(rel, sample, cwd);
	const { denied, reason, status } = isDenied(out);
	assert.ok(denied, `expected deny, got status=${status} body=${JSON.stringify(out.body)}`);
	if (pattern) assert.match(reason, pattern);
}

function expectAllow(rel, sample, cwd) {
	const out = runHook(rel, sample, cwd);
	const { denied, reason, status } = isDenied(out);
	assert.ok(!denied, `expected allow, got deny: ${reason} status=${status}`);
}

const hooks = {
	claude: ".heli-harness/adapters/claude-plugin/hooks/heli-pre-tool-use.mjs",
	codex: ".heli-harness/adapters/codex-plugin/hooks/heli-pre-tool-use.mjs",
	grok: ".heli-harness/adapters/grok-plugin/hooks/heli-pre-tool-use.mjs",
	kimi: ".heli-harness/adapters/kimi-plugin/hooks/heli-pre-tool-use.mjs",
	antigravity: ".heli-harness/adapters/antigravity-plugin/hooks/heli-pre-tool-use.mjs",
};

// Prefer self-contained; antigravity may re-export shared
for (const [name, rel] of Object.entries(hooks)) {
	if (!existsSync(join(root, rel))) {
		console.log(`  skip missing ${name}: ${rel}`);
		delete hooks[name];
	}
}

console.log("\n▸ 1. git push — must deny (strict)\n");

const pushVariants = [
	{ tool_name: "Bash", tool_input: { command: "git push origin main" } },
	{ tool_name: "Bash", tool_input: { command: "  git   push  origin  main  " } },
	{ tool_name: "Bash", tool_input: { command: "GIT PUSH origin main" } },
	{ tool_name: "Bash", tool_input: { command: "git push --force origin main" } },
	{ tool_name: "Bash", tool_input: { command: "git push" } },
	{ tool_name: "Shell", tool_input: { command: "git push origin HEAD" } },
	{ tool_name: "run_command", tool_input: { command: "git push origin main" } },
	{ tool_name: "run_terminal_command", tool_input: { command: "git push origin main" } },
	// description field used by some hosts
	{ tool_name: "Bash", tool_input: { description: "git push origin main" } },
];

for (const [name, rel] of Object.entries(hooks)) {
	for (const sample of pushVariants) {
		hard(`${name}: deny push shape ${JSON.stringify(sample.tool_input).slice(0, 60)}`, () => {
			expectDeny(rel, sample, /git push/i);
		});
	}
}

console.log("\n▸ 2. .env writes — must deny\n");

const envVariants = [
	{ tool_name: "Write", tool_input: { file_path: ".env" } },
	{ tool_name: "Write", tool_input: { file_path: ".env.local" } },
	{ tool_name: "Write", tool_input: { path: "apps/api/.env" } },
	{ tool_name: "Edit", tool_input: { file_path: "foo/.env.production" } },
	{ tool_name: "WriteFile", tool_input: { file_path: ".env" } },
	{ tool_name: "write_to_file", tool_input: { file_path: ".env" } },
	{ tool_name: "apply_patch", tool_input: { command: "*** Begin Patch\n*** Add File: .env\n+X=1\n*** End Patch\n" } },
	{ tool_name: "Write", tool_input: { file_path: "C:\\proj\\.env" } },
];

for (const [name, rel] of Object.entries(hooks)) {
	for (const sample of envVariants) {
		hard(`${name}: deny env ${sample.tool_name} ${JSON.stringify(sample.tool_input).slice(0, 50)}`, () => {
			expectDeny(rel, sample, /\.env/i);
		});
	}
}

console.log("\n▸ 3. Stuck task gate — must deny writes\n");

const stuckDir = mkdtempSync(join(tmpdir(), "heli-strict-stuck-"));
mkdirSync(join(stuckDir, ".heli-harness", "state"), { recursive: true });
writeFileSync(join(stuckDir, ".heli-harness", "HARNESS.md"), "# Heli\n");
writeFileSync(
	join(stuckDir, ".heli-harness", "state", "current-task.md"),
	"# Current Task\n\nTarget repo: demo\n\nCurrent status: blocked\n\nFailed attempts count: 2\n",
);

for (const [name, rel] of Object.entries(hooks)) {
	hard(`${name}: stuck task blocks Write notes.txt`, () => {
		expectDeny(rel, { tool_name: "Write", tool_input: { file_path: "notes.txt" } }, /failed attempts/i, stuckDir);
	});
	hard(`${name}: stuck task allows updating current-task.md`, () => {
		expectAllow(rel, {
			tool_name: "Write",
			tool_input: { file_path: ".heli-harness/state/current-task.md" },
		}, stuckDir);
	});
}

console.log("\n▸ 4. Target mismatch gate — must deny writes\n");

const mismatchDir = mkdtempSync(join(tmpdir(), "heli-strict-mismatch-"));
mkdirSync(join(mismatchDir, ".heli-harness", "state"), { recursive: true });
mkdirSync(join(mismatchDir, ".heli-harness", "workspace"), { recursive: true });
writeFileSync(join(mismatchDir, ".heli-harness", "HARNESS.md"), "# Heli\n");
writeFileSync(
	join(mismatchDir, ".heli-harness", "state", "current-task.md"),
	"# Current Task\n\nTarget repo: repo-a\n\nCurrent status: in progress\n\nFailed attempts count: 0\n",
);
writeFileSync(
	join(mismatchDir, ".heli-harness", "workspace", "target.json"),
	JSON.stringify({ targetRepo: "repo-b" }),
);

for (const [name, rel] of Object.entries(hooks)) {
	hard(`${name}: target mismatch blocks Write`, () => {
		expectDeny(rel, { tool_name: "Write", tool_input: { file_path: "x.ts" } }, /target/i, mismatchDir);
	});
}

console.log("\n▸ 5. Safe controls — must allow\n");

const cleanDir = mkdtempSync(join(tmpdir(), "heli-strict-clean-"));
mkdirSync(join(cleanDir, ".heli-harness", "state"), { recursive: true });
mkdirSync(join(cleanDir, ".heli-harness", "workspace"), { recursive: true });
writeFileSync(join(cleanDir, ".heli-harness", "HARNESS.md"), "# Heli\n");
writeFileSync(
	join(cleanDir, ".heli-harness", "state", "current-task.md"),
	"# Current Task\n\nTarget repo: demo\n\nCurrent status: in progress\n\nFailed attempts count: 0\n",
);
writeFileSync(
	join(cleanDir, ".heli-harness", "workspace", "target.json"),
	JSON.stringify({ targetRepo: "demo" }),
);

for (const [name, rel] of Object.entries(hooks)) {
	hard(`${name}: allow git status`, () => {
		expectAllow(rel, { tool_name: "Bash", tool_input: { command: "git status" } }, cleanDir);
	});
	hard(`${name}: allow Write notes.txt when task healthy`, () => {
		expectAllow(rel, { tool_name: "Write", tool_input: { file_path: "notes.txt" } }, cleanDir);
	});
	hard(`${name}: allow npm test`, () => {
		expectAllow(rel, { tool_name: "Bash", tool_input: { command: "npm test" } }, cleanDir);
	});
}

console.log("\n▸ 6. Bypass probes (record gaps; fail only if claimed-strict vectors leak)\n");

// These should ideally deny but some may slip — document honestly.
const bypassProbes = [
	{
		label: "git via && chain after harmless cmd",
		sample: { tool_name: "Bash", tool_input: { command: "echo hi && git push origin main" } },
		shouldDeny: true,
		pattern: /git push/i,
	},
	{
		label: "git via ; separator",
		sample: { tool_name: "Bash", tool_input: { command: "pwd; git push origin main" } },
		shouldDeny: true,
		pattern: /git push/i,
	},
	{
		label: "git via pipe",
		sample: { tool_name: "Bash", tool_input: { command: "true | git push origin main" } },
		shouldDeny: true,
		pattern: /git push/i,
	},
	{
		label: "env via env.example (should ALLOW — not a secret file pattern .env)",
		sample: { tool_name: "Write", tool_input: { file_path: ".env.example" } },
		shouldDeny: true, // current regex: /(^|\/)\.env(\.|$)/  — .env.example MATCHES \.env\.
		pattern: /\.env/i,
		note: "current rules treat .env.example as blocked (strict)",
	},
	{
		label: "powershell git push",
		sample: { tool_name: "Bash", tool_input: { command: "powershell -Command \"git push origin main\"" } },
		shouldDeny: true,
		pattern: /git push/i,
	},
	{
		label: "bash -c git push",
		sample: { tool_name: "Bash", tool_input: { command: "bash -c 'git push origin main'" } },
		shouldDeny: true,
		pattern: /git push/i,
	},
	{
		label: "spaced g i t push (obfuscation — expected GAP)",
		sample: { tool_name: "Bash", tool_input: { command: "g it push origin main" } },
		shouldDeny: false,
		expectGap: true,
	},
	{
		label: "variable expansion obfuscation — expected GAP",
		sample: { tool_name: "Bash", tool_input: { command: "git$() push origin main" } },
		shouldDeny: false,
		expectGap: true,
	},
	{
		label: "ENV via ENV uppercase path — expected GAP if only lowercased .env",
		sample: { tool_name: "Write", tool_input: { file_path: ".ENV" } },
		shouldDeny: true, // paths are lowercased in hooks
		pattern: /\.env/i,
	},
];

for (const [name, rel] of Object.entries(hooks)) {
	for (const probe of bypassProbes) {
		const out = runHook(rel, probe.sample, cleanDir);
		const { denied, reason } = isDenied(out);
		if (probe.expectGap) {
			if (denied) {
				hard(`${name}: unexpected deny on obfuscation probe ${probe.label}`, () => {
					// if we deny obfuscation, even better — hard pass
				});
			} else {
				gap(`${name}: ${probe.label}`, "not denied — pattern-only guard can be obfuscated");
			}
			continue;
		}
		if (probe.shouldDeny) {
			hard(`${name}: ${probe.label}`, () => {
				assert.ok(denied, `expected deny, allowed. reason=${reason}`);
				if (probe.pattern) assert.match(reason || "denied", probe.pattern);
			});
		} else {
			hard(`${name}: allow ${probe.label}`, () => {
				assert.ok(!denied, `expected allow, denied: ${reason}`);
			});
		}
	}
}

console.log("\n▸ 7. OpenCode plugin API strictness\n");

const ocPath = join(root, ".heli-harness", "adapters", "opencode-plugin", "heli-harness.mjs");
if (existsSync(ocPath)) {
	const mod = await import(pathToFileURL(ocPath).href);
	const hooksApi = await mod.HeliHarness({ directory: cleanDir });
	hard("opencode: throws on git push", async () => {
		await assert.rejects(
			() => hooksApi["tool.execute.before"](
				{ tool: "bash" },
				{ args: { command: "git push origin main" } },
			),
			/git push/i,
		);
	});
	// top-level await style
	try {
		await hooksApi["tool.execute.before"](
			{ tool: "bash" },
			{ args: { command: "git push origin main" } },
		);
		results.hardFail++;
		console.log("  ❌ HARD  opencode: throws on git push (did not throw)");
	} catch (e) {
		if (/git push/i.test(String(e.message || e))) {
			results.hardPass++;
			console.log("  ✅ HARD  opencode: throws on git push");
		} else {
			results.hardFail++;
			console.log(`  ❌ HARD  opencode: throws on git push — wrong error: ${e}`);
		}
	}
	try {
		await hooksApi["tool.execute.before"](
			{ tool: "write" },
			{ args: { filePath: ".env" } },
		);
		results.hardFail++;
		console.log("  ❌ HARD  opencode: throws on .env write (did not throw)");
	} catch (e) {
		if (/\.env/i.test(String(e.message || e))) {
			results.hardPass++;
			console.log("  ✅ HARD  opencode: throws on .env write");
		} else {
			results.hardFail++;
			console.log(`  ❌ HARD  opencode: throws on .env write — ${e}`);
		}
	}
	try {
		await hooksApi["tool.execute.before"](
			{ tool: "bash" },
			{ args: { command: "git status" } },
		);
		results.hardPass++;
		console.log("  ✅ HARD  opencode: allows git status");
	} catch (e) {
		results.hardFail++;
		console.log(`  ❌ HARD  opencode: allows git status — ${e}`);
	}

	const stuckHooks = await mod.HeliHarness({ directory: stuckDir });
	try {
		await stuckHooks["tool.execute.before"](
			{ tool: "write" },
			{ args: { filePath: "x.ts" } },
		);
		results.hardFail++;
		console.log("  ❌ HARD  opencode: stuck task blocks write (did not throw)");
	} catch (e) {
		if (/failed attempts/i.test(String(e.message || e))) {
			results.hardPass++;
			console.log("  ✅ HARD  opencode: stuck task blocks write");
		} else {
			results.hardFail++;
			console.log(`  ❌ HARD  opencode: stuck task blocks write — ${e}`);
		}
	}
}

// cleanup fixtures
for (const d of [stuckDir, mismatchDir, cleanDir]) {
	try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log("\n────────────────────────────────────────────────────────────");
console.log(`HARD: ${results.hardPass} passed, ${results.hardFail} failed`);
console.log(`GAPS (known soft): ${results.softGaps.length}`);
for (const g of results.softGaps) {
	console.log(`  - ${g.label}: ${g.detail}`);
}
console.log("────────────────────────────────────────────────────────────\n");

if (results.hardFail > 0) {
	console.error("❌ quality-guard-strictness FAILED");
	process.exit(1);
}
console.log("✅ quality-guard-strictness PASSED (hard asserts)");
console.log("Note: gaps listed above are intentional honesty about pattern-only limits.");
process.exit(0);
