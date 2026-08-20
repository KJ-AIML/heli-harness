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

console.log("\n▸ Concurrent fail-closed gates — corrupt state and control-plane writes must deny\n");

const healthyState =
	"# Current Task\n\nTarget repo: demo\n\nCurrent status: in progress\n\nFailed attempts count: 0\n";
const validTask = JSON.stringify({
	schemaVersion: 1,
	taskId: "t1",
	status: "active",
	mode: "strict",
	revision: 1,
	target: { repositoryId: "demo" },
});

function makeConcurrentDir(prefix, { schemaContent, taskContent } = {}) {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	mkdirSync(join(dir, ".heli-harness", "state"), { recursive: true });
	mkdirSync(join(dir, ".heli-harness", "workspace"), { recursive: true });
	writeFileSync(join(dir, ".heli-harness", "HARNESS.md"), "# Heli\n");
	writeFileSync(join(dir, ".heli-harness", "state", "current-task.md"), healthyState);
	writeFileSync(join(dir, ".heli-harness", "workspace", "target.json"), JSON.stringify({ targetRepo: "demo" }));
	if (schemaContent != null) {
		writeFileSync(join(dir, ".heli-harness", "workspace", "schema.json"), schemaContent);
	}
	if (taskContent != null) {
		mkdirSync(join(dir, ".heli-harness", "tasks", "t1"), { recursive: true });
		writeFileSync(join(dir, ".heli-harness", "tasks", "t1", "task.json"), taskContent);
	}
	return dir;
}

// Corrupt schema.json must fail closed (concurrent + gate), not fall back to legacy.
const corruptSchemaDir = makeConcurrentDir("heli-strict-corrupt-schema-", {
	schemaContent: "{not json",
	taskContent: validTask,
});
// Corrupt task.json must not re-open zero-task bootstrap.
const corruptTaskDir = makeConcurrentDir("heli-strict-corrupt-task-", {
	schemaContent: JSON.stringify({ schemaVersion: 1, mode: "concurrent" }),
	taskContent: "{not json",
});
// Valid concurrent workspace for control-plane write probes.
const controlPlaneDir = makeConcurrentDir("heli-strict-control-plane-", {
	schemaContent: JSON.stringify({ schemaVersion: 1, mode: "concurrent" }),
	taskContent: validTask,
});
// Zero-task workspace: bootstrap writes must STILL be allowed.
const bootstrapDir = makeConcurrentDir("heli-strict-bootstrap-", {
	schemaContent: JSON.stringify({ schemaVersion: 1, mode: "concurrent" }),
});

for (const [name, rel] of Object.entries(hooks)) {
	hard(`${name}: planning tool is allowed without a write lease`, () => {
		expectAllow(rel, {
			tool_name: "todo_write",
			tool_input: { todos: [{ content: "inspect", status: "pending" }] },
		}, controlPlaneDir);
	});
	hard(`${name}: file writer still requires a write lease`, () => {
		expectDeny(
			rel,
			{ tool_name: "Write", tool_input: { file_path: "src/x.ts" } },
			/session|lease|bound|mode/i,
			controlPlaneDir,
		);
	});
}

const controlPlaneProbes = [
	{ label: "self-granted lease", file_path: ".heli-harness/locks/tasks/t1.write.lock/lease.json" },
	{ label: "session rebind", file_path: ".heli-harness/sessions/heli-ses-fake.json" },
	{ label: "mode flip", file_path: ".heli-harness/workspace/schema.json" },
	{ label: "binding forge", file_path: ".heli-harness/bindings/worktrees/abc.json" },
];

for (const [name, rel] of Object.entries(hooks)) {
	hard(`${name}: corrupt schema.json fails closed (denies unbound write)`, () => {
		expectDeny(rel, { tool_name: "Write", tool_input: { file_path: "src/x.ts" } }, /session/i, corruptSchemaDir);
	});
	hard(`${name}: corrupt task.json does not re-open bootstrap`, () => {
		expectDeny(rel, { tool_name: "Write", tool_input: { file_path: "src/x.ts" } }, /session/i, corruptTaskDir);
	});
	for (const probe of controlPlaneProbes) {
		hard(`${name}: control-plane write denied (${probe.label})`, () => {
			expectDeny(rel, { tool_name: "Write", tool_input: { file_path: probe.file_path } }, /session/i, controlPlaneDir);
		});
	}
	hard(`${name}: zero-task bootstrap write still allowed`, () => {
		expectAllow(rel, { tool_name: "Write", tool_input: { file_path: "src/x.ts" } }, bootstrapDir);
	});
	hard(`${name}: task-state markdown write still allowed unbound`, () => {
		expectAllow(rel, {
			tool_name: "Write",
			tool_input: { file_path: ".heli-harness/state/current-task.md" },
		}, controlPlaneDir);
	});
}

const concurrentOpenCodePath = join(root, ".heli-harness", "adapters", "opencode-plugin", "heli-harness.mjs");
if (existsSync(concurrentOpenCodePath)) {
	console.log("\n▸ OpenCode concurrent planning classification\n");
	const concurrentOpenCode = await import(pathToFileURL(concurrentOpenCodePath).href);
	const concurrentOpenCodeHooks = await concurrentOpenCode.HeliHarness({ directory: controlPlaneDir });
	try {
		await concurrentOpenCodeHooks["tool.execute.before"](
			{ tool: "todo_write" },
			{ args: { todos: [{ content: "inspect", status: "pending" }] } },
		);
		results.hardPass++;
		console.log("  ✅ HARD  opencode: planning tool is allowed without a write lease");
	} catch (e) {
		results.hardFail++;
		console.log(`  ❌ HARD  opencode: planning tool is allowed without a write lease — ${e}`);
	}
	try {
		await concurrentOpenCodeHooks["tool.execute.before"](
			{ tool: "write" },
			{ args: { filePath: "src/x.ts" } },
		);
		results.hardFail++;
		console.log("  ❌ HARD  opencode: file writer still requires a write lease (did not throw)");
	} catch (e) {
		if (/session|lease|bound|mode/i.test(String(e.message || e))) {
			results.hardPass++;
			console.log("  ✅ HARD  opencode: file writer still requires a write lease");
		} else {
			results.hardFail++;
			console.log(`  ❌ HARD  opencode: file writer still requires a write lease — ${e}`);
		}
	}
}

console.log("\n▸ Command-tier rules — T5/T6 must deny, safe commands and approvals allowed\n");

const tierDir = makeConcurrentDir("heli-strict-tier-", {
	schemaContent: JSON.stringify({ schemaVersion: 1, mode: "concurrent" }),
});
mkdirSync(join(tierDir, ".heli-harness", "safety"), { recursive: true });
writeFileSync(
	join(tierDir, ".heli-harness", "safety", "command-rules.json"),
	JSON.stringify({
		version: 1,
		rules: [
			{ id: "destructive-delete", match: "rm -rf", tier: "T6", reason: "Recursive delete is destructive" },
			{ id: "npm-publish", match: "npm publish", tier: "T5", reason: "Publish is a release operation" },
			{ id: "git-reset-hard", match: "git reset --hard", tier: "T6", reason: "Destructive" },
			{ id: "advisory-only", match: "npm run e2e", tier: "T4", reason: "advisory tier must not deny" },
			// distinct id (not "git-push") so the generic tier matcher — not the dedicated
			// git push check — is what these token-matching cases exercise
			{ id: "git-push-tier", match: "git push", tier: "T5", reason: "Remote git writes need explicit approval" },
			// program-position rule: exercises path-suffix matching (`node .../heli.mjs push`)
			{ id: "heli-cli-push", match: "heli.mjs push", tier: "T5", reason: "Heli CLI push needs explicit approval" },
		],
	}),
);

function runHookEnv(relScript, sample, cwd, env) {
	const result = spawnSync(process.execPath, [join(root, relScript)], {
		cwd,
		input: JSON.stringify(sample),
		encoding: "utf8",
		env: { ...process.env, ...env },
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

for (const [name, rel] of Object.entries(hooks)) {
	hard(`${name}: T6 rm -rf denied`, () => {
		expectDeny(rel, { tool_name: "Bash", tool_input: { command: "rm -rf build" } }, /destructive/i, tierDir);
	});
	hard(`${name}: T6 git reset --hard denied`, () => {
		expectDeny(rel, { tool_name: "Bash", tool_input: { command: "git reset --hard origin/main" } }, /tier t6/i, tierDir);
	});
	hard(`${name}: T5 npm publish denied with approval hint`, () => {
		expectDeny(rel, { tool_name: "Bash", tool_input: { command: "npm publish" } }, /HELI_ALLOW_COMMAND=npm-publish/i, tierDir);
	});
	hard(`${name}: T4 advisory tier does not deny`, () => {
		const out = runHookEnv(rel, { tool_name: "Bash", tool_input: { command: "npm run e2e" } }, tierDir, {});
		const { denied, reason } = isDenied(out);
		assert.ok(!denied, `T4 must stay advisory, got deny: ${reason}`);
	});
	hard(`${name}: HELI_ALLOW_COMMAND approves the named rule`, () => {
		const out = runHookEnv(
			rel,
			{ tool_name: "Bash", tool_input: { command: "npm publish" } },
			tierDir,
			{ HELI_ALLOW_COMMAND: "npm-publish" },
		);
		const { denied, reason } = isDenied(out);
		assert.ok(!denied, `approved rule must allow, got deny: ${reason}`);
	});
	hard(`${name}: safe command allowed in tier workspace`, () => {
		expectAllow(rel, { tool_name: "Bash", tool_input: { command: "git status" } }, tierDir);
	});
	// token-sequence matching: whitespace/case evasion must not slip past a tier rule
	hard(`${name}: double-space "git  push" denied`, () => {
		expectDeny(rel, { tool_name: "Bash", tool_input: { command: "git  push origin main" } }, /git push/i, tierDir);
	});
	hard(`${name}: tab-separated "git\\tpush" denied`, () => {
		expectDeny(rel, { tool_name: "Bash", tool_input: { command: "git\tpush origin main" } }, /git push/i, tierDir);
	});
	hard(`${name}: uppercase "GIT PUSH" denied`, () => {
		expectDeny(rel, { tool_name: "Bash", tool_input: { command: "GIT PUSH origin main" } }, /git push/i, tierDir);
	});
	hard(`${name}: newline-separated "git\\npush" denied`, () => {
		expectDeny(rel, { tool_name: "Bash", tool_input: { command: "git\npush origin main" } }, /git push/i, tierDir);
	});
	hard(`${name}: T6 tab-separated "rm\\t-rf" denied`, () => {
		expectDeny(rel, { tool_name: "Bash", tool_input: { command: "rm\t-rf   build" } }, /destructive/i, tierDir);
	});
	// false-positive regression: substring "git push" lives inside "digit pushups"
	hard(`${name}: "echo digit pushups" allowed (substring false positive)`, () => {
		expectAllow(rel, { tool_name: "Bash", tool_input: { command: "echo digit pushups" } }, tierDir);
	});
	hard(`${name}: "echo npm publisher notes" allowed (substring false positive)`, () => {
		expectAllow(rel, { tool_name: "Bash", tool_input: { command: "echo npm publisher notes" } }, tierDir);
	});
	// separator-glued tokens: `;`, `&`, `|`, `(`, `)` must act as token boundaries,
	// otherwise "push;echo" is not the token "push" and the rule never fires
	hard(`${name}: semicolon-chained "git push;echo hi" denied`, () => {
		expectDeny(rel, { tool_name: "Bash", tool_input: { command: "git push;echo hi" } }, /git push/i, tierDir);
	});
	hard(`${name}: trailing-semicolon "git push;" denied`, () => {
		expectDeny(rel, { tool_name: "Bash", tool_input: { command: "git push;" } }, /git push/i, tierDir);
	});
	hard(`${name}: piped "git push|cat" denied`, () => {
		expectDeny(rel, { tool_name: "Bash", tool_input: { command: "git push|cat" } }, /git push/i, tierDir);
	});
	hard(`${name}: and-chained "git push&&echo ok" denied`, () => {
		expectDeny(rel, { tool_name: "Bash", tool_input: { command: "git push&&echo ok" } }, /git push/i, tierDir);
	});
	// separator boundary on a NON-git rule: proves the tier matcher (not the dedicated
	// git-push regex) is what closes the glued-separator hole
	hard(`${name}: semicolon-chained "npm publish;echo done" denied by tier rule`, () => {
		expectDeny(
			rel,
			{ tool_name: "Bash", tool_input: { command: "npm publish;echo done" } },
			/HELI_ALLOW_COMMAND=npm-publish/i,
			tierDir,
		);
	});
	// quoted tokens never match the \bgit\s+push\b fast path, so only quote-stripped
	// token matching can catch this shape
	hard(`${name}: quoted tokens '"git" "push"' denied by tier rule`, () => {
		expectDeny(
			rel,
			{ tool_name: "Bash", tool_input: { command: '"git" "push" origin main' } },
			/HELI_ALLOW_COMMAND=git-push-tier/i,
			tierDir,
		);
	});
	// program-position path-suffix matching still works, including through quotes
	hard(`${name}: "node .heli-harness/heli.mjs push" denied`, () => {
		expectDeny(
			rel,
			{ tool_name: "Bash", tool_input: { command: "node .heli-harness/heli.mjs push" } },
			/HELI_ALLOW_COMMAND=heli-cli-push/i,
			tierDir,
		);
	});
	hard(`${name}: quoted path '"C:\\tools\\heli.mjs" push' denied`, () => {
		expectDeny(
			rel,
			{ tool_name: "Bash", tool_input: { command: '"C:\\tools\\heli.mjs" push' } },
			/HELI_ALLOW_COMMAND=heli-cli-push/i,
			tierDir,
		);
	});
	// overreach guards: separator splitting and quote stripping must not fabricate a match
	hard(`${name}: 'echo "digit pushups"' allowed (quote strip must not merge words)`, () => {
		expectAllow(rel, { tool_name: "Bash", tool_input: { command: 'echo "digit pushups"' } }, tierDir);
	});
	// tokens across the pipe are [getprop, grep, push] — no "git" token at all, and
	// "push" alone is not the consecutive [git, push] pair the rule requires
	hard(`${name}: "getprop | grep push" allowed (no git token)`, () => {
		expectAllow(rel, { tool_name: "Bash", tool_input: { command: "getprop | grep push" } }, tierDir);
	});
}

gap(
	"command-tier rules: variable-indirection evasion accepted",
	"token-sequence matching closes whitespace/case evasion and substring false positives, but a command that never spells the rule literally (shell variable indirection like G=push; git $G, base64 -d | sh, or a shell alias) still evades every tier rule; accepted — the documented contract is best-effort command guarding, not a sandbox",
);

gap(
	"lease holder can still write control-plane files",
	"a bound write-mode session holding the lease passes the ownership gate and could hand-edit its own lease/schema; acceptable for the trusted writer, recorded for honesty",
);

// cleanup fixtures
for (const d of [stuckDir, mismatchDir, cleanDir, corruptSchemaDir, corruptTaskDir, controlPlaneDir, bootstrapDir, tierDir]) {
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
