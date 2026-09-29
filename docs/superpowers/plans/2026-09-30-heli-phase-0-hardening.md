# Heli-Harness Phase 0 Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Heli's PreToolUse governance fail closed and impossible for the governed agent to switch off or self-approve, cover Claude Code's Windows tools, harden experimental cloud sync, make the test suite hermetic, and prepare release v0.10.4.

**Architecture:** All enforcement stays in the shared kernel `.heli-harness/adapters/shared/` (synced into every plugin copy). A new `command-policy.mjs` parses shell text and evaluates every rule against a non-removable built-in T6 floor; a new `concurrency/protected-paths.mjs` normalizes paths and classifies Heli's own state; `hook-core.mjs#evaluatePreToolUse` is restructured into hard-deny → ownership → diagnosis → YOLO → approval (find grants read-only) → gates → consume grants. Host wrappers print a decision first and deny on any error. The CLI refuses `heli grant issue` / `heli yolo on` without a human terminal.

**Tech Stack:** Node.js ≥20 ES modules (`.mjs`), zero npm dependencies (`node:` built-ins only), plain `node scripts/*.mjs` smoke tests using `node:assert/strict`, chained by `npm run check`.

**Spec:** `docs/reports/2026-09-30-heli-full-review.md` (Improvement plan → Phase 0; top findings 1–6, 11, 12). Design decisions the review left open are fixed in this plan's Global Constraints and task text.

## Global Constraints

- Repo: `D:\KJ\repo\heli-harness`, branch `hardening/phase-0`. Do not switch branches, do not push, do not tag, do not publish.
- Platforms: CI runs Node 20 and 22 on `ubuntu-latest` and `windows-latest`; local dev is Windows 11 with Node 24, Git Bash + PowerShell. Every test must pass on both OSes.
- Code style: zero npm dependencies, ES modules (`.mjs`), tabs, double quotes, semicolons, `node:` imports only.
- Canonical sources vs generated copies — edit canonical only, then regenerate:
  - Kernel `.heli-harness/adapters/shared/**` → every `.heli-harness/adapters/<host>-plugin/shared/` copy: `node scripts/sync-plugin-shared.mjs`.
  - CLI `bin/heli.mjs`, `lib/cli/*.mjs`, `lib/protocol/*.mjs` → `.heli-harness/heli.mjs`, `.heli-harness/cli/`, `.heli-harness/protocol/`: `node scripts/sync-workspace-cli.mjs`.
  - Skills `.heli-harness/skills/` → plugin skill copies: `node scripts/sync-plugin-skills.mjs`.
  - Every commit must pass all three with `--check`.
- `lib/concurrency/*.mjs` are one-line re-exports of `.heli-harness/adapters/shared/concurrency/*.mjs`; `export *` means new exports appear automatically.
- **DANGER — test safety.** `scripts/smoke-integration-migration.mjs` calls `removeHost(grok)` and `lib/cli/host.mjs` `step()`/`run()` drop the caller's env, so before Task 1 `npm run check` runs the REAL `grok plugin uninstall heli-harness` (claude, codex, grok, kimi, pi, opencode, cursor CLIs are installed on the dev machine). **Until Task 1 is committed, nobody may run `npm run check` or `node scripts/smoke-integration-migration.mjs`.**
- A stray user-level `HELI_SESSION_ID` exists in the dev environment. Every test command in this plan starts with `unset HELI_SESSION_ID` (Git Bash; the plan's commands are written for the Bash tool).
- `node scripts/smoke-portable-targets.mjs` fails locally with `EPERM ... symlink` because this machine cannot create symlinks. That is the only acceptable failure.
- `npm run check` stops at the first failure, so use this runner for full regressions (runs every step, then exits 0 only if nothing but smoke-portable-targets failed; takes ~4 minutes — use a 600000 ms timeout):

  ```bash
  unset HELI_SESSION_ID; node -e 'const {execSync}=require("child_process"); const steps=require("./package.json").scripts.check.split("&&").map((s)=>s.trim()); const failed=[]; for (const step of steps) { try { execSync(step, { stdio: "pipe" }); console.log("PASS", step); } catch (e) { failed.push(step); console.log("FAIL", step); console.log(String(e.stdout || "").slice(-2000)); console.log(String(e.stderr || "").slice(-2000)); } } console.log("FAILED:", JSON.stringify(failed)); process.exit(failed.some((s) => !s.includes("smoke-portable-targets")) ? 1 : 0);'
  ```

  Expected final line on this machine: `FAILED: ["node scripts/smoke-portable-targets.mjs"]`.
- Write file contents with the Write/Edit tools, not shell heredocs: the Bash tool collapses backslashes inside heredocs and silently corrupts regexes and `\n` escapes.
- Files in this repo are checked out with CRLF (`core.autocrlf=true`); the Edit tool preserves line endings. New files may be written with LF.
- Line numbers in this plan refer to each file as it was at commit `a80aff2` (or as the previous task left it). Once a step inserts lines, later numbers in the same file shift: always match on the quoted text, and use the numbers only to find the right area.
- New test scripts must be added to the `check` chain in `package.json` (exact insertion points are given per task).
- Commits: conventional commits (`fix:`, `test:`, `docs:`, `chore(release):`). Every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (use a final `-m` paragraph).
- Do not write the string `0.10.4` anywhere except `CHANGELOG.md` and the files `scripts/release.mjs` rewrites: Task 7 adds a test that fails when a tracked file names the current version but is not bumped by the release script.
- Heli is a guardrail, not a sandbox. Docs must not claim containment beyond what tests prove.
- Deny-reason contracts shared across tasks (tests match these substrings):
  - fail closed: ``Heli-Harness could not evaluate this action (<code>: <message>); denying (fail-closed). Run `heli doctor`.``
  - T6: `Heli-Harness blocks <kind> "<summary>" (rule <id>, tier T6): <reason>. This is a hard deny; scoped grants, YOLO and HELI_ALLOW_COMMAND do not override it.`
  - T5: `... (rule <id>, tier T5) ... HELI_ALLOW_COMMAND=<id> or YOLO.`
  - protected state: `Heli-Harness protects its own authority state: ...`; privileged commands contain `human in their own terminal`.

## Review Focus

1. **Owner narrative writes stay allowed** — after protected-state hardening, the task owner writing `tasks/<id>/current-task.md`, `plan.md`, `reports/**` or `state/current-task.md` must still be allowed. Pinned in Task 4 (`smoke-self-protection.mjs`, section 4).
2. **Legitimate commands stay allowed** — `rm -f build.log`, `rm -r build`, `git clean -n`, `Remove-Item file.txt`, `find . -name '*.pyc' -delete`, and `git push` with a valid grant. Pinned in Task 3 (`smoke-command-rules.mjs`) and, for PowerShell through the real Claude wrapper, Task 5.
3. **No false denials after fail-closed** — normal Write and Bash calls in a healthy workspace must be allowed by every wrapper. Pinned in Task 2 (`smoke-hook-fail-closed.mjs`).
4. **A repo with no Heli binding must not start denying everything** — ordinary commands and edits allowed, only the built-in T6 floor applies. Pinned in Task 3 (`smoke-command-rules.mjs`).
5. **Path-spelling tricks on protected state** — Windows casing, `..`, junction/symlink, `name:stream` and `\\?\` forms must all be denied. Pinned in Task 4 (`smoke-self-protection.mjs`, section 4).

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `scripts/lib/fake-host-cli.mjs` (new) | Fake host CLI: logs argv, prints canned output | 1 |
| `scripts/lib/hermetic-env.mjs` (new) | Temp home + fake-bin PATH env for host-lifecycle tests | 1 |
| `scripts/smoke-host-env-isolation.mjs` (new) | Proves every host CLI call receives the caller env | 1 |
| `lib/cli/host.mjs` | Pass `env` to every `run()` | 1 |
| `.heli-harness/adapters/shared/concurrency/grant.mjs` | No directory creation on grant lookups; `findUsableGrant` | 1, 3 |
| `.heli-harness/adapters/shared/claude-style-pre-tool-use.mjs`, `grok-style-pre-tool-use.mjs` | Fail-closed wrappers | 2 |
| `.heli-harness/adapters/shared/concurrency/fs-atomic.mjs` | `renameWithRetry`, no delete-then-rename | 2 |
| Hook configs (Claude/Codex/Grok/Kimi/Antigravity) | 30 s PreToolUse timeouts, Codex node-missing deny | 2 |
| `.heli-harness/adapters/shared/command-policy.mjs` (new) | Command parsing, built-in floor, rule evaluation, shell write targets | 3, 4 |
| `.heli-harness/adapters/shared/hook-core.mjs` | Restructured `evaluatePreToolUse` | 3, 4, 5 |
| `.heli-harness/adapters/shared/concurrency/protected-paths.mjs` (new) | Path normalization + Heli state classification | 4 |
| `lib/cli/human-gate.mjs` (new) | TTY gate for `grant issue` / `yolo on` | 4 |
| `cloud/core.mjs`, `lib/cli/cloud-bundle.mjs`, `lib/cli/cloud.mjs` | Activation CSRF fix, bound E2E, pull guards, clone validation | 6 |
| `scripts/lib/release-version.mjs`, `scripts/release.mjs`, `.github/workflows/release.yml` | Complete version list, `--prepare-only`, fail on missing NPM_TOKEN | 7 |

## Dependency order

Task 1 first and alone (commit it before anything else runs the suite). Then Tasks 2 → 3 → 4 → 5 strictly in order (they edit the same kernel files and `package.json`). Task 6 touches only cloud files, `bin/heli.mjs`, `docs/architecture/cloud-sync.md`, `scripts/smoke-cloud-sync.mjs` and the generated `.heli-harness/heli.mjs` / `.heli-harness/cli/cloud*.mjs` copies, so it can run in parallel with Tasks 2–5 once Task 1 is committed — but only in its own git worktree (on a temporary branch created from `hardening/phase-0` by the controller, merged back into `hardening/phase-0` afterwards). Never run it concurrently in the same working tree: Task 4 commits with `git add .heli-harness`, which would sweep up Task 6's regenerated files. After merging, run `node scripts/sync-workspace-cli.mjs --check`. Without a separate worktree, run Task 6 after Task 5. Task 7 after Tasks 1–6. Task 8 last.

---

### Task 1: Hermetic host-lifecycle tests (must be first)

**Files:**
- Create: `scripts/lib/fake-host-cli.mjs`
- Create: `scripts/lib/hermetic-env.mjs`
- Create: `scripts/smoke-host-env-isolation.mjs`
- Modify: `lib/cli/host.mjs:179`, `:183`, `:187`, `:245-246`, `:394-397`
- Modify: `.heli-harness/adapters/shared/concurrency/grant.mjs:218-220` (`consumeApplicableGrant`)
- Modify: `scripts/smoke-scoped-grants.mjs:3`, `:8-11`, `:40-41`
- Modify: `scripts/smoke-host-manager.mjs:13-19`, `:113`, `:124`
- Modify (full rewrite): `scripts/smoke-integration-migration.mjs`
- Modify: `scripts/smoke-convergence-authority.mjs:10-13`
- Modify: `package.json` (`scripts.check`)
- Generated: `.heli-harness/cli/host.mjs`, `.heli-harness/adapters/*-plugin/shared/concurrency/grant.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Tasks 2–6 tests):
  - `scripts/lib/hermetic-env.mjs`: `FAKE_HOST_NAMES: readonly string[]`; `scrubHeliProcessEnv(): void` (deletes every `HELI_*` key from `process.env`); `createHermeticEnv({ prefix?: string, hosts?: readonly string[] })` → `{ root, home, fakeBin, logPath, env, readLog(): Array<{ host: string, args: string[] }>, setResponse(key: string, response: { stdout?, stderr?, status? }): void, applyToProcess(): () => void, assertFakeResolution(host: string): void, cleanup(): void }`.
  - `consumeApplicableGrant(...)` returns `null` without touching the filesystem when no grant matches.

- [ ] **Step 1: Create the fake host CLI**

Create `scripts/lib/fake-host-cli.mjs`:

```js
#!/usr/bin/env node
/**
 * Fake host CLI used by hermetic tests (see scripts/lib/hermetic-env.mjs).
 *
 * Invoked by generated shims as: node fake-host-cli.mjs <host> [args...]
 * Appends one JSON line { host, args } to $HELI_FAKE_HOST_LOG, then prints the
 * canned response for "<host> <args joined by space>" from the JSON file at
 * $HELI_FAKE_HOST_RESPONSES (or a harmless default) and exits with its status.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const [host = "unknown", ...args] = process.argv.slice(2);
const logPath = process.env.HELI_FAKE_HOST_LOG;
if (logPath) appendFileSync(logPath, `${JSON.stringify({ host, args })}\n`, "utf8");

let responses = {};
const responsesPath = process.env.HELI_FAKE_HOST_RESPONSES;
if (responsesPath && existsSync(responsesPath)) {
	try {
		responses = JSON.parse(readFileSync(responsesPath, "utf8"));
	} catch {
		responses = {};
	}
}

const key = [host, ...args].join(" ");
const fallback = args[0] === "--version"
	? { stdout: `${host} 0.0.0-fake\n`, status: 0 }
	: key === "claude plugin list --json"
		? { stdout: "[]\n", status: 0 }
		: { stdout: "", status: 0 };
const response = { ...fallback, ...(responses[key] || {}) };
if (response.stdout) process.stdout.write(response.stdout);
if (response.stderr) process.stderr.write(response.stderr);
process.exit(Number.isInteger(response.status) ? response.status : 0);
```

- [ ] **Step 2: Create the hermetic environment helper**

Create `scripts/lib/hermetic-env.mjs`:

```js
/**
 * Hermetic environment for tests that exercise host lifecycle code.
 *
 * lib/cli/host.mjs spawns real host CLIs (claude, codex, grok, ...). Tests must
 * never reach the developer's real CLIs or real home directory, so this helper
 * builds an environment from scratch:
 *   - HOME/USERPROFILE/APPDATA/LOCALAPPDATA and every Heli/host config dir point
 *     inside a fresh temp directory;
 *   - no HELI_* variable leaks in from the parent process (HELI_SESSION_ID etc.);
 *   - PATH = fake-bin (a shim for every host CLI) + node's own dir + the system
 *     dirs cmd.exe / sh need. Each shim appends its argv to a log file so a test
 *     can prove which host commands ran.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const FAKE_HOST_NAMES = Object.freeze([
	"claude",
	"codex",
	"grok",
	"kimi",
	"pi",
	"axga",
	"opencode",
	"cursor",
	"antigravity",
]);

const FAKE_HOST_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "fake-host-cli.mjs");
const LOG_KEYS = new Set(["HELI_FAKE_HOST_LOG", "HELI_FAKE_HOST_RESPONSES"]);
const WINDOWS_PASSTHROUGH = ["SystemRoot", "SystemDrive", "windir", "ComSpec", "PATHEXT", "OS", "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS"];

function systemPathDirs() {
	if (process.platform === "win32") {
		const systemRoot = process.env.SystemRoot || "C:\\Windows";
		return [
			join(systemRoot, "System32"),
			systemRoot,
			join(systemRoot, "System32", "Wbem"),
			join(systemRoot, "System32", "WindowsPowerShell", "v1.0"),
		];
	}
	return ["/usr/bin", "/bin"];
}

function writeShim(fakeBin, host) {
	if (process.platform === "win32") {
		const shim = join(fakeBin, `${host}.cmd`);
		writeFileSync(shim, `@echo off\r\n"${process.execPath}" "${FAKE_HOST_SCRIPT}" ${host} %*\r\nexit /b %ERRORLEVEL%\r\n`, "utf8");
		return shim;
	}
	const shim = join(fakeBin, host);
	writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${FAKE_HOST_SCRIPT}" ${host} "$@"\n`, "utf8");
	chmodSync(shim, 0o755);
	return shim;
}

/** Remove every HELI_* variable from process.env (for in-process kernel tests). */
export function scrubHeliProcessEnv() {
	for (const key of Object.keys(process.env)) {
		if (key.toUpperCase().startsWith("HELI_")) delete process.env[key];
	}
}

/**
 * @param {{ prefix?: string, hosts?: readonly string[] }} [options]
 */
export function createHermeticEnv({ prefix = "heli-hermetic-", hosts = FAKE_HOST_NAMES } = {}) {
	const root = mkdtempSync(join(tmpdir(), prefix));
	const home = join(root, "home");
	const fakeBin = join(root, "fake-bin");
	const tempDir = join(root, "tmp");
	const logPath = join(root, "fake-host-calls.jsonl");
	const responsesPath = join(root, "fake-host-responses.json");
	for (const dir of [home, fakeBin, tempDir, join(home, "AppData", "Roaming"), join(home, "AppData", "Local"), join(home, ".config")]) {
		mkdirSync(dir, { recursive: true });
	}
	writeFileSync(logPath, "", "utf8");
	writeFileSync(responsesPath, "{}\n", "utf8");
	for (const host of hosts) writeShim(fakeBin, host);

	const env = {};
	if (process.platform === "win32") {
		for (const key of WINDOWS_PASSTHROUGH) if (process.env[key]) env[key] = process.env[key];
	}
	for (const key of ["LANG", "LC_ALL", "TERM"]) if (process.env[key]) env[key] = process.env[key];
	Object.assign(env, {
		PATH: [fakeBin, dirname(process.execPath), ...systemPathDirs()].join(delimiter),
		HOME: home,
		USERPROFILE: home,
		APPDATA: join(home, "AppData", "Roaming"),
		LOCALAPPDATA: join(home, "AppData", "Local"),
		XDG_CONFIG_HOME: join(home, ".config"),
		TEMP: tempDir,
		TMP: tempDir,
		TMPDIR: tempDir,
		HELI_HOST_HOME: home,
		HELI_CONFIG_DIR: join(home, ".heli"),
		HELI_DATA_DIR: join(home, ".heli-data"),
		CLAUDE_CONFIG_DIR: join(home, ".claude"),
		CODEX_HOME: join(home, ".codex"),
		KIMI_CODE_HOME: join(home, ".kimi-code"),
		HELI_FAKE_HOST_LOG: logPath,
		HELI_FAKE_HOST_RESPONSES: responsesPath,
	});

	return {
		root,
		home,
		fakeBin,
		logPath,
		env,
		/** @returns {Array<{ host: string, args: string[] }>} */
		readLog() {
			if (!existsSync(logPath)) return [];
			return readFileSync(logPath, "utf8")
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line));
		},
		/** Canned output for one exact command line, e.g. "claude plugin list --json". */
		setResponse(key, response) {
			const current = JSON.parse(readFileSync(responsesPath, "utf8"));
			current[key] = response;
			writeFileSync(responsesPath, `${JSON.stringify(current, null, 2)}\n`, "utf8");
		},
		/**
		 * Point this process's PATH/HOME/config vars at the hermetic values too, so a
		 * host call that forgets to forward `env` still reaches a fake CLI. The fake-log
		 * variables are deliberately NOT copied: a call that drops `env` leaves no log
		 * line, which the test's log assertions then catch. Returns a restore function.
		 */
		applyToProcess() {
			scrubHeliProcessEnv();
			const saved = {};
			for (const [key, value] of Object.entries(env)) {
				if (LOG_KEYS.has(key)) continue;
				saved[key] = process.env[key];
				process.env[key] = value;
			}
			return () => {
				for (const [key, value] of Object.entries(saved)) {
					if (value === undefined) delete process.env[key];
					else process.env[key] = value;
				}
			};
		},
		/** Throw unless `host` resolves to this environment's fake shim. */
		assertFakeResolution(host) {
			const probe = process.platform === "win32"
				? spawnSync("where", [host], { env, encoding: "utf8", windowsHide: true })
				: spawnSync("sh", ["-c", `command -v ${host}`], { env, encoding: "utf8" });
			const first = String(probe.stdout || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
			if (!first.toLowerCase().startsWith(fakeBin.toLowerCase())) {
				throw new Error(`hermetic env leak: ${host} resolves to "${first || "nothing"}", expected a shim in ${fakeBin}`);
			}
		},
		cleanup() {
			rmSync(root, { recursive: true, force: true });
		},
	};
}
```

- [ ] **Step 3: Write the failing isolation test**

Create `scripts/smoke-host-env-isolation.mjs`:

```js
#!/usr/bin/env node
/**
 * Every host CLI spawned by lib/cli/host.mjs must receive the caller's env.
 * Runs entirely against fake host CLIs: this process's own PATH/HOME are also
 * pointed at the hermetic environment, so a dropped `env` still cannot reach a
 * real CLI — it only loses the fake-log variable, which the assertions detect.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHermeticEnv } from "./lib/hermetic-env.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const hermetic = createHermeticEnv({ prefix: "heli-host-env-isolation-" });
const restoreProcessEnv = hermetic.applyToProcess();

function calls() {
	return hermetic.readLog().map((entry) => [entry.host, ...entry.args].join(" "));
}

try {
	for (const host of ["claude", "codex", "grok", "pi", "kimi"]) hermetic.assertFakeResolution(host);
	const { inspectHost, installHost, removeHost } = await import("../lib/cli/host.mjs");
	const env = hermetic.env;

	// inspectHost: plugin-list probes must use the caller's env.
	inspectHost(packageRoot, "claude", { env });
	inspectHost(packageRoot, "codex", { env });
	inspectHost(packageRoot, "pi", { env });
	for (const expected of ["claude plugin list --json", "codex plugin list", "pi list"]) {
		assert.ok(calls().includes(expected), `inspectHost must run "${expected}" with the caller env; saw:\n${calls().join("\n")}`);
	}

	// installHost -> runPlan -> step: installer + host CLI steps use the caller's env.
	const grokInstall = installHost(packageRoot, "grok", { env, force: true });
	assert.equal(grokInstall.ok, true, JSON.stringify(grokInstall.steps, null, 2));
	const grokHook = join(hermetic.home, ".grok", "hooks", "heli-harness.json");
	assert.ok(existsSync(grokHook), "grok installer must write into the hermetic HELI_HOST_HOME");
	assert.ok(calls().some((line) => line.startsWith("grok plugin install ")), `grok install step missing:\n${calls().join("\n")}`);

	// removeHost -> step: the uninstall must hit the fake grok, never the real one.
	mkdirSync(dirname(grokHook), { recursive: true });
	writeFileSync(grokHook, "{}\n", "utf8");
	const grokRemove = removeHost(packageRoot, "grok", { env });
	assert.equal(grokRemove.ok, true, JSON.stringify(grokRemove.steps, null, 2));
	assert.equal(existsSync(grokHook), false);
	assert.ok(calls().includes("grok plugin uninstall heli-harness"), `fake grok must receive the uninstall:\n${calls().join("\n")}`);

	console.log("host env isolation smoke ok");
} finally {
	restoreProcessEnv();
	hermetic.cleanup();
}
```

- [ ] **Step 4: Run it to verify it fails (safe: only fake CLIs are reachable)**

Run: `unset HELI_SESSION_ID; node scripts/smoke-host-env-isolation.mjs`
Expected: FAIL with `AssertionError [ERR_ASSERTION]: inspectHost must run "claude plugin list --json" with the caller env; saw:` followed by `claude --version`, `codex --version`, `pi --version` (the unfixed `run()` reached the fake through the process PATH but without the log variable).

- [ ] **Step 5: Pass the caller env to every host CLI call**

In `lib/cli/host.mjs` make these five exact edits:

Line 179: `const result = run("codex", ["plugin", "list"]);` → `const result = run("codex", ["plugin", "list"], { env });`

Line 183: `const result = run(spec.cli, ["list"]);` → `const result = run(spec.cli, ["list"], { env });`

Line 187: `const plugin = claudePluginState(run("claude", ["plugin", "list", "--json"]).stdout);` → `const plugin = claudePluginState(run("claude", ["plugin", "list", "--json"], { env }).stdout);`

Lines 245-246, replace:

```js
function step(command, args, { allowAlready = false, allowMissing = false } = {}) {
	const result = run(command, args);
```

with:

```js
function step(command, args, { allowAlready = false, allowMissing = false, env = process.env } = {}) {
	const result = run(command, args, { env });
```

Lines 394-397 (inside `runPlan`), replace:

```js
		const result = custom || step(command, args, {
			allowAlready: !remove,
			allowMissing: remove,
		});
```

with:

```js
		const result = custom || step(command, args, {
			allowAlready: !remove,
			allowMissing: remove,
			env,
		});
```

(`commandPresent` at line 38-42 already forwards `env`.)

- [ ] **Step 6: Run the isolation test to verify it passes**

Run: `unset HELI_SESSION_ID; node scripts/smoke-host-env-isolation.mjs`
Expected: `host env isolation smoke ok`

- [ ] **Step 7: Add the grant-store read-only assertions (failing)**

In `scripts/smoke-scoped-grants.mjs`:

Line 3: `import { mkdirSync, mkdtempSync, rmSync } from "node:fs";` → `import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";`

Lines 8-11, replace:

```js
import {
	issueGrant,
	listGrants,
} from "../lib/concurrency/grant.mjs";
```

with:

```js
import {
	consumeApplicableGrant,
	grantStorePaths,
	issueGrant,
	listGrants,
} from "../lib/concurrency/grant.mjs";
```

After lines 40-41 (`assert.equal(denied.deny, true);` / `assert.equal(denied.code, "REMOTE_PUSH_DENIED");`) insert:

```js
	// Looking for a grant is a read: it must not create per-workspace grant-store
	// directories (tests used to litter the real ~/.heli/grants this way).
	const grantStoreDir = grantStorePaths(project, { env }).dir;
	assert.equal(existsSync(grantStoreDir), false, "a denied hook call must not create the grant store");
	assert.equal(consumeApplicableGrant(project, { action: "git.push", env }), null);
	assert.equal(existsSync(grantStoreDir), false, "consuming with no grants must not create the grant store");
```

Run: `unset HELI_SESSION_ID; node scripts/smoke-scoped-grants.mjs`
Expected: FAIL with `AssertionError [ERR_ASSERTION]: a denied hook call must not create the grant store`

- [ ] **Step 8: Make grant consumption read-only when nothing matches**

In `.heli-harness/adapters/shared/concurrency/grant.mjs`, inside `consumeApplicableGrant` (lines 218-220), replace:

```js
	const policy = evaluateGrantPolicy(workspaceRoot, action, { env });
	if (!policy.grantable || policy.hardDenied) return null;
	return withGrantMutex(workspaceRoot, (paths) => {
```

with:

```js
	const policy = evaluateGrantPolicy(workspaceRoot, action, { env });
	if (!policy.grantable || policy.hardDenied) return null;
	// Read-only probe first: hooks call this on every guarded action, and the
	// mutex below creates the grant-store directory. No matching grant means
	// nothing to consume, so never touch the filesystem in that case.
	if (!findApplicableGrant(workspaceRoot, { action, sessionId, resource, env })) return null;
	return withGrantMutex(workspaceRoot, (paths) => {
```

Then sync and re-run:

Run: `node scripts/sync-plugin-shared.mjs && unset HELI_SESSION_ID; node scripts/smoke-scoped-grants.mjs`
Expected: `sync-plugin-shared: done` then `scoped grants smoke ok`

- [ ] **Step 9: Make smoke-convergence-authority immune to a stray HELI_SESSION_ID**

Run first (red): `HELI_SESSION_ID=heli-ses-stray node scripts/smoke-convergence-authority.mjs`
Expected: FAIL with `explicit unmatched host session must not inherit another host binding`

In `scripts/smoke-convergence-authority.mjs`, after lines 10-13 (the `import { evaluatePreToolUse, resolveExecutionContext } from "../.heli-harness/adapters/shared/hook-core.mjs";` block) insert:

```js
import { scrubHeliProcessEnv } from "./lib/hermetic-env.mjs";

// Kernel calls below default to process.env; a stray user-level HELI_SESSION_ID
// (or HELI_YOLO etc.) must not change what these fixtures resolve to.
scrubHeliProcessEnv();
```

Run: `HELI_SESSION_ID=heli-ses-stray node scripts/smoke-convergence-authority.mjs`
Expected: output ends with `ok: external host session identity is namespaced by host`

- [ ] **Step 10: Run smoke-host-manager.mjs against fakes**

In `scripts/smoke-host-manager.mjs`, replace lines 13-19:

```js
} from "../lib/cli/host.mjs";

const root = process.cwd();
const env = {
	...process.env,
	HELI_ANTIGRAVITY_PLUGIN_DIR: join(root, ".test-antigravity-plugins"),
};
```

with:

```js
} from "../lib/cli/host.mjs";
import { createHermeticEnv } from "./lib/hermetic-env.mjs";

const root = process.cwd();
// Host inspection spawns host CLIs: run against fakes only, never the real ones.
const hermetic = createHermeticEnv({ prefix: "heli-host-manager-" });
const restoreProcessEnv = hermetic.applyToProcess();
process.on("exit", () => {
	restoreProcessEnv();
	hermetic.cleanup();
});
const env = {
	...hermetic.env,
	HELI_ANTIGRAVITY_PLUGIN_DIR: join(hermetic.root, "antigravity-plugins"),
};
```

After line 113 (`const hosts = inspectHosts(root, { env });`) insert:

```js
const fakeCalls = hermetic.readLog().map((entry) => [entry.host, ...entry.args].join(" "));
for (const expected of ["claude plugin list --json", "codex plugin list", "pi list", "axga list"]) {
	assert.ok(fakeCalls.includes(expected), `inventory must probe "${expected}" through the fake CLI; saw:\n${fakeCalls.join("\n")}`);
}
```

Line 124: `HELI_HOST_HOME: join(root, ".test-host-unavailable-home"),` → `HELI_HOST_HOME: join(hermetic.root, "unavailable-home"),`

Run: `unset HELI_SESSION_ID; node scripts/smoke-host-manager.mjs`
Expected: `host manager smoke ok`

- [ ] **Step 11: Rewrite smoke-integration-migration.mjs to use the hermetic env (DO NOT RUN IT YET)**

Replace the whole of `scripts/smoke-integration-migration.mjs` with:

```js
#!/usr/bin/env node
import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { install as installEmbedded } from "../lib/cli/install.mjs";
import {
	inspectHost,
	installHost,
	updateHost,
	removeHost,
} from "../lib/cli/host.mjs";
import { createHermeticEnv } from "./lib/hermetic-env.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
// Host lifecycle calls below spawn host CLIs (grok, kimi, ...). They must only
// ever reach the fake shims, never the developer's real CLIs or real home.
const hermetic = createHermeticEnv({ prefix: "heli-integration-migration-" });
const restoreProcessEnv = hermetic.applyToProcess();
const root = hermetic.root;
const project = join(root, "linked-project");
const legacyProject = join(root, "legacy-project");
const hostHome = hermetic.home;
const heli = join(packageRoot, "bin", "heli.mjs");
const env = hermetic.env;

function runCli(args) {
	const result = spawnSync(process.execPath, [heli, ...args], { encoding: "utf8", env });
	assert.equal(result.status, 0, `${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
	return result;
}

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

try {
	mkdirSync(project, { recursive: true });
	mkdirSync(legacyProject, { recursive: true });

	// Fresh global-linked project: global setup -> lightweight .heli/ binding.
	runCli(["setup", "--json"]);
	runCli(["link", project, "--json"]);
	assert.ok(existsSync(join(project, ".heli", "workspace.json")));
	assert.ok(existsSync(join(project, ".heli", "heli.lock")));
	assert.equal(existsSync(join(project, ".heli-harness")), false, "normal linked project must not receive .heli-harness/");

	// Pi regression: modern /heli-install must link, while embedded install is explicit legacy.
	const piSource = readFileSync(join(packageRoot, "extensions", "pi-extension.js"), "utf8");
	assert.match(piSource, /registerCommand\("heli-install", \{ description: "Link current project to the globally installed Heli runtime"/);
	assert.match(piSource, /registerCommand\("heli-legacy-install", \{ description: "Compatibility only: install a local \.heli-harness\/ tree"/);
	assert.match(piSource, /linkProject\(getPackageRoot\(\), cwd\)/);
	assert.doesNotMatch(piSource, /Install Heli-Harness workspace harness into current folder\?/);
	assert.doesNotMatch(piSource, /This will create \.heli-harness\/ and adapter pointer files/);

	// Explicit compatibility mode remains available and visibly creates the legacy tree.
	installEmbedded(join(packageRoot, ".heli-harness"), legacyProject);
	assert.ok(existsSync(join(legacyProject, ".heli-harness", "HARNESS.md")));
	assert.equal(existsSync(join(legacyProject, ".heli", "workspace.json")), false);

	// Cursor: install is repeatable; stale version is detected/upgraded; remove is Heli-scoped.
	const cursorParent = join(hostHome, ".cursor", "plugins", "local");
	mkdirSync(cursorParent, { recursive: true });
	const cursorUnrelated = join(cursorParent, "unrelated-user-plugin.txt");
	writeFileSync(cursorUnrelated, "keep me\n", "utf8");

	const cursorFirst = installHost(packageRoot, "cursor", { env });
	assert.equal(cursorFirst.ok, true);
	const cursorSecond = installHost(packageRoot, "cursor", { env });
	assert.equal(cursorSecond.ok, true);
	assert.equal(cursorSecond.already, true, "second install should be idempotent");

	const cursorManifest = join(cursorParent, "heli-harness", ".cursor-plugin", "plugin.json");
	const staleCursor = readJson(cursorManifest);
	staleCursor.version = "0.8.3";
	writeFileSync(cursorManifest, JSON.stringify(staleCursor, null, 2) + "\n", "utf8");
	assert.equal(inspectHost(packageRoot, "cursor", { env }).stale, true);
	assert.equal(updateHost(packageRoot, "cursor", { env }).ok, true);
	assert.equal(inspectHost(packageRoot, "cursor", { env }).lifecycleState, "current");

	const cursorRemove = removeHost(packageRoot, "cursor", { env });
	assert.equal(cursorRemove.ok, true);
	assert.ok(existsSync(cursorUnrelated), "Cursor removal must preserve unrelated user plugin files");
	assert.ok(existsSync(join(project, ".heli", "workspace.json")), "host removal must preserve project binding");

	// OpenCode: Heli uses a namespaced bundle/wrapper and preserves other plugins.
	const openCodeRoot = join(hostHome, ".config", "opencode", "plugins");
	mkdirSync(openCodeRoot, { recursive: true });
	const otherPlugin = join(openCodeRoot, "other-user-plugin.js");
	writeFileSync(otherPlugin, "export default {};\n", "utf8");
	assert.equal(installHost(packageRoot, "opencode", { env }).ok, true);
	assert.ok(existsSync(join(openCodeRoot, "heli-harness.js")));
	assert.ok(existsSync(join(openCodeRoot, "heli-harness-bundle", "shared")));
	assert.ok(existsSync(otherPlugin));
	assert.equal(removeHost(packageRoot, "opencode", { env }).ok, true);
	assert.ok(existsSync(otherPlugin), "OpenCode removal must preserve unrelated plugins");

	// Grok user hook is isolated to the Heli-owned hook file. Removal also runs
	// `grok plugin uninstall`, which must reach the fake grok, never the real one.
	hermetic.assertFakeResolution("grok");
	const grokInstall = spawnSync(process.execPath, [
		join(packageRoot, ".heli-harness", "adapters", "grok-plugin", "install-user-hooks.mjs"),
	], { encoding: "utf8", env });
	assert.equal(grokInstall.status, 0, grokInstall.stderr || grokInstall.stdout);
	const grokHook = join(hostHome, ".grok", "hooks", "heli-harness.json");
	assert.ok(existsSync(grokHook));
	assert.equal(removeHost(packageRoot, "grok", { env }).ok, true);
	assert.equal(existsSync(grokHook), false);
	const grokCalls = hermetic.readLog().filter((entry) => entry.host === "grok").map((entry) => entry.args.join(" "));
	assert.ok(grokCalls.includes("plugin uninstall heli-harness"), `fake grok must receive the uninstall; saw: ${grokCalls.join(" | ")}`);

	// Kimi hook block is delimited, repeatable, and removal keeps unrelated config.
	const kimiHome = join(hostHome, ".kimi-code");
	mkdirSync(kimiHome, { recursive: true });
	const kimiConfig = join(kimiHome, "config.toml");
	writeFileSync(kimiConfig, "model = \"user-choice\"\n", "utf8");
	const kimiInstaller = join(packageRoot, ".heli-harness", "adapters", "kimi-plugin", "install-user-hooks.mjs");
	const kimiFirst = spawnSync(process.execPath, [kimiInstaller], { encoding: "utf8", env });
	assert.equal(kimiFirst.status, 0, kimiFirst.stderr || kimiFirst.stdout);
	const kimiSecond = spawnSync(process.execPath, [kimiInstaller], { encoding: "utf8", env });
	assert.equal(kimiSecond.status, 0, kimiSecond.stderr || kimiSecond.stdout);
	const kimiInstalled = readFileSync(kimiConfig, "utf8");
	assert.equal((kimiInstalled.match(/# --- heli-harness hooks ---/g) || []).length, 1);
	assert.match(kimiInstalled, /# --- end heli-harness hooks ---/);
	assert.equal(removeHost(packageRoot, "kimi", { env }).ok, true);
	const kimiAfter = readFileSync(kimiConfig, "utf8");
	assert.match(kimiAfter, /model = "user-choice"/);
	assert.doesNotMatch(kimiAfter, /heli-harness hooks/);

	// Antigravity conditional lifecycle owns a child directory, never the configured parent.
	const antiParent = join(root, "antigravity-plugins");
	const antiEnv = { ...env, HELI_ANTIGRAVITY_PLUGIN_DIR: antiParent };
	mkdirSync(antiParent, { recursive: true });
	const antiUnrelated = join(antiParent, "other-plugin.txt");
	writeFileSync(antiUnrelated, "keep\n", "utf8");
	assert.equal(installHost(packageRoot, "antigravity", { env: antiEnv }).ok, true);
	assert.ok(existsSync(join(antiParent, "heli-harness", "plugin.json")));
	assert.equal(removeHost(packageRoot, "antigravity", { env: antiEnv }).ok, true);
	assert.ok(existsSync(antiUnrelated), "Antigravity removal must preserve sibling plugins");

	console.log("integration migration smoke ok");
} finally {
	restoreProcessEnv();
	hermetic.cleanup();
}
```

Run only a syntax check: `node --check scripts/smoke-integration-migration.mjs`
Expected: no output, exit 0.

- [ ] **Step 12: Register the new test**

In `package.json` `scripts.check`, replace `node scripts/smoke-host-manager.mjs` with `node scripts/smoke-host-env-isolation.mjs && node scripts/smoke-host-manager.mjs`.

- [ ] **Step 13: Regenerate copies and verify**

Run: `node scripts/sync-workspace-cli.mjs && node scripts/sync-workspace-cli.mjs --check && node scripts/sync-plugin-shared.mjs --check && node scripts/sync-plugin-skills.mjs --check`
Expected: ends with `sync-workspace-cli --check: ok`, `sync-plugin-shared --check: ok`, `sync-plugin-skills --check: ok (30 skills)`.

Run: `unset HELI_SESSION_ID; for t in smoke-host-env-isolation smoke-host-manager smoke-scoped-grants smoke-convergence-authority smoke-linked-portability smoke-resource-authority; do node scripts/$t.mjs || echo "FAIL $t"; done`
Expected: each prints its `... ok` / `passed` line; no `FAIL`.

- [ ] **Step 14: Commit**

```bash
git add scripts/lib/fake-host-cli.mjs scripts/lib/hermetic-env.mjs scripts/smoke-host-env-isolation.mjs lib/cli/host.mjs .heli-harness/cli/host.mjs .heli-harness/adapters scripts/smoke-scoped-grants.mjs scripts/smoke-host-manager.mjs scripts/smoke-integration-migration.mjs scripts/smoke-convergence-authority.mjs package.json
git status --short
git commit -m "fix: pass caller env to host CLIs and make host tests hermetic" -m "Every run() in lib/cli/host.mjs now receives the caller env, host lifecycle tests run against fake host CLIs in a temp home, grant lookups no longer create directories under ~/.heli, and a stray HELI_SESSION_ID no longer breaks the convergence smoke." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`git status --short` before committing must list only the files above (plus regenerated `.heli-harness/adapters/*-plugin/shared/concurrency/grant.mjs`).

- [ ] **Step 15: Now (and only now) run the migration smoke and the full suite**

Run: `unset HELI_SESSION_ID; node scripts/smoke-integration-migration.mjs`
Expected: `integration migration smoke ok`. If you have a real `~/.grok/hooks/heli-harness.json`, it must still exist afterwards (`ls ~/.grok/hooks/`).

Run the full-chain runner from Global Constraints (600000 ms timeout).
Expected: `FAILED: ["node scripts/smoke-portable-targets.mjs"]`, exit 0. If anything else fails, fix it and commit with a `fix:`/`test:` message (with the trailer).

---

### Task 2: Fail closed (wrappers, atomic writes, hook configs)

**Files:**
- Modify (full rewrite): `.heli-harness/adapters/shared/claude-style-pre-tool-use.mjs`
- Modify (full rewrite): `.heli-harness/adapters/shared/grok-style-pre-tool-use.mjs`
- Modify: `.heli-harness/adapters/shared/concurrency/fs-atomic.mjs:47-84`
- Modify: `.heli-harness/adapters/claude-plugin/hooks/hooks.json:10`, `:24-25`
- Modify: `.heli-harness/adapters/codex-plugin/hooks/hooks.json:24-25`
- Modify: `.heli-harness/adapters/grok-plugin/hooks/hooks.json:23`, `.heli-harness/adapters/grok-plugin/hooks/heli-user-hooks.json:21`, `.heli-harness/adapters/grok-plugin/install-user-hooks.mjs:52`
- Modify: `.heli-harness/adapters/kimi-plugin/hooks/hooks.json:21`, `.heli-harness/adapters/kimi-plugin/install-user-hooks.mjs:36`, `.heli-harness/adapters/kimi-plugin/config.toml.example:9`
- Modify: `.heli-harness/adapters/antigravity-plugin/hooks.json:24`, `.heli-harness/adapters/antigravity-plugin/hooks/hooks.json:22`
- Create: `scripts/smoke-hook-fail-closed.mjs`, `scripts/smoke-fs-atomic.mjs`, `scripts/smoke-hook-configs.mjs`
- Modify: `package.json`
- Generated: `.heli-harness/adapters/*-plugin/shared/**`

**Interfaces:**
- Consumes: `scrubHeliProcessEnv` from `scripts/lib/hermetic-env.mjs` (Task 1).
- Produces: wrapper contract — any error → stdout ``{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Heli-Harness could not evaluate this action (...); denying (fail-closed). Run `heli doctor`."}}`` plus the same reason on stderr; exit 0 for Claude-style hosts, exit 2 (Grok's deny channel, plus `decision`/`reason` fields) for Grok. `renameWithRetry(from, to, { rename?, attempts? }) → to` exported from `concurrency/fs-atomic.mjs` (and `lib/concurrency/fs-atomic.mjs`).

- [ ] **Step 1: Write the failing fail-closed test**

Create `scripts/smoke-hook-fail-closed.mjs`:

```js
#!/usr/bin/env node
/**
 * PreToolUse wrappers must fail closed: any error -> a deny in the host's own
 * protocol, never a crash (hosts treat a crashed hook as "allow"). Also pins the
 * other direction: a healthy workspace must still be allowed.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTask } from "../lib/concurrency/task.mjs";
import { createSession, attachSession } from "../lib/concurrency/session.mjs";
import { scrubHeliProcessEnv } from "./lib/hermetic-env.mjs";

scrubHeliProcessEnv();
const root = process.cwd();
const scratch = mkdtempSync(join(tmpdir(), "heli-fail-closed-"));
const baseEnv = { ...process.env, HELI_CONFIG_DIR: join(scratch, "config"), HELI_DATA_DIR: join(scratch, "data") };
const shippedRules = readFileSync(join(root, ".heli-harness", "safety", "command-rules.json"), "utf8");

const WRAPPERS = [
	{ name: "claude", rel: ".heli-harness/adapters/claude-plugin/hooks/heli-pre-tool-use.mjs", denyStatus: 0 },
	{ name: "codex", rel: ".heli-harness/adapters/codex-plugin/hooks/heli-pre-tool-use.mjs", denyStatus: 0 },
	{ name: "kimi", rel: ".heli-harness/adapters/kimi-plugin/hooks/heli-pre-tool-use.mjs", denyStatus: 0 },
	{ name: "antigravity", rel: ".heli-harness/adapters/antigravity-plugin/hooks/heli-pre-tool-use.mjs", denyStatus: 0 },
	{ name: "grok", rel: ".heli-harness/adapters/grok-plugin/hooks/heli-pre-tool-use.mjs", denyStatus: 2 },
];

function workspace(name, files) {
	const dir = join(scratch, name);
	for (const [rel, content] of Object.entries(files)) {
		mkdirSync(join(dir, rel, ".."), { recursive: true });
		writeFileSync(join(dir, rel), content);
	}
	return dir;
}

function runHook(wrapper, cwd, stdinText, env = {}) {
	const result = spawnSync(process.execPath, [join(root, wrapper.rel)], {
		cwd,
		input: stdinText,
		encoding: "utf8",
		env: { ...baseEnv, ...env },
	});
	let body = null;
	try {
		body = result.stdout.trim() ? JSON.parse(result.stdout) : null;
	} catch {
		body = { unparseable: result.stdout };
	}
	return { status: result.status, body, stderr: result.stderr };
}

function assertDenied(wrapper, out, reasonPattern, label) {
	assert.equal(out.status, wrapper.denyStatus, `${wrapper.name} ${label}: exit ${out.status}, stderr=${out.stderr}`);
	assert.equal(out.body?.hookSpecificOutput?.permissionDecision, "deny", `${wrapper.name} ${label}: expected a JSON deny, got ${JSON.stringify(out.body)} stderr=${out.stderr}`);
	assert.match(out.body.hookSpecificOutput.permissionDecisionReason, reasonPattern, `${wrapper.name} ${label}`);
}

function assertAllowed(wrapper, out, label) {
	assert.equal(out.status, 0, `${wrapper.name} ${label}: exit ${out.status}, stderr=${out.stderr}`);
	assert.notEqual(out.body?.hookSpecificOutput?.permissionDecision, "deny", `${wrapper.name} ${label}: ${JSON.stringify(out.body)}`);
}

const FAIL_CLOSED = /could not evaluate this action.*denying \(fail-closed\).*heli doctor/s;
const bash = (command) => JSON.stringify({ tool_name: "Bash", tool_input: { command } });
const write = (file_path) => JSON.stringify({ tool_name: "Write", tool_input: { file_path, content: "x" } });

try {
	const healthy = workspace("healthy", {
		".heli-harness/HARNESS.md": "# Heli\n",
		".heli-harness/safety/command-rules.json": shippedRules,
		".heli-harness/state/current-task.md": "# Current Task\n\nTarget repo: demo\n\nCurrent status: in progress\n\nFailed attempts count: 0\n",
		".heli-harness/workspace/target.json": JSON.stringify({ targetRepo: "demo" }),
	});
	const badBinding = workspace("bad-binding", {
		".heli/workspace.json": JSON.stringify({ schemaVersion: 99, workspaceId: "x" }),
	});
	const badLock = workspace("bad-lock", {
		".heli/workspace.json": JSON.stringify({ schemaVersion: 1, workspaceId: "heli-ws-bad-lock", resources: [{ id: "root", type: "worktree", path: "." }] }),
		".heli/heli.lock": "{not json",
	});

	// events.jsonl replaced by a directory: the decision receipt write fails (EISDIR)
	// AFTER a deny was decided. The deny must still reach the host.
	const eisdir = workspace("eisdir", {
		".heli-harness/HARNESS.md": "# Heli\n",
		".heli-harness/safety/command-rules.json": shippedRules,
		".heli-harness/workspace/schema.json": JSON.stringify({ schemaVersion: 1, mode: "concurrent" }),
	});
	createTask(eisdir, { taskId: "t1", repositoryId: "demo", worktreePath: eisdir });
	createSession(eisdir, { sessionId: "observer", mode: "observe", worktreePath: eisdir });
	attachSession(eisdir, "observer", "t1", { mode: "observe", worktreePath: eisdir });
	const eventsPath = join(eisdir, ".heli-harness", "tasks", "t1", "events.jsonl");
	rmSync(eventsPath, { force: true });
	mkdirSync(eventsPath);

	for (const wrapper of WRAPPERS) {
		assertDenied(wrapper, runHook(wrapper, healthy, "{not json"), FAIL_CLOSED, "malformed stdin");
		assertDenied(wrapper, runHook(wrapper, healthy, ""), FAIL_CLOSED, "empty stdin");
		assertDenied(wrapper, runHook(wrapper, healthy, JSON.stringify({ tool_input: { command: "ls" } })), FAIL_CLOSED, "payload without tool name");
		assertDenied(wrapper, runHook(wrapper, badBinding, write("src/a.js")), /UNSUPPORTED_WORKSPACE_SCHEMA.*fail-closed/s, "schema-invalid .heli/workspace.json");
		assertDenied(wrapper, runHook(wrapper, badLock, bash("git status")), /INVALID_HELI_LOCK.*fail-closed/s, "evaluator throws (unreadable heli.lock)");
		const failed = runHook(wrapper, badLock, bash("git status"));
		assert.match(failed.stderr, FAIL_CLOSED, `${wrapper.name}: fail-closed reason must also go to stderr`);

		const eisdirOut = runHook(wrapper, eisdir, write("src/x.ts"), { HELI_SESSION_ID: "observer" });
		assertDenied(wrapper, eisdirOut, /not write|mode/i, "receipt write fails after deny (EISDIR)");
		assert.match(eisdirOut.stderr, /decision receipt failed/i, `${wrapper.name}: side-effect failure must be reported on stderr`);

		// Healthy workspace: no false denials.
		assertAllowed(wrapper, runHook(wrapper, healthy, write("notes.txt")), "healthy Write");
		assertAllowed(wrapper, runHook(wrapper, healthy, bash("git status")), "healthy Bash");
	}
	console.log("hook fail-closed smoke ok");
} finally {
	rmSync(scratch, { recursive: true, force: true });
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `unset HELI_SESSION_ID; node scripts/smoke-hook-fail-closed.mjs`
Expected: FAIL with `AssertionError [ERR_ASSERTION]: claude malformed stdin: exit 1, stderr=` followed by a `SyntaxError` from `JSON.parse` (the current wrapper crashes, which hosts treat as allow).

- [ ] **Step 3: Rewrite the Claude-style wrapper**

Replace the whole of `.heli-harness/adapters/shared/claude-style-pre-tool-use.mjs` with:

```js
#!/usr/bin/env node
/**
 * Claude/Codex/Kimi-style PreToolUse hook wrapper around shared hook-core.
 *
 * Fail-closed contract: hosts treat a crashed or timed-out hook as "allow", so
 * every failure path here prints a JSON deny instead. The decision is written
 * BEFORE any audit/observation side effect, and each side effect is isolated
 * so it can never turn a decision into a crash. Heli modules are imported
 * inside the try block so even an import-time failure denies.
 */
import { stdin } from "node:process";

function readStdin() {
	return new Promise((resolve, reject) => {
		let data = "";
		stdin.setEncoding("utf8");
		stdin.on("data", (chunk) => {
			data += chunk;
		});
		stdin.on("end", () => resolve(data));
		stdin.on("error", reject);
	});
}

function parseHookEvent(input) {
	if (!String(input ?? "").trim()) throw new Error("empty PreToolUse payload");
	const event = JSON.parse(input);
	if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error("PreToolUse payload is not a JSON object");
	const toolName = String(event.tool_name ?? event.toolName ?? "").trim();
	if (!toolName) throw new Error("PreToolUse payload has no tool name");
	return { event, toolName, toolInput: event.tool_input ?? event.toolInput ?? {} };
}

function failClosedReason(error) {
	const detail = `${error?.code ? `${error.code}: ` : ""}${error?.message || String(error)}`;
	return `Heli-Harness could not evaluate this action (${detail}); denying (fail-closed). Run \`heli doctor\`.`;
}

function deny(reason) {
	process.stdout.write(
		JSON.stringify({
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "deny",
				permissionDecisionReason: reason,
			},
		}),
	);
}

const host = process.env.HELI_ADAPTER_ID || "claude-style";
let parsed = null;
let result = null;
try {
	parsed = parseHookEvent(await readStdin());
	const { evaluatePreToolUse } = await import("./hook-core.mjs");
	result = evaluatePreToolUse({
		cwd: process.cwd(),
		toolName: parsed.toolName,
		toolInput: parsed.toolInput,
		host,
		hookPayload: parsed.event,
	});
} catch (error) {
	const reason = failClosedReason(error);
	process.stderr.write(`${reason}\n`);
	deny(reason);
}

if (result) {
	// 1. Decision first — nothing below may change or delay it.
	if (result.deny) deny(result.reason);
	// 2. Evidence side effects, each isolated.
	const sideEffect = async (label, fn) => {
		try {
			await fn();
		} catch (error) {
			process.stderr.write(`Heli-Harness: ${label} failed after the decision was issued (${error?.code || error?.message || error}).\n`);
		}
	};
	if (result.ctx?.workspaceRoot && result.ctx?.sessionId) {
		await sideEffect("runtime observation", async () => {
			const { observeRuntimeCapability } = await import("./concurrency/attestation.mjs");
			observeRuntimeCapability(result.ctx.workspaceRoot, result.ctx.sessionId, { host, capability: "pre_tool", source: "PreToolUse" });
			observeRuntimeCapability(result.ctx.workspaceRoot, result.ctx.sessionId, { host, capability: "structured_tool_input", source: "PreToolUse" });
		});
	}
	await sideEffect("decision receipt", async () => {
		const { recordGuardDecision } = await import("./concurrency/governance-decision.mjs");
		recordGuardDecision(result, { host, toolName: parsed.toolName, source: "PreToolUse" });
	});
}
```

- [ ] **Step 4: Rewrite the Grok wrapper**

Replace the whole of `.heli-harness/adapters/shared/grok-style-pre-tool-use.mjs` with:

```js
#!/usr/bin/env node
/**
 * Grok Build PreToolUse hook.
 *
 * Fail-closed contract: a crashed or timed-out hook lets the tool run, so every
 * failure path denies through Grok's deny channel (JSON + exit code 2). The
 * decision is written BEFORE any audit/observation side effect, and each side
 * effect is isolated. Heli modules are imported inside the try block so even
 * an import-time failure denies.
 */
import { stdin } from "node:process";

function readStdin() {
	return new Promise((resolve, reject) => {
		let data = "";
		stdin.setEncoding("utf8");
		stdin.on("data", (chunk) => {
			data += chunk;
		});
		stdin.on("end", () => resolve(data));
		stdin.on("error", reject);
	});
}

function parseHookEvent(input) {
	if (!String(input ?? "").trim()) throw new Error("empty PreToolUse payload");
	const event = JSON.parse(input);
	if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error("PreToolUse payload is not a JSON object");
	const toolName = String(event.tool_name ?? event.toolName ?? "").trim();
	if (!toolName) throw new Error("PreToolUse payload has no tool name");
	return { event, toolName, toolInput: event.tool_input ?? event.toolInput ?? {} };
}

function failClosedReason(error) {
	const detail = `${error?.code ? `${error.code}: ` : ""}${error?.message || String(error)}`;
	return `Heli-Harness could not evaluate this action (${detail}); denying (fail-closed). Run \`heli doctor\`.`;
}

function deny(reason) {
	process.stdout.write(
		JSON.stringify({
			decision: "deny",
			reason,
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "deny",
				permissionDecisionReason: reason,
			},
		}),
	);
	// Grok's deny channel is exit code 2. Set it instead of calling
	// process.exit() so the stdout write is never cut short.
	process.exitCode = 2;
}

const host = process.env.HELI_ADAPTER_ID || "grok";
let parsed = null;
let result = null;
try {
	parsed = parseHookEvent(await readStdin());
	const { evaluatePreToolUse } = await import("./hook-core.mjs");
	result = evaluatePreToolUse({
		cwd: process.cwd(),
		toolName: parsed.toolName,
		toolInput: parsed.toolInput,
		host,
		hookPayload: parsed.event,
	});
} catch (error) {
	const reason = failClosedReason(error);
	process.stderr.write(`${reason}\n`);
	deny(reason);
}

if (result) {
	// 1. Decision first — nothing below may change or delay it.
	if (result.deny) deny(result.reason);
	// 2. Evidence side effects, each isolated.
	const sideEffect = async (label, fn) => {
		try {
			await fn();
		} catch (error) {
			process.stderr.write(`Heli-Harness: ${label} failed after the decision was issued (${error?.code || error?.message || error}).\n`);
		}
	};
	if (result.ctx?.workspaceRoot && result.ctx?.sessionId) {
		await sideEffect("runtime observation", async () => {
			const { observeRuntimeCapability } = await import("./concurrency/attestation.mjs");
			observeRuntimeCapability(result.ctx.workspaceRoot, result.ctx.sessionId, { host, capability: "pre_tool", source: "PreToolUse" });
			observeRuntimeCapability(result.ctx.workspaceRoot, result.ctx.sessionId, { host, capability: "structured_tool_input", source: "PreToolUse" });
		});
	}
	await sideEffect("decision receipt", async () => {
		const { recordGuardDecision } = await import("./concurrency/governance-decision.mjs");
		recordGuardDecision(result, { host, toolName: parsed.toolName, source: "PreToolUse" });
	});
}
```

- [ ] **Step 5: Sync the plugin copies and verify the fail-closed test passes**

Run: `node scripts/sync-plugin-shared.mjs && unset HELI_SESSION_ID; node scripts/smoke-hook-fail-closed.mjs`
Expected: `sync-plugin-shared: done` then `hook fail-closed smoke ok`

- [ ] **Step 6: Write the failing atomic-write test**

Create `scripts/smoke-fs-atomic.mjs`:

```js
#!/usr/bin/env node
/**
 * Atomic writes must survive transient Windows sharing violations without ever
 * deleting the target first (the old delete-then-rename fallback could lose
 * state if the second rename also failed).
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renameWithRetry, writeJsonAtomic } from "../lib/concurrency/fs-atomic.mjs";

const dir = mkdtempSync(join(tmpdir(), "heli-fs-atomic-"));

function sharingViolation(code) {
	const error = new Error(`${code}: simulated sharing violation`);
	error.code = code;
	return error;
}

try {
	const target = join(dir, "state.json");

	// Transient EPERM/EBUSY/EACCES are retried; the target stays intact meanwhile.
	for (const code of ["EPERM", "EBUSY", "EACCES"]) {
		writeFileSync(target, "old\n");
		const tmp = join(dir, `.${code}.tmp`);
		writeFileSync(tmp, "new\n");
		let calls = 0;
		renameWithRetry(tmp, target, {
			rename(from, to) {
				calls += 1;
				assert.equal(readFileSync(to, "utf8"), "old\n", "target must stay intact until the rename lands");
				if (calls < 3) throw sharingViolation(code);
				renameSync(from, to);
			},
		});
		assert.equal(calls, 3, `${code} must be retried`);
		assert.equal(readFileSync(target, "utf8"), "new\n");
	}

	// Persistent failure: bounded attempts, error rethrown, old content kept, temp removed.
	writeFileSync(target, "old\n");
	const stuckTmp = join(dir, ".stuck.tmp");
	writeFileSync(stuckTmp, "new\n");
	let attempts = 0;
	assert.throws(
		() => renameWithRetry(stuckTmp, target, {
			attempts: 4,
			rename() {
				attempts += 1;
				throw sharingViolation("EBUSY");
			},
		}),
		(error) => error.code === "EBUSY",
	);
	assert.equal(attempts, 4);
	assert.equal(readFileSync(target, "utf8"), "old\n", "a failed write must never lose the previous content");
	assert.equal(existsSync(stuckTmp), false, "temp file is cleaned up after the final failure");

	// Non-transient errors are not retried.
	const otherTmp = join(dir, ".other.tmp");
	writeFileSync(otherTmp, "x");
	let otherCalls = 0;
	assert.throws(
		() => renameWithRetry(otherTmp, target, {
			rename() {
				otherCalls += 1;
				throw sharingViolation("EXDEV");
			},
		}),
		(error) => error.code === "EXDEV",
	);
	assert.equal(otherCalls, 1);

	// Real writes over an existing file still work and leave no temp files behind.
	writeJsonAtomic(target, { ok: 1 });
	writeJsonAtomic(target, { ok: 2 });
	assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), { ok: 2 });
	assert.deepEqual(readdirSync(dir).filter((name) => name.endsWith(".tmp")), []);
	console.log("fs-atomic smoke ok");
} finally {
	rmSync(dir, { recursive: true, force: true });
}
```

Run: `node scripts/smoke-fs-atomic.mjs`
Expected: FAIL with `SyntaxError: The requested module '../lib/concurrency/fs-atomic.mjs' does not provide an export named 'renameWithRetry'`

- [ ] **Step 7: Replace delete-then-rename with a bounded retry**

In `.heli-harness/adapters/shared/concurrency/fs-atomic.mjs`, replace lines 47-84 (from the doc comment whose first text line is ` * Atomic JSON write via temp file + rename into place.` through the closing `}` of `writeTextAtomic` at line 84; `claimDirExclusive` and everything after it stay unchanged) with:

```js
const RENAME_RETRY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const RENAME_MAX_ATTEMPTS = 20;

function sleepSync(ms) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Rename `from` over `to`, retrying transient Windows sharing violations
 * (EPERM/EBUSY/EACCES from antivirus, indexers or a concurrent reader).
 * The target is NEVER deleted first: a failed write leaves the previous
 * content intact. On final failure the temp file is removed and the error
 * is rethrown. `rename` is injectable for tests.
 */
export function renameWithRetry(from, to, { rename = renameSync, attempts = RENAME_MAX_ATTEMPTS } = {}) {
	for (let attempt = 1; ; attempt += 1) {
		try {
			rename(from, to);
			return to;
		} catch (error) {
			if (!RENAME_RETRY_CODES.has(error?.code) || attempt >= attempts) {
				try {
					unlinkSync(from);
				} catch {
					/* temp cleanup is best-effort */
				}
				throw error;
			}
			sleepSync(Math.min(10 * attempt, 100));
		}
	}
}

/**
 * Atomic JSON write via temp file + rename into place (see renameWithRetry).
 */
export function writeJsonAtomic(path, value, { spaces = 2 } = {}) {
	ensureDir(dirname(path));
	const payload = `${JSON.stringify(value, null, spaces)}\n`;
	const tmp = join(dirname(path), `.${randomBytes(8).toString("hex")}.tmp`);
	writeFileSync(tmp, payload, "utf8");
	return renameWithRetry(tmp, path);
}

export function writeTextAtomic(path, text) {
	ensureDir(dirname(path));
	const tmp = join(dirname(path), `.${randomBytes(8).toString("hex")}.tmp`);
	writeFileSync(tmp, text, "utf8");
	return renameWithRetry(tmp, path);
}
```

Run: `node scripts/sync-plugin-shared.mjs && node scripts/smoke-fs-atomic.mjs`
Expected: `fs-atomic smoke ok`

- [ ] **Step 8: Write the failing hook-config test**

Create `scripts/smoke-hook-configs.mjs`:

```js
#!/usr/bin/env node
/**
 * PreToolUse hook configs: generous timeouts (a timed-out hook lets the tool
 * run), Claude-valid fields only, and a fail-closed Codex fallback on Windows
 * machines where node is missing.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const adapters = join(root, ".heli-harness", "adapters");
const MIN_TIMEOUT_SECONDS = 30;

function json(rel) {
	return JSON.parse(readFileSync(join(adapters, rel), "utf8"));
}

function preToolHooks(config) {
	const groups = config.hooks?.PreToolUse || config["heli-harness-pretool"]?.PreToolUse || [];
	return groups.flatMap((group) => group.hooks);
}

for (const rel of [
	"claude-plugin/hooks/hooks.json",
	"codex-plugin/hooks/hooks.json",
	"grok-plugin/hooks/hooks.json",
	"grok-plugin/hooks/heli-user-hooks.json",
	"kimi-plugin/hooks/hooks.json",
	"antigravity-plugin/hooks.json",
	"antigravity-plugin/hooks/hooks.json",
]) {
	const hooks = preToolHooks(json(rel));
	assert.ok(hooks.length > 0, `${rel}: PreToolUse hooks missing`);
	for (const hook of hooks) {
		assert.ok(hook.timeout >= MIN_TIMEOUT_SECONDS, `${rel}: PreToolUse timeout ${hook.timeout}s is below ${MIN_TIMEOUT_SECONDS}s`);
	}
}

// Claude command hooks support command/timeout/statusMessage/async/shell;
// commandWindows is a Codex-only field and must not appear in the Claude plugin.
const claude = json("claude-plugin/hooks/hooks.json");
for (const group of [...claude.hooks.SessionStart, ...claude.hooks.PreToolUse]) {
	for (const hook of group.hooks) {
		assert.equal("commandWindows" in hook, false, "Claude hooks.json must not use the Codex-only commandWindows field");
	}
}

// Codex on Windows without node: the fallback branch must print a deny, not silently allow.
const codexPre = preToolHooks(json("codex-plugin/hooks/hooks.json"))[0];
const fallback = /else \{ '(\{.*\})' \}$/.exec(codexPre.commandWindows);
assert.ok(fallback, "Codex commandWindows must have an else branch that prints a PreToolUse deny");
const fallbackDecision = JSON.parse(fallback[1]);
assert.equal(fallbackDecision.hookSpecificOutput.hookEventName, "PreToolUse");
assert.equal(fallbackDecision.hookSpecificOutput.permissionDecision, "deny");
assert.match(fallbackDecision.hookSpecificOutput.permissionDecisionReason, /node was not found.*fail-closed/);
if (process.platform === "win32") {
	// Execute the real Windows command with a PATH that has no node on it.
	const systemRoot = process.env.SystemRoot || "C:\\Windows";
	const run = spawnSync(
		join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
		["-NoProfile", "-NonInteractive", "-Command", codexPre.commandWindows],
		{
			encoding: "utf8",
			env: { SystemRoot: systemRoot, PATH: join(systemRoot, "System32"), CLAUDE_PLUGIN_ROOT: join(adapters, "codex-plugin") },
		},
	);
	assert.equal(run.status, 0, run.stderr);
	assert.equal(JSON.parse(run.stdout.trim()).hookSpecificOutput.permissionDecision, "deny", run.stdout);
}

// The user-level installers write the raised timeout into the host config.
const home = mkdtempSync(join(tmpdir(), "heli-hook-configs-"));
try {
	const env = { ...process.env, HELI_HOST_HOME: home, KIMI_CODE_HOME: join(home, ".kimi-code") };
	for (const installer of ["grok-plugin/install-user-hooks.mjs", "kimi-plugin/install-user-hooks.mjs"]) {
		const result = spawnSync(process.execPath, [join(adapters, installer)], { encoding: "utf8", env });
		assert.equal(result.status, 0, result.stderr || result.stdout);
	}
	const grokUser = JSON.parse(readFileSync(join(home, ".grok", "hooks", "heli-harness.json"), "utf8"));
	for (const hook of preToolHooks(grokUser)) assert.ok(hook.timeout >= MIN_TIMEOUT_SECONDS, `grok user hook timeout ${hook.timeout}`);
	const kimiConfig = readFileSync(join(home, ".kimi-code", "config.toml"), "utf8");
	assert.match(kimiConfig, /event = "PreToolUse"\nmatcher = "\.\*"\ncommand = '[^']*'\ntimeout = 30/);
} finally {
	rmSync(home, { recursive: true, force: true });
}

console.log("hook configs smoke ok");
```

Run: `node scripts/smoke-hook-configs.mjs`
Expected: FAIL with `AssertionError [ERR_ASSERTION]: claude-plugin/hooks/hooks.json: PreToolUse timeout 5s is below 30s`

- [ ] **Step 9: Update the hook configs**

`.heli-harness/adapters/claude-plugin/hooks/hooks.json` — delete the `"commandWindows": ...` line in the SessionStart hook (line 10) and in the PreToolUse hook (line 24), and change the PreToolUse `"timeout": 5,` (line 25) to `"timeout": 30,`. Result (Task 5 changes the matcher later):

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/heli-session-start.mjs\"",
            "timeout": 5,
            "statusMessage": "Loading Heli-Harness context..."
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash|Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/heli-pre-tool-use.mjs\"",
            "timeout": 30,
            "statusMessage": "Checking Heli-Harness safety policy..."
          }
        ]
      }
    ]
  }
}
```

`.heli-harness/adapters/codex-plugin/hooks/hooks.json` — replace the PreToolUse `commandWindows` and `timeout` lines (24-25) with:

```json
            "commandWindows": "if (Get-Command node -ErrorAction SilentlyContinue) { node \"$env:CLAUDE_PLUGIN_ROOT\\hooks\\heli-pre-tool-use.mjs\" } else { '{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"Heli-Harness could not run because node was not found on PATH; denying (fail-closed). Install Node.js 20+ and restart Codex.\"}}' }",
            "timeout": 30,
```

(Leave the SessionStart hook's `commandWindows` and `timeout: 5` unchanged.)

Change only the PreToolUse timeout to `30` in: `.heli-harness/adapters/grok-plugin/hooks/hooks.json` line 23 (`"timeout": 5,` → `"timeout": 30,`), `.heli-harness/adapters/grok-plugin/hooks/heli-user-hooks.json` line 21 (`"timeout": 5` → `"timeout": 30`), `.heli-harness/adapters/grok-plugin/install-user-hooks.mjs` line 52 (inside the `PreToolUse` block: `timeout: 5,` → `timeout: 30,`), `.heli-harness/adapters/kimi-plugin/hooks/hooks.json` line 21 (`"timeout": 10` → `"timeout": 30`), `.heli-harness/adapters/kimi-plugin/install-user-hooks.mjs` line 36 (the `timeout = 10` under `event = "PreToolUse"` → `timeout = 30`), `.heli-harness/adapters/kimi-plugin/config.toml.example` line 9 (the `timeout = 10` under the PreToolUse block → `timeout = 30`), `.heli-harness/adapters/antigravity-plugin/hooks.json` line 24 (`"timeout": 5` → `"timeout": 30`), `.heli-harness/adapters/antigravity-plugin/hooks/hooks.json` line 22 (`"timeout": 5` → `"timeout": 30`). SessionStart timeouts stay as they are.

Run: `node scripts/smoke-hook-configs.mjs`
Expected: `hook configs smoke ok`

- [ ] **Step 10: Register the tests, regress, commit**

In `package.json` `scripts.check`, replace `node scripts/smoke-vnext-hooks.mjs &&` with `node scripts/smoke-vnext-hooks.mjs && node scripts/smoke-hook-fail-closed.mjs && node scripts/smoke-hook-configs.mjs && node scripts/smoke-fs-atomic.mjs &&`.

Run: `node scripts/sync-plugin-shared.mjs --check && unset HELI_SESSION_ID; for t in smoke-claude-plugin smoke-codex-plugin smoke-grok-plugin smoke-kimi-plugin smoke-antigravity-plugin smoke-opencode-plugin smoke-yolo-mode quality-guard-strictness; do node scripts/$t.mjs > /dev/null 2>&1 && echo "ok $t" || echo "FAIL $t"; done`
Expected: eight `ok ...` lines (`smoke-claude-plugin` also runs `claude plugin validate` on the edited hooks.json when the `claude` CLI is installed; it must pass).

Run the full-chain runner from Global Constraints. Expected: `FAILED: ["node scripts/smoke-portable-targets.mjs"]`.

```bash
git add .heli-harness/adapters scripts/smoke-hook-fail-closed.mjs scripts/smoke-fs-atomic.mjs scripts/smoke-hook-configs.mjs package.json
git status --short
git commit -m "fix: fail closed when PreToolUse hooks cannot evaluate" -m "Wrappers deny on malformed or empty input, broken workspace state and internal errors, print the decision before audit writes, and isolate side effects. Atomic writes retry Windows sharing violations instead of deleting the target first. PreToolUse timeouts are 30 s, Claude hooks drop the Codex-only commandWindows field, and the Codex Windows fallback denies when node is missing." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Evaluate every command rule over a built-in T6 floor

**Files:**
- Create: `.heli-harness/adapters/shared/command-policy.mjs`
- Modify: `.heli-harness/adapters/shared/hook-core.mjs:21-24` (imports), `:247-249` (`isLikelyShellMutation` head), `:306-322` (`scopedGrantFor`), `:370-662` (`evaluatePreToolUse` through end of file)
- Modify: `.heli-harness/adapters/shared/concurrency/grant.mjs` (add `findUsableGrant` before `consumeApplicableGrant`)
- Create: `scripts/smoke-command-rules.mjs`
- Modify: `scripts/quality-guard-strictness.mjs:13`, `:196-198`, `:589-591`
- Modify: `scripts/smoke-opencode-plugin.mjs:3-4`, `:29-31`
- Modify: `package.json`
- Generated: plugin `shared/` copies

**Interfaces:**
- Consumes: `scrubHeliProcessEnv` (Task 1); fail-closed wrappers (Task 2).
- Produces (Tasks 4–5 extend these):
  - `command-policy.mjs`: `programName(token): string`; `analyzeCommand(command) → { segments: Array<{ tokens: string[] /* lowercased, git global options removed */, rawTokens: string[], text: string, dialect: "posix"|"windows" }> }`; `normalizeGitTokens(tokens)`; `commandRuleTokens(value)`; `commandMatchesRuleTokens(commandTokens, ruleTokens)`; `BUILTIN_COMMAND_RULES` (entries `{ id, tier, kind?, summary, reason, test(tokens) → false|true|string }`); `loadCommandRules(workspaceRoot) → { status: "no-workspace"|"ok"|"missing"|"malformed", rulesPath, projectRules }`; `matchCommandRules(analysis, projectRules) → Array<{ id, tier, kind, summary, reason, source }>`; `commandRunsGitPush(analysis): boolean`; `hardDenyReason(match)`; `approvalReason(match)`; `evaluateCommandRules(workspaceRoot, command, env) → { status, rulesPath, analysis, gitPush, hardDenies, approvals }`.
  - `hook-core.mjs`: new export `isShellTool(toolName): boolean`; `evaluatePreToolUse` result may carry `hardDeny`, `ruleId`, `ruleIds`, `missingApprovals`, `grants`; codes `TIER_BLOCKED`, `TIER_APPROVAL_REQUIRED`, `REMOTE_PUSH_DENIED`, `ENV_WRITE_DENIED`, `COMMAND_RULES_UNAVAILABLE`, `GRANT_NO_LONGER_AVAILABLE`. `evaluateCommandTierRules` is removed; `commandRuleTokens`/`commandMatchesRuleTokens` are re-exported from hook-core.
  - `grant.mjs`: `findUsableGrant(workspaceRoot, { action, sessionId, resource, env }) → grant | null` (policy check + read-only lookup).

- [ ] **Step 1: Write the failing table-driven test**

Create `scripts/smoke-command-rules.mjs`:

```js
#!/usr/bin/env node
/**
 * Command rules: every rule is evaluated, T6 can never be approved, each T5
 * needs its own approval, grants are consumed only on a final allow, and a
 * built-in T6 floor survives an empty/missing/malformed rules file.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeCommand, commandRunsGitPush, matchCommandRules } from "../.heli-harness/adapters/shared/command-policy.mjs";
import { evaluatePreToolUse } from "../.heli-harness/adapters/shared/hook-core.mjs";
import { issueGrant, listGrants } from "../lib/concurrency/grant.mjs";
import { projectWorkspaceKey } from "../lib/concurrency/project-binding.mjs";
import { scrubHeliProcessEnv } from "./lib/hermetic-env.mjs";

scrubHeliProcessEnv();
const root = process.cwd();
const scratch = mkdtempSync(join(tmpdir(), "heli-command-rules-"));
const env = { ...process.env, HELI_CONFIG_DIR: join(scratch, "config"), HELI_DATA_DIR: join(scratch, "data") };
const shippedRules = readFileSync(join(root, ".heli-harness", "safety", "command-rules.json"), "utf8");

// ---------------------------------------------------------------- parsing
const T6_TABLE = [
	["rm -rf build", ["destructive-delete"]],
	["rm -fr build", ["destructive-delete"]],
	["rm -r -f build", ["destructive-delete"]],
	["rm -Rf build", ["destructive-delete"]],
	["rm --recursive --force build", ["destructive-delete"]],
	["sudo /bin/rm -rf /", ["destructive-delete"]],
	["\"rm\" -rf x", ["destructive-delete"]],
	["r\\m -rf x", ["destructive-delete"]],
	["git clean -fdx", ["git-clean-force"]],
	["git clean -xfd", ["git-clean-force"]],
	["git clean -f -d", ["git-clean-force"]],
	["git clean --force -x", ["git-clean-force"]],
	["rd /s /q build", ["windows-rmdir"]],
	["rmdir /s /q build", ["windows-rmdir"]],
	["RD /S/Q build", ["windows-rmdir"]],
	["del /s /q *.tmp", ["windows-del"]],
	["Remove-Item -Recurse -Force src", ["powershell-remove-item-recurse-force"]],
	["Remove-Item src -Force -Recurse", ["powershell-remove-item-recurse-force"]],
	["Remove-Item -r -fo src", ["powershell-remove-item-recurse-force"]],
	["git reset --hard", ["git-reset-hard"]],
	["git -C repo reset --hard HEAD~1", ["git-reset-hard"]],
	["find . -delete", ["find-delete"]],
	["find src -type f -delete", ["find-delete"]],
	["git push --force origin main", ["git-push-force"]],
	["git push -f", ["git-push-force"]],
	["git push --force-with-lease", ["git-push-force"]],
	["git push origin +main", ["git-push-force"]],
	["bash -c 'rm -rf /'", ["destructive-delete"]],
	["sh -c \"git reset --hard\"", ["git-reset-hard"]],
	["cmd /c rd /s /q C:\\build", ["windows-rmdir"]],
	["pwsh -Command \"Remove-Item -Recurse -Force src\"", ["powershell-remove-item-recurse-force"]],
	["powershell -EncodedCommand " + Buffer.from("Remove-Item -Recurse -Force src", "utf16le").toString("base64"), ["powershell-remove-item-recurse-force"]],
	["echo ok && rm -rf dist", ["destructive-delete"]],
	["true || rm -rf dist", ["destructive-delete"]],
	["ls | xargs rm -rf", ["destructive-delete"]],
	["echo $(rm -rf dist)", ["destructive-delete"]],
	["echo `git reset --hard`", ["git-reset-hard"]],
	["ls\nrm -rf dist", ["destructive-delete"]],
	["eval 'git reset --hard'", ["git-reset-hard"]],
	// Legitimate, non-destructive commands must not match any built-in rule.
	["rm -f build.log", []],
	["rm -r build", []],
	["git clean -n", []],
	["git clean -fdn", []],
	["Remove-Item file.txt", []],
	["Remove-Item -Recurse src", []],
	["find . -name '*.pyc' -delete", []],
	["git reset --soft HEAD~1", []],
	["git push origin main", []],
	["echo 'a; b'", []],
	["npm test", []],
];
for (const [command, expected] of T6_TABLE) {
	const got = matchCommandRules(analyzeCommand(command)).map((match) => match.id).sort();
	assert.deepEqual(got, [...expected].sort(), `built-in rules for ${JSON.stringify(command)}`);
}

const PUSH_TABLE = [
	["git push", true],
	["git -C . push", true],
	["git -c user.name=x push", true],
	["git --git-dir=.git push", true],
	["git --no-pager push", true],
	["\"git\" push", true],
	["g\\it push", true],
	["GIT PUSH", true],
	["git \\\npush", true],
	["bash -c 'git push'", true],
	["cmd /c git push", true],
	["pwsh -Command git push", true],
	["echo digit pushups", false],
	["getprop | grep push", false],
	["git pull", false],
	["git -C push status", false],
];
for (const [command, expected] of PUSH_TABLE) {
	assert.equal(commandRunsGitPush(analyzeCommand(command)), expected, `git push detection for ${JSON.stringify(command)}`);
}

// ------------------------------------------------------------ evaluation
function workspace(name, rulesText = shippedRules, taskText = "# Current Task\n\nTarget repo: demo\n\nCurrent status: in progress\n\nFailed attempts count: 0\n") {
	const dir = join(scratch, name);
	mkdirSync(join(dir, ".heli-harness", "state"), { recursive: true });
	writeFileSync(join(dir, ".heli-harness", "HARNESS.md"), "# Heli\n");
	writeFileSync(join(dir, ".heli-harness", "state", "current-task.md"), taskText);
	if (rulesText != null) {
		mkdirSync(join(dir, ".heli-harness", "safety"), { recursive: true });
		writeFileSync(join(dir, ".heli-harness", "safety", "command-rules.json"), rulesText);
	}
	return dir;
}

function bash(cwd, command, extraEnv = {}) {
	return evaluatePreToolUse({ cwd, host: "test", env: { ...env, ...extraEnv }, toolName: "Bash", toolInput: { command } });
}

function writeFile(cwd, filePath) {
	return evaluatePreToolUse({ cwd, host: "test", env, toolName: "Write", toolInput: { file_path: filePath, content: "x" } });
}

function grant(ws, action) {
	return issueGrant(ws, { action, scope: "once", resource: { type: "workspace", id: projectWorkspaceKey(ws, { env }) }, env });
}

function remainingUses(ws, grantId) {
	return listGrants(ws, { activeOnly: false, env }).find((item) => item.grantId === grantId).remainingUses;
}

try {
	const ws = workspace("main");

	// A granted T5 cannot hide a T6 in the same command; the T5 grant is not spent.
	const tagGrant = grant(ws, "command.approval.git-tag");
	const mixed = bash(ws, "git tag v1.0.0 && rm -rf build");
	assert.equal(mixed.deny, true);
	assert.equal(mixed.hardDeny, true);
	assert.equal(mixed.code, "TIER_BLOCKED");
	assert.deepEqual(mixed.ruleIds, ["destructive-delete"]);
	assert.equal(remainingUses(ws, tagGrant.grantId), 1, "a denied call must not consume the T5 grant");

	// T6 is never approvable: not by HELI_ALLOW_COMMAND, not by YOLO.
	assert.equal(bash(ws, "rm -rf build", { HELI_ALLOW_COMMAND: "destructive-delete" }).code, "TIER_BLOCKED");
	assert.equal(bash(ws, "git reset --hard", { HELI_YOLO: "1" }).code, "TIER_BLOCKED");
	assert.match(bash(ws, "rm -rf build").reason, /tier T6.*hard deny/s);

	// Every matched T5 needs its own approval; consumption happens only on allow.
	const needsTwo = bash(ws, "git tag v1.0.0 && npm publish");
	assert.equal(needsTwo.deny, true);
	assert.equal(needsTwo.code, "TIER_APPROVAL_REQUIRED");
	assert.deepEqual(needsTwo.missingApprovals, ["command.approval.npm-publish"]);
	assert.equal(remainingUses(ws, tagGrant.grantId), 1);
	const publishGrant = grant(ws, "command.approval.npm-publish");
	const both = bash(ws, "git tag v1.0.0 && npm publish");
	assert.equal(both.deny, false, both.reason);
	assert.deepEqual(both.grants.map((item) => item.action).sort(), ["command.approval.git-tag", "command.approval.npm-publish"]);
	assert.equal(remainingUses(ws, tagGrant.grantId), 0);
	assert.equal(remainingUses(ws, publishGrant.grantId), 0);

	// Force push is its own T5 on top of git.push.
	const pushGrant = grant(ws, "git.push");
	const force = bash(ws, "git push --force origin main");
	assert.equal(force.deny, true);
	assert.deepEqual(force.missingApprovals, ["command.approval.git-push-force"]);
	assert.equal(remainingUses(ws, pushGrant.grantId), 1);
	grant(ws, "command.approval.git-push-force");
	assert.equal(bash(ws, "git push --force origin main").deny, false);

	// Legitimate commands stay allowed; a valid grant allows a plain push.
	for (const command of ["rm -f build.log", "git clean -n", "Remove-Item file.txt", "git status", "npm test"]) {
		const result = bash(ws, command);
		assert.equal(result.deny, false, `${command}: ${result.reason}`);
	}
	grant(ws, "git.push");
	assert.equal(bash(ws, "git push origin main").deny, false);
	assert.equal(bash(ws, "git push origin main").code, "REMOTE_PUSH_DENIED", "a once grant allows exactly one push");

	// A grant is not consumed when a later check denies (stuck task gate).
	const stuck = workspace("stuck", shippedRules, "# Current Task\n\nTarget repo: demo\n\nCurrent status: blocked\n\nFailed attempts count: 2\n");
	const envGrant = grant(stuck, "env.write");
	const stuckWrite = writeFile(stuck, ".env");
	assert.equal(stuckWrite.deny, true);
	assert.match(stuckWrite.reason, /failed attempts/);
	assert.equal(remainingUses(stuck, envGrant.grantId), 1, "env.write grant must survive a later deny");

	// Rules file states. Built-ins survive an empty file; a project rule cannot
	// weaken a built-in id.
	const empty = workspace("empty-rules", JSON.stringify({ version: 1, rules: [] }));
	assert.equal(bash(empty, "rm -rf build").code, "TIER_BLOCKED");
	assert.equal(bash(empty, "npm publish").deny, false, "no project T5 rules -> npm publish is not gated");
	const weakened = workspace("weakened-rules", JSON.stringify({ version: 1, rules: [{ id: "destructive-delete", match: "rm -rf", tier: "T4", reason: "downgrade attempt" }] }));
	assert.equal(bash(weakened, "rm -rf build").code, "TIER_BLOCKED");

	for (const [name, rulesText, status] of [["malformed-rules", "{not json", "malformed"], ["missing-rules", null, "missing"]]) {
		const dir = workspace(name, rulesText);
		const denied = bash(dir, "git status");
		assert.equal(denied.code, "COMMAND_RULES_UNAVAILABLE", `${name}: ${denied.reason}`);
		assert.match(denied.reason, new RegExp(`command-rules\\.json is ${status}`));
		assert.equal(writeFile(dir, "notes.txt").deny, false, `${name}: file edits are not affected`);
		assert.equal(bash(dir, "rm -rf build").code, "TIER_BLOCKED", `${name}: the built-in floor still applies`);
		assert.equal(bash(dir, "git status", { HELI_YOLO: "1" }).deny, false, `${name}: YOLO skips approval rules`);
	}

	// A directory with no Heli binding at all must not start denying everything.
	const plain = join(scratch, "no-heli");
	mkdirSync(plain, { recursive: true });
	for (const command of ["npm test", "git status", "ls -la"]) {
		assert.equal(bash(plain, command).deny, false, `no-binding ${command}`);
	}
	assert.equal(writeFile(plain, "notes.txt").deny, false);
	assert.equal(bash(plain, "rm -rf /").code, "TIER_BLOCKED", "the T6 floor applies everywhere hooks run");

	console.log("command rules smoke ok");
} finally {
	rmSync(scratch, { recursive: true, force: true });
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `unset HELI_SESSION_ID; node scripts/smoke-command-rules.mjs`
Expected: FAIL with `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../.heli-harness/adapters/shared/command-policy.mjs'`

- [ ] **Step 3: Create the command-policy module**

Create `.heli-harness/adapters/shared/command-policy.mjs`:

```js
/**
 * Command policy: parse shell command text and evaluate command rules.
 *
 * - Every rule is evaluated (no first-match short circuit): any T6 match is a
 *   hard deny; every matched T5 rule needs its own approval.
 * - BUILTIN_COMMAND_RULES is a non-removable floor. Project/workspace rules from
 *   safety/command-rules.json may ADD rules; a project rule that reuses a
 *   built-in id is ignored, so a built-in can never be removed or weakened.
 * - Parsing is best-effort normalization, not a sandbox: quotes and escapes are
 *   removed, chains/pipes/subshells are split into segments, git global options
 *   are skipped, and sh/bash/cmd/pwsh/powershell/eval payloads are unwrapped.
 *   Each segment is read in a POSIX and a Windows dialect; a rule matches if
 *   ANY plausible reading matches.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathsFor } from "./concurrency/paths.mjs";

const MAX_UNWRAP_DEPTH = 4;
const POSIX_SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish"]);
const GIT_OPTIONS_WITH_VALUE = new Set(["-c", "--git-dir", "--work-tree", "--namespace"]);

/** Lowercased program name of a token: strips directories and .exe/.cmd/.bat/.com/.ps1. */
export function programName(token) {
	const base = String(token ?? "").toLowerCase().replaceAll("\\", "/").split("/").pop();
	return base.replace(/\.(exe|cmd|bat|com|ps1)$/, "");
}

function splitSegments(text, dialect) {
	// Line continuations join lines: `\`+newline (POSIX), backtick/caret+newline
	// (PowerShell/cmd). Remaining backticks/carets are Windows escape characters.
	const source = dialect === "windows"
		? text.replace(/[`^]\r?\n/g, " ").replace(/[`^]/g, "")
		: text.replace(/\\\r?\n/g, "");
	const segments = [];
	let current = "";
	let quote = null;
	for (let i = 0; i < source.length; i += 1) {
		const ch = source[i];
		if (quote) {
			current += ch;
			if (dialect === "posix" && quote === "\"" && ch === "\\" && i + 1 < source.length) {
				current += source[++i];
				continue;
			}
			if (ch === quote) quote = null;
			continue;
		}
		if (ch === "'" || ch === "\"") {
			quote = ch;
			current += ch;
			continue;
		}
		if (dialect === "posix" && ch === "\\" && i + 1 < source.length) {
			current += ch + source[++i];
			continue;
		}
		const prev = source[i - 1];
		const next = source[i + 1];
		const redirectAmpersand = ch === "&" && (prev === ">" || prev === "<" || next === ">");
		const separator =
			!redirectAmpersand &&
			(ch === ";" || ch === "\n" || ch === "\r" || ch === "|" || ch === "&" || ch === "(" || ch === ")" ||
				(dialect === "posix" && ch === "`"));
		if (separator) {
			if (current.trim()) segments.push(current.trim());
			current = "";
			continue;
		}
		current += ch;
	}
	if (current.trim()) segments.push(current.trim());
	return segments;
}

function tokenize(segment, dialect) {
	const tokens = [];
	let current = "";
	let inToken = false;
	let quote = null;
	for (let i = 0; i < segment.length; i += 1) {
		const ch = segment[i];
		if (quote) {
			if (ch === quote) {
				quote = null;
				continue;
			}
			if (dialect === "posix" && quote === "\"" && ch === "\\" && i + 1 < segment.length && "\"\\$`\n".includes(segment[i + 1])) {
				current += segment[++i];
				continue;
			}
			current += ch;
			continue;
		}
		if (ch === "'" || ch === "\"") {
			quote = ch;
			inToken = true;
			continue;
		}
		if (dialect === "posix" && ch === "\\" && i + 1 < segment.length) {
			current += segment[++i];
			inToken = true;
			continue;
		}
		if (/\s/.test(ch)) {
			if (inToken && current) tokens.push(current);
			current = "";
			inToken = false;
			continue;
		}
		current += ch;
		inToken = true;
	}
	if (inToken && current) tokens.push(current);
	return tokens;
}

function decodePowerShellBase64(value) {
	try {
		return Buffer.from(String(value), "base64").toString("utf16le");
	} catch {
		return "";
	}
}

/** Inner command strings run by sh/bash -c, cmd /c, pwsh/powershell -Command|-EncodedCommand, eval. */
function unwrapPayloads(tokens) {
	const payloads = [];
	for (let i = 0; i < tokens.length; i += 1) {
		const program = programName(tokens[i]);
		if (POSIX_SHELLS.has(program)) {
			for (let j = i + 1; j < tokens.length; j += 1) {
				if (/^-[a-z]*c[a-z]*$/i.test(tokens[j]) && j + 1 < tokens.length) {
					payloads.push(tokens[j + 1]);
					break;
				}
				if (!tokens[j].startsWith("-")) break;
			}
		} else if (program === "cmd") {
			const flag = tokens.findIndex((token, index) => index > i && /^\/[ck]$/i.test(token));
			if (flag > i) payloads.push(tokens.slice(flag + 1).join(" "));
		} else if (program === "powershell" || program === "pwsh") {
			for (let j = i + 1; j < tokens.length; j += 1) {
				const option = tokens[j].toLowerCase();
				if (option.length >= 2 && "-command".startsWith(option)) {
					payloads.push(tokens.slice(j + 1).join(" "));
					break;
				}
				if ((option === "-e" || option === "-ec" || (option.length >= 3 && "-encodedcommand".startsWith(option))) && j + 1 < tokens.length) {
					payloads.push(decodePowerShellBase64(tokens[j + 1]));
					break;
				}
			}
		} else if (program === "eval") {
			payloads.push(tokens.slice(i + 1).join(" "));
		}
	}
	return payloads.filter((payload) => payload && payload.trim());
}

/**
 * Parse command text into de-duplicated segments.
 * @returns {{ segments: Array<{ tokens: string[], rawTokens: string[], text: string, dialect: "posix"|"windows" }> }}
 *   `tokens` are lowercased with git global options removed; `rawTokens` keep case.
 */
export function analyzeCommand(command) {
	const segments = [];
	const seen = new Set();
	const visit = (source, depth) => {
		if (!String(source ?? "").trim() || depth > MAX_UNWRAP_DEPTH) return;
		for (const dialect of ["posix", "windows"]) {
			for (const text of splitSegments(String(source), dialect)) {
				const rawTokens = tokenize(text, dialect);
				if (!rawTokens.length) continue;
				const tokens = normalizeGitTokens(rawTokens.map((token) => token.toLowerCase()));
				const key = `${dialect}\u0000${tokens.join("\u0000")}`;
				if (!seen.has(key)) {
					seen.add(key);
					segments.push({ tokens, rawTokens, text, dialect });
				}
				for (const payload of unwrapPayloads(rawTokens)) visit(payload, depth + 1);
			}
		}
	};
	visit(command, 0);
	return { segments };
}

/** Drop git global options (`-C dir`, `-c k=v`, `--git-dir=x`, `--no-pager`, ...) so `git -C . push` reads as `git push`. */
export function normalizeGitTokens(tokens) {
	const out = [];
	for (let i = 0; i < tokens.length; i += 1) {
		out.push(tokens[i]);
		if (programName(tokens[i]) !== "git") continue;
		let j = i + 1;
		while (j < tokens.length && tokens[j].startsWith("-")) {
			const option = tokens[j];
			j += 1;
			if (!option.includes("=") && GIT_OPTIONS_WITH_VALUE.has(option)) j += 1;
		}
		i = j - 1;
	}
	return out;
}

/**
 * Split a rule's `match` into lowercase tokens.
 * Separators become boundaries and surrounding quotes are stripped.
 */
export function commandRuleTokens(value) {
	return String(value ?? "")
		.toLowerCase()
		.replace(/[;&|()\r\n]/g, " ")
		.split(/\s+/)
		.map((token) => token.replace(/^["'`]+/, "").replace(/["'`]+$/, ""))
		.filter(Boolean);
}

/**
 * Program-position tokens also match a path-qualified invocation of the same
 * program (`node .heli-harness/heli.mjs push` trips `heli.mjs push`). Applied to
 * the FIRST rule token only.
 */
function commandTokenMatches(commandToken, ruleToken, isProgramPosition) {
	if (commandToken === ruleToken) return true;
	if (!isProgramPosition) return false;
	return commandToken.endsWith(`/${ruleToken}`) || commandToken.endsWith(`\\${ruleToken}`);
}

/** True when the rule tokens appear as a consecutive run in the command tokens. */
export function commandMatchesRuleTokens(commandTokens, ruleTokens) {
	if (!ruleTokens.length || ruleTokens.length > commandTokens.length) return false;
	for (let start = 0; start + ruleTokens.length <= commandTokens.length; start += 1) {
		let hit = true;
		for (let offset = 0; offset < ruleTokens.length; offset += 1) {
			if (!commandTokenMatches(commandTokens[start + offset], ruleTokens[offset], offset === 0)) {
				hit = false;
				break;
			}
		}
		if (hit) return true;
	}
	return false;
}

function indexesOfProgram(tokens, names) {
	const found = [];
	tokens.forEach((token, index) => {
		if (names.includes(programName(token))) found.push(index);
	});
	return found;
}

function argsAfter(tokens, index) {
	const args = [];
	for (const token of tokens.slice(index + 1)) {
		if (token === "--") break;
		args.push(token);
	}
	return args;
}

function shortFlags(token) {
	return /^-[a-z]+$/.test(token) ? token.slice(1) : "";
}

function gitSubcommandArgs(tokens, subcommand) {
	for (const index of indexesOfProgram(tokens, ["git"])) {
		if (tokens[index + 1] === subcommand) return tokens.slice(index + 2);
	}
	return null;
}

function rmRecursiveForce(tokens) {
	return indexesOfProgram(tokens, ["rm"]).some((index) => {
		let recursive = false;
		let force = false;
		for (const arg of argsAfter(tokens, index)) {
			if (arg === "--recursive") recursive = true;
			else if (arg === "--force") force = true;
			else if (shortFlags(arg)) {
				if (/r/.test(shortFlags(arg))) recursive = true;
				if (/f/.test(shortFlags(arg))) force = true;
			}
		}
		return recursive && force;
	});
}

function gitCleanForce(tokens) {
	const args = gitSubcommandArgs(tokens, "clean");
	if (!args) return false;
	let force = false;
	let dirsOrIgnored = false;
	let dryRun = false;
	for (const arg of args) {
		if (arg === "--force") force = true;
		else if (arg === "--dry-run") dryRun = true;
		else if (shortFlags(arg)) {
			const flags = shortFlags(arg);
			if (flags.includes("f")) force = true;
			if (flags.includes("d") || flags.includes("x")) dirsOrIgnored = true;
			if (flags.includes("n")) dryRun = true;
		}
	}
	return force && dirsOrIgnored && !dryRun;
}

function gitResetHard(tokens) {
	const args = gitSubcommandArgs(tokens, "reset");
	return Boolean(args && args.includes("--hard"));
}

function gitPushForce(tokens) {
	const args = gitSubcommandArgs(tokens, "push");
	if (!args) return false;
	return args.some((arg) =>
		arg === "--force" ||
		arg.startsWith("--force-with-lease") ||
		arg === "--force-if-includes" ||
		(shortFlags(arg) && shortFlags(arg).includes("f")) ||
		(arg.startsWith("+") && arg.length > 1),
	);
}

function hasWindowsSwitch(args, name) {
	return args.some((arg) => arg.startsWith("/") && arg.split("/").includes(name));
}

function cmdRecursiveRmdir(tokens) {
	return indexesOfProgram(tokens, ["rd", "rmdir"]).some((index) => hasWindowsSwitch(argsAfter(tokens, index), "s"));
}

function cmdRecursiveDel(tokens) {
	return indexesOfProgram(tokens, ["del", "erase"]).some((index) => hasWindowsSwitch(argsAfter(tokens, index), "s"));
}

function powerShellParam(arg, fullName, minLength) {
	const name = arg.split(":")[0];
	return name.length >= minLength && fullName.startsWith(name);
}

function removeItemRecurseForce(tokens) {
	return indexesOfProgram(tokens, ["remove-item", "ri", "rm", "rmdir", "rd", "del", "erase"]).some((index) => {
		const args = argsAfter(tokens, index);
		const recurse = args.some((arg) => powerShellParam(arg, "-recurse", 2));
		const force = args.some((arg) => powerShellParam(arg, "-force", 3));
		return recurse && force;
	});
}

const FIND_NAME_FILTERS = new Set(["-name", "-iname", "-path", "-ipath", "-wholename", "-iwholename", "-regex", "-iregex"]);

/** `find ... -delete` without a name/path filter (e.g. `find . -delete`, `find src -type f -delete`). */
function findDelete(tokens) {
	return indexesOfProgram(tokens, ["find"]).some((index) => {
		const args = argsAfter(tokens, index);
		return args.includes("-delete") && !args.some((arg) => FIND_NAME_FILTERS.has(arg));
	});
}

/**
 * Non-removable built-in rules. Ids that also appear in the shipped
 * command-rules.json are intentional: the built-in wins over the file copy.
 * A rule's `test(tokens)` returns false, true, or a string that replaces
 * `summary` in the deny reason. `kind` (optional) replaces "destructive command".
 */
export const BUILTIN_COMMAND_RULES = Object.freeze([
	Object.freeze({ id: "destructive-delete", tier: "T6", summary: "rm -rf", reason: "Recursive forced delete is destructive", test: rmRecursiveForce }),
	Object.freeze({ id: "git-clean-force", tier: "T6", summary: "git clean -f with -d/-x", reason: "git clean with force and -d/-x deletes untracked work", test: gitCleanForce }),
	Object.freeze({ id: "git-reset-hard", tier: "T6", summary: "git reset --hard", reason: "git reset --hard discards local work", test: gitResetHard }),
	Object.freeze({ id: "windows-rmdir", tier: "T6", summary: "rd/rmdir /s", reason: "Recursive delete is destructive", test: cmdRecursiveRmdir }),
	Object.freeze({ id: "windows-del", tier: "T6", summary: "del/erase /s", reason: "Recursive delete is destructive", test: cmdRecursiveDel }),
	Object.freeze({ id: "powershell-remove-item-recurse-force", tier: "T6", summary: "Remove-Item -Recurse -Force", reason: "Recursive forced delete is destructive", test: removeItemRecurseForce }),
	Object.freeze({ id: "find-delete", tier: "T6", summary: "find ... -delete", reason: "find -delete is destructive", test: findDelete }),
	Object.freeze({ id: "git-push-force", tier: "T5", summary: "git push --force", reason: "Force-pushing rewrites remote history", test: gitPushForce }),
]);

const BUILTIN_IDS = new Set(BUILTIN_COMMAND_RULES.map((rule) => rule.id));

/**
 * Load the workspace's command-rules.json.
 * status: "no-workspace" (not a Heli workspace: built-ins only), "ok", "missing" or "malformed".
 */
export function loadCommandRules(workspaceRoot) {
	if (!workspaceRoot) return { status: "no-workspace", rulesPath: null, projectRules: [] };
	const rulesPath = join(pathsFor(workspaceRoot).safetyDir, "command-rules.json");
	if (!existsSync(rulesPath)) return { status: "missing", rulesPath, projectRules: [] };
	let parsed;
	try {
		parsed = JSON.parse(readFileSync(rulesPath, "utf8"));
	} catch {
		return { status: "malformed", rulesPath, projectRules: [] };
	}
	if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.rules)) {
		return { status: "malformed", rulesPath, projectRules: [] };
	}
	const projectRules = parsed.rules
		.filter((rule) => rule && typeof rule.id === "string" && typeof rule.match === "string")
		.filter((rule) => rule.tier === "T5" || rule.tier === "T6")
		// git-push has a dedicated scoped check; built-in ids cannot be redefined.
		.filter((rule) => rule.id !== "git-push" && !BUILTIN_IDS.has(rule.id))
		.map((rule) => ({
			id: rule.id,
			tier: rule.tier,
			summary: rule.match,
			reason: rule.reason || "see safety/command-rules.json",
			ruleTokens: commandRuleTokens(rule.match),
			source: "project",
		}))
		.filter((rule) => rule.ruleTokens.length > 0);
	return { status: "ok", rulesPath, projectRules };
}

/** Every built-in and project rule that matches any segment of the command. */
export function matchCommandRules(analysis, projectRules = []) {
	const matches = new Map();
	for (const segment of analysis.segments) {
		for (const rule of BUILTIN_COMMAND_RULES) {
			if (matches.has(rule.id)) continue;
			const hit = rule.test(segment.tokens);
			if (hit) {
				matches.set(rule.id, {
					id: rule.id,
					tier: rule.tier,
					kind: rule.kind || null,
					summary: typeof hit === "string" ? hit : rule.summary,
					reason: rule.reason,
					source: "builtin",
				});
			}
		}
		for (const rule of projectRules) {
			if (!matches.has(rule.id) && commandMatchesRuleTokens(segment.tokens, rule.ruleTokens)) {
				matches.set(rule.id, { id: rule.id, tier: rule.tier, summary: rule.summary, reason: rule.reason, source: rule.source });
			}
		}
	}
	return [...matches.values()];
}

/** True when any segment runs `git ... push` (after git global options are removed). */
export function commandRunsGitPush(analysis) {
	return analysis.segments.some((segment) => commandMatchesRuleTokens(segment.tokens, ["git", "push"]));
}

export function hardDenyReason(match) {
	return `Heli-Harness blocks ${match.kind || "destructive command"} "${match.summary}" (rule ${match.id}, tier T6): ${match.reason}. This is a hard deny; scoped grants, YOLO and HELI_ALLOW_COMMAND do not override it.`;
}

export function approvalReason(match) {
	return `Heli-Harness requires explicit approval for "${match.summary}" (rule ${match.id}, tier T5): ${match.reason}. Ask the user to run \`heli grant issue --action command.approval.${match.id} --scope once\` in their own terminal. Emergency/debug overrides remain HELI_ALLOW_COMMAND=${match.id} or YOLO.`;
}

/**
 * Evaluate a command against built-in + workspace rules.
 * @returns {{ status: string, rulesPath: string|null, analysis: object, gitPush: boolean, hardDenies: object[], approvals: object[] }}
 *   `approvals` excludes T5 ids approved via HELI_ALLOW_COMMAND; T6 is never approvable.
 */
export function evaluateCommandRules(workspaceRoot, command, env = process.env) {
	const loaded = loadCommandRules(workspaceRoot);
	const analysis = analyzeCommand(command);
	const matches = matchCommandRules(analysis, loaded.projectRules);
	const approved = new Set(String(env.HELI_ALLOW_COMMAND || "").split(",").map((value) => value.trim()).filter(Boolean));
	return {
		status: loaded.status,
		rulesPath: loaded.rulesPath,
		analysis,
		gitPush: commandRunsGitPush(analysis),
		hardDenies: matches.filter((match) => match.tier === "T6"),
		approvals: matches.filter((match) => match.tier === "T5" && !approved.has(match.id)),
	};
}
```

- [ ] **Step 4: Run the test — parsing passes, evaluation still fails**

Run: `unset HELI_SESSION_ID; node scripts/smoke-command-rules.mjs`
Expected: FAIL at the first evaluation assertion (`assert.equal(mixed.deny, true)` → `false !== true`): the old hook still stops at the first (granted T5) rule and consumes it.

- [ ] **Step 5: Add a read-only grant lookup**

In `.heli-harness/adapters/shared/concurrency/grant.mjs`, insert immediately before `export function consumeApplicableGrant(workspaceRoot, {`:

```js
/**
 * Read-only lookup used by the hook to decide: policy-permitted AND a matching
 * active grant exists. Never creates directories and never consumes a use.
 */
export function findUsableGrant(workspaceRoot, {
	action,
	sessionId = null,
	resource = null,
	env = process.env,
} = {}) {
	const policy = evaluateGrantPolicy(workspaceRoot, action, { env });
	if (!policy.grantable || policy.hardDenied) return null;
	return findApplicableGrant(workspaceRoot, { action, sessionId, resource, env });
}

```

- [ ] **Step 6: Wire hook-core to the command policy**

In `.heli-harness/adapters/shared/hook-core.mjs`:

Edit A — replace lines 21-24:

```js
import { findWorkspaceRoot, pathsFor } from "./concurrency/paths.mjs";
import { consumeApplicableGrant } from "./concurrency/grant.mjs";
import { resourceIdForWorktree } from "./concurrency/resource-authority.mjs";
import { evaluateDiagnosisWriteGate, readActionPolicy, readDiagnosis } from "./concurrency/diagnosis.mjs";
```

with:

```js
import { findWorkspaceRoot } from "./concurrency/paths.mjs";
import { consumeApplicableGrant, findUsableGrant } from "./concurrency/grant.mjs";
import { resourceIdForWorktree } from "./concurrency/resource-authority.mjs";
import { evaluateDiagnosisWriteGate, readActionPolicy, readDiagnosis } from "./concurrency/diagnosis.mjs";
import { approvalReason, evaluateCommandRules, hardDenyReason } from "./command-policy.mjs";

export { commandRuleTokens, commandMatchesRuleTokens } from "./command-policy.mjs";
```

Edit B — replace lines 247-249:

```js
export function isLikelyShellMutation(toolName, commandText) {
	const name = String(toolName ?? "").toLowerCase();
	if (!/(^|[_\-.])(bash|shell|terminal|exec|run_command|run-command)($|[_\-.])/.test(name)) return false;
```

with:

```js
const SHELL_TOOL_NAME_RE = /(^|[_\-.])(bash|shell|terminal|exec|run_command|run-command)($|[_\-.])/;

/** Tools whose `command` is executed by a shell (MCP tools never are). */
export function isShellTool(toolName) {
	const name = String(toolName ?? "").toLowerCase();
	if (name.startsWith("mcp__")) return false;
	return SHELL_TOOL_NAME_RE.test(name);
}

export function isLikelyShellMutation(toolName, commandText) {
	if (!isShellTool(toolName)) return false;
```

Edit C — replace the whole `scopedGrantFor` function (lines 306-322) with:

```js
function grantRequest(ctx, action, env) {
	return {
		action,
		sessionId: ctx.sessionId || null,
		resource: {
			type: "worktree",
			id: resourceIdForWorktree(ctx.worktreeRoot || ctx.workspaceRoot),
		},
		env,
	};
}

/** Read-only: is there a usable grant for this action? Never consumes a use. */
function findScopedGrant(ctx, action, env = process.env) {
	if (!ctx?.workspaceRoot || !action) return null;
	try {
		return findUsableGrant(ctx.workspaceRoot, grantRequest(ctx, action, env));
	} catch {
		// Malformed local grant state fails closed (no grant).
		return null;
	}
}

/** Consume one use; call only once the final decision is allow. */
function consumeScopedGrant(ctx, action, env = process.env) {
	if (!ctx?.workspaceRoot || !action) return null;
	try {
		return consumeApplicableGrant(ctx.workspaceRoot, grantRequest(ctx, action, env));
	} catch {
		// Grant-store contention fails closed.
		return null;
	}
}
```

Edit D — replace everything from `export function evaluatePreToolUse({` (line 370) to the end of the file (line 662, `export { resolveExecutionContext };`), which also deletes the old `commandRuleTokens`, `commandTokenMatches`, `commandMatchesRuleTokens` and `evaluateCommandTierRules`, with:

```js
export function evaluatePreToolUse({
	cwd,
	toolName = "",
	toolInput = {},
	writeToolNames = DEFAULT_FILE_WRITE_TOOL_NAMES,
	host = "unknown",
	hookPayload = null,
	env = process.env,
} = {}) {
	// PreToolUse must NOT mint a new session on every call — that recreates
	// global last-writer pollution via session spam. Resume via HELI_SESSION_ID,
	// external host id mapping, or worktree binding only.
	const ctx = resolveExecutionContext({
		cwd,
		environment: env,
		hookPayload: hookPayload || { tool_name: toolName, tool_input: toolInput },
		host,
		createIfMissing: false,
		refreshLeaseOnResolve: false,
	});

	const rawCommand = String(toolInput?.command ?? toolInput?.description ?? "");
	const paths = [...pathsFrom(toolInput), ...patchPathsFrom(rawCommand)].map((path) =>
		path.replaceAll("\\", "/").toLowerCase(),
	);
	const name = String(toolName);

	const shellMutation = isLikelyShellMutation(name, rawCommand);
	const isWrite = isFileMutationTool(name, { paths, writeToolNames }) || shellMutation;
	const taskStateOnly = isTaskStateWriteForContext(ctx, paths) || isTaskStateWrite(paths);
	let ownershipDecision = null;

	// Command rules: EVERY rule is evaluated (built-in floor + workspace file).
	// Any T6 match is a hard deny that dominates authority, grants, YOLO and
	// HELI_ALLOW_COMMAND, so it runs before ownership and before YOLO.
	const commandPolicy = rawCommand.trim() ? evaluateCommandRules(ctx.workspaceRoot, rawCommand, env) : null;
	if (commandPolicy?.hardDenies.length) {
		return {
			deny: true,
			hardDeny: true,
			code: "TIER_BLOCKED",
			ruleId: commandPolicy.hardDenies[0].id,
			ruleIds: commandPolicy.hardDenies.map((match) => match.id),
			reason: commandPolicy.hardDenies.map(hardDenyReason).join("\n"),
			ctx,
		};
	}

	// Ownership gates — NEVER bypassed by YOLO.
	if (isWrite && !taskStateOnly) {
		ownershipDecision = evaluateOwnershipGate(ctx, { isWrite: true });
		if (ownershipDecision.deny) {
			return {
				deny: true,
				reason: withCliHint(ownershipDecision.reason),
				code: ownershipDecision.code,
				ctx,
				coverage: shellMutation ? "shell-mutation-best-effort" : "structured-write",
			};
		}
	}

	if (isWrite && !taskStateOnly && ctx.concurrentMode && ctx.taskId && ctx.sessionId) {
		const activeOwner = sessionHoldsWriteLease(ctx.workspaceRoot, ctx.taskId, ctx.sessionId);
		if (activeOwner || ownershipDecision?.renewalRequired) {
			try {
				refreshLease(ctx.workspaceRoot, ctx.taskId, {
					sessionId: ctx.sessionId,
					allowExpiredOwn: Boolean(ownershipDecision?.renewalRequired),
				});
			} catch (error) {
				return {
					deny: true,
					reason: withCliHint(`Heli-Harness could not establish current write authority before execution: ${error.message}`),
					code: error.code || "LEASE_REFRESH_FAILED",
					ctx,
					coverage: shellMutation ? "shell-mutation-best-effort" : "structured-write",
				};
			}
		}
	}

	// Root-cause/reroute and structured expensive-action gates run before YOLO.
	// YOLO may reduce legacy workflow friction, but it must not make stale
	// diagnosis or unjustified costly retries silently executable.
	const diagnosis = ctx.taskId ? readDiagnosis(ctx.workspaceRoot, ctx.taskId) : null;
	const diagnosisGate = evaluateDiagnosisWriteGate(diagnosis, {
		riskTier: taskRiskTier(ctx),
		isWrite: isWrite && !taskStateOnly,
		action: structuredHeliAction(toolInput),
		policy: readActionPolicy(ctx.workspaceRoot || cwd),
	});
	if (!diagnosisGate.allowed) {
		return {
			deny: true,
			reason: withCliHint(diagnosisGate.reason || `Heli-Harness diagnosis gate: ${diagnosisGate.code}`),
			code: diagnosisGate.code,
			ctx,
		};
	}

	const scope = {
		workspaceRoot: ctx.workspaceRoot || cwd,
		cwd,
		taskId: ctx.taskId,
		sessionId: ctx.sessionId,
		env,
		legacyMode: ctx.legacyMode,
	};
	const yolo = resolveYolo(scope);
	if (yolo.active) {
		return { deny: false, yolo: true, yoloSource: yolo.source, ctx };
	}

	// A Heli workspace whose rules file is missing or unreadable cannot evaluate
	// T5 approvals: deny shell commands instead of silently skipping them.
	if (
		commandPolicy &&
		ctx.workspaceRoot &&
		isShellTool(name) &&
		(commandPolicy.status === "missing" || commandPolicy.status === "malformed")
	) {
		return {
			deny: true,
			code: "COMMAND_RULES_UNAVAILABLE",
			reason: `Heli-Harness cannot evaluate shell commands: the safety rules file ${commandPolicy.rulesPath} is ${commandPolicy.status}. Built-in hard-deny rules still apply, but approval rules cannot be checked, so shell commands are denied until the file is restored (restore it from version control, or run \`heli update\` in an embedded workspace; \`heli doctor\` helps diagnose). File edits are not affected.`,
			ctx,
		};
	}

	// Approval stage: collect EVERY required approval and look grants up
	// read-only. Grants are consumed only after the final decision is allow.
	const requirements = [];
	if (commandPolicy?.gitPush && !allowGitPushScoped(scope)) {
		requirements.push({
			action: "git.push",
			code: "REMOTE_PUSH_DENIED",
			reason:
				"Heli-Harness blocks git push without scoped authority. Ask the user to run `heli grant issue --action git.push --scope once` in their own terminal. Emergency/debug overrides remain HELI_ALLOW_GIT_PUSH or YOLO.",
		});
	}
	if (paths.some((path) => /(^|\/)\.env(\.|$)/.test(path)) && !allowEnvWriteScoped(scope)) {
		requirements.push({
			action: "env.write",
			code: "ENV_WRITE_DENIED",
			reason:
				"Heli-Harness blocks .env-style writes without scoped authority. Ask the user to run `heli grant issue --action env.write --scope once` in their own terminal.",
		});
	}
	for (const match of commandPolicy?.approvals || []) {
		requirements.push({
			action: `command.approval.${match.id}`,
			code: "TIER_APPROVAL_REQUIRED",
			ruleId: match.id,
			reason: approvalReason(match),
		});
	}
	const missing = requirements.filter((requirement) => !findScopedGrant(ctx, requirement.action, env));
	if (missing.length) {
		return {
			deny: true,
			code: missing[0].code,
			...(missing[0].ruleId ? { ruleId: missing[0].ruleId, actionId: missing[0].action } : {}),
			missingApprovals: missing.map((requirement) => requirement.action),
			reason: missing.map((requirement) => requirement.reason).join("\n"),
			ctx,
		};
	}

	if (isWrite && !taskStateOnly) {
		const gateReason = readTaskGateForContext(ctx) || readPlanGateForContext(ctx);
		if (gateReason) return { deny: true, reason: gateReason, ctx };
	}

	// Final decision is allow: consume one use of each approval now.
	const appliedGrants = [];
	for (const requirement of requirements) {
		const grant = consumeScopedGrant(ctx, requirement.action, env);
		if (!grant) {
			return {
				deny: true,
				code: "GRANT_NO_LONGER_AVAILABLE",
				reason: `Heli-Harness could not use the approval for ${requirement.action}: it was used up, revoked or expired while this call was evaluated. Ask the user to issue a new grant.`,
				ctx,
			};
		}
		appliedGrants.push(grant);
	}

	return {
		deny: false,
		ctx,
		...(appliedGrants.length
			? {
					grants: appliedGrants.map((grant) => ({
						grantId: grant.grantId,
						action: grant.action,
						scope: grant.scope,
						resource: grant.resource,
					})),
				}
			: {}),
	};
}

export { resolveExecutionContext };
```

- [ ] **Step 7: Sync and run the new test**

Run: `node --check .heli-harness/adapters/shared/hook-core.mjs && node scripts/sync-plugin-shared.mjs && unset HELI_SESSION_ID; node scripts/smoke-command-rules.mjs`
Expected: `command rules smoke ok`

- [ ] **Step 8: Update fixtures that assumed a missing rules file was harmless**

A Heli workspace now needs `safety/command-rules.json` for shell commands. Two existing tests used workspaces without it.

`scripts/quality-guard-strictness.mjs`:

Line 13: `import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";` → `import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";`

After lines 195-198 (the `writeFileSync(join(cleanDir, ".heli-harness", "workspace", "target.json"), JSON.stringify({ targetRepo: "demo" }),);` statement) insert:

```js
// A healthy workspace ships its command rules; a missing rules file denies shell commands.
mkdirSync(join(cleanDir, ".heli-harness", "safety"), { recursive: true });
writeFileSync(
	join(cleanDir, ".heli-harness", "safety", "command-rules.json"),
	readFileSync(join(root, ".heli-harness", "safety", "command-rules.json"), "utf8"),
);
```

Replace lines 589-591:

```js
	hard(`${name}: newline-separated "git\\npush" denied`, () => {
		expectDeny(rel, { tool_name: "Bash", tool_input: { command: "git\npush origin main" } }, /git push/i, tierDir);
	});
```

with (a bare newline separates two commands, so `git\npush` is `git` then `push`; the evasions that really push are line continuations and newline chains):

```js
	// A bare newline separates two commands (`git`, then `push ...`), so it is not a
	// push; a line continuation joins them into one, and that must be denied.
	hard(`${name}: line-continued "git \\\\<newline>push" denied`, () => {
		expectDeny(rel, { tool_name: "Bash", tool_input: { command: "git \\\npush origin main" } }, /git push/i, tierDir);
	});
	hard(`${name}: PowerShell line-continued "git \`<newline>push" denied`, () => {
		expectDeny(rel, { tool_name: "Bash", tool_input: { command: "git `\npush origin main" } }, /git push/i, tierDir);
	});
	hard(`${name}: newline-chained "echo ok\\ngit push" denied`, () => {
		expectDeny(rel, { tool_name: "Bash", tool_input: { command: "echo ok\ngit push origin main" } }, /git push/i, tierDir);
	});
```

`scripts/smoke-opencode-plugin.mjs`:

After line 3 (`import assert from "node:assert/strict";`) insert `import { readFileSync } from "node:fs";`.

In the first `withFixtureWorkspace({` call (lines 29-32), add the rules file after the HARNESS.md entry:

```js
await withFixtureWorkspace({
	".heli-harness/HARNESS.md": "# Heli-Harness\n",
	// A healthy workspace ships its command rules; a missing rules file denies shell commands.
	".heli-harness/safety/command-rules.json": readFileSync(join(root, ".heli-harness", "safety", "command-rules.json"), "utf8"),
	".heli-harness/state/current-task.md": "# Current Task\n\nTarget repo: demo\n\nCurrent status: blocked\n\nFailed attempts count: 2\n",
}, async (cwd) => {
```

Run: `unset HELI_SESSION_ID; node scripts/quality-guard-strictness.mjs | tail -8; node scripts/smoke-opencode-plugin.mjs`
Expected: `HARD: 332 passed, 0 failed` and `✅ quality-guard-strictness PASSED (hard asserts)`, then `smoke-opencode-plugin: ok`.

- [ ] **Step 9: Register the test, regress, commit**

In `package.json` `scripts.check`, replace `node scripts/smoke-yolo-mode.mjs &&` with `node scripts/smoke-yolo-mode.mjs && node scripts/smoke-command-rules.mjs &&`.

Run: `node scripts/sync-plugin-shared.mjs --check && unset HELI_SESSION_ID; for t in smoke-scoped-grants smoke-yolo-mode smoke-concurrency-foundation smoke-convergence-authority smoke-vnext-hooks smoke-hook-fail-closed smoke-extension-load smoke-acp-proxy; do node scripts/$t.mjs > /dev/null 2>&1 && echo "ok $t" || echo "FAIL $t"; done`
Expected: eight `ok ...` lines.

Run the full-chain runner from Global Constraints. Expected: `FAILED: ["node scripts/smoke-portable-targets.mjs"]`.

```bash
git add .heli-harness/adapters scripts/smoke-command-rules.mjs scripts/quality-guard-strictness.mjs scripts/smoke-opencode-plugin.mjs package.json
git status --short
git commit -m "fix: evaluate every command rule over a built-in T6 floor" -m "Rules are no longer first-match: any T6 hit is a hard deny that grants, YOLO and HELI_ALLOW_COMMAND cannot override, each T5 needs its own approval, and grants are consumed only on a final allow. A non-removable built-in floor covers recursive forced deletes (POSIX, cmd, PowerShell), git reset --hard, git clean -f with -d/-x, unfiltered find -delete and git push --force. Commands are normalized (quotes, escapes, git -C/-c, chains, sh/bash/cmd/pwsh payloads). A missing or malformed rules file now denies shell commands." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Heli protects itself from the agent it governs

**Files:**
- Create: `.heli-harness/adapters/shared/concurrency/protected-paths.mjs`
- Create: `lib/cli/human-gate.mjs`
- Create: `scripts/smoke-self-protection.mjs`
- Modify: `.heli-harness/adapters/shared/command-policy.mjs` (after `findDelete`; `BUILTIN_COMMAND_RULES`; after `hardDenyReason`)
- Modify: `.heli-harness/adapters/shared/hook-core.mjs` (command-policy import; session-context text line 138; `isTaskStateWrite` at original lines 286-298; `evaluatePreToolUse` head; protected block after the T6 block; `.env` requirement)
- Modify: `.heli-harness/adapters/shared/concurrency/resolve.mjs:32`, `:605-620`
- Modify: `.heli-harness/adapters/shared/concurrency/yolo-scope.mjs:5`, `:19-22`, `:81`, `:101-106`
- Modify: `lib/cli/grant.mjs:10`, `:49-53`; `lib/cli/yolo.mjs:2`, `:69-72`, `:85-86`
- Modify: `.heli-harness/safety/yolo-mode.md` (full rewrite), `.heli-harness/HARNESS.md:39`
- Modify: `scripts/smoke-yolo-mode.mjs:12`, `:75-83`; `scripts/quality-guard-strictness.mjs` (control-plane probe loop, lease-holder gap)
- Modify: `package.json`
- Generated: plugin `shared/` copies, `.heli-harness/cli/*` (incl. new `human-gate.mjs`)

**Interfaces:**
- Consumes: Task 3 `analyzeCommand`, `programName`, `BUILTIN_COMMAND_RULES` string-summary/`kind` support, `evaluateCommandRules` result `.analysis`, `isShellTool`.
- Produces:
  - `protected-paths.mjs`: `normalizePolicyPath(rawPath, { cwd, env }) → { path, suspicious, unc } | null`; `protectedLocations(workspaceRoot, { env })`; `classifyPolicyPath(normalized, locations) → { kind: "authority"|"narrative"|"claude-settings"|"other", taskId?, label? }`; `classifyToolPaths(rawPaths, { workspaceRoot, cwd, env }) → Array<{ raw, normalized, kind, taskId?, label? }>`; `classifyShellWriteTargets(targets, { workspaceRoot, cwd, env })`; `disablesClaudeHooks(text): boolean`; `protectedWriteReason(entry): string`.
  - `command-policy.mjs`: `shellWriteTargets(analysis) → Array<{ path: string, cdPath: string[] }>`; built-in rule ids `heli-privileged-command`, `heli-host-integration-removal`.
  - `resolve.mjs`: `isTaskStateWriteForContext(ctx, paths, { cwd?, env? } = {})` (Pi's existing 2-argument call keeps working).
  - `lib/cli/human-gate.mjs`: `realTerminal() → { stdin: boolean, stdout: boolean }`; `assertHumanTerminal(command, terminal = realTerminal())` throws `code: "HUMAN_TERMINAL_REQUIRED"`. `runGrant(args, { terminal } = {})`, `runYolo(args, { terminal } = {})` — `terminal` is the test seam; `bin/heli.mjs` never passes it.
  - hook-core codes `HELI_STATE_PROTECTED`, `HELI_HOOKS_PROTECTED`; `isTaskStateWrite` is removed.

- [ ] **Step 1: Write the failing self-protection test**

Create `scripts/smoke-self-protection.mjs`:

```js
#!/usr/bin/env node
/**
 * Heli protects itself from the agent it governs:
 *  - agent-run privilege commands (grants, YOLO, takeovers, Heli removal) are
 *    hard-denied in every invocation form;
 *  - `heli grant issue` / `heli yolo on` refuse to run without a human terminal;
 *  - Heli authority state is never agent-writable, whatever the path spelling;
 *  - narrative task files stay writable by their owner.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluatePreToolUse } from "../.heli-harness/adapters/shared/hook-core.mjs";
import { createTask } from "../lib/concurrency/task.mjs";
import { createSession, attachSession } from "../lib/concurrency/session.mjs";
import { acquireWriteLease } from "../lib/concurrency/lease.mjs";
import { listGrants } from "../lib/concurrency/grant.mjs";
import { runGrant } from "../lib/cli/grant.mjs";
import { runYolo } from "../lib/cli/yolo.mjs";
import { scrubHeliProcessEnv } from "./lib/hermetic-env.mjs";

scrubHeliProcessEnv();
const root = process.cwd();
const heli = join(root, "bin", "heli.mjs");
const scratch = mkdtempSync(join(tmpdir(), "heli-self-protection-"));
const hostHome = join(scratch, "home");
const env = {
	...process.env,
	HELI_CONFIG_DIR: join(scratch, "config"),
	HELI_DATA_DIR: join(scratch, "data"),
	HELI_HOST_HOME: hostHome,
};
const shippedRules = readFileSync(join(root, ".heli-harness", "safety", "command-rules.json"), "utf8");
const HUMAN = { stdin: true, stdout: true };

function workspace(name, { concurrent = false } = {}) {
	const dir = join(scratch, name);
	mkdirSync(join(dir, ".heli-harness", "safety"), { recursive: true });
	mkdirSync(join(dir, ".heli-harness", "state"), { recursive: true });
	writeFileSync(join(dir, ".heli-harness", "HARNESS.md"), "# Heli\n");
	writeFileSync(join(dir, ".heli-harness", "safety", "command-rules.json"), shippedRules);
	writeFileSync(join(dir, ".heli-harness", "state", "current-task.md"), "# Current Task\n\nTarget repo: demo\n\nCurrent status: in progress\n\nFailed attempts count: 0\n");
	if (concurrent) {
		mkdirSync(join(dir, ".heli-harness", "workspace"), { recursive: true });
		writeFileSync(join(dir, ".heli-harness", "workspace", "schema.json"), JSON.stringify({ schemaVersion: 1, mode: "concurrent" }));
	}
	return dir;
}

function evaluate(cwd, toolName, toolInput, extraEnv = {}) {
	return evaluatePreToolUse({ cwd, host: "test", env: { ...env, ...extraEnv }, toolName, toolInput });
}

try {
	const legacy = workspace("legacy");

	// 1. Agent-run privilege commands are hard-denied in every invocation form.
	const privileged = [
		"heli grant issue --action git.push --scope once",
		"heli grant --json issue --action git.push",
		"node .heli-harness/heli.mjs grant issue --action git.push",
		"node C:\\tools\\heli\\bin\\heli.mjs grant issue --action git.push",
		"npx heli-harness grant issue --action git.push",
		"npx -y github:KJ-AIML/heli-harness#main yolo on",
		"heli-harness yolo on",
		"heli yolo on",
		"heli yolo enable --hours 4",
		"heli task takeover t1 --confirm",
		"heli task release t1 --force",
		"heli task create t2 --yolo",
		"heli task create t2 --mode yolo",
		"heli session start --task t1 --yolo",
		"heli session attach t1 --yolo",
		"heli session transfer-write heli-ses-child",
		"heli host remove claude",
		"heli uninstall",
		"echo ok && heli grant issue --action env.write",
		"bash -c 'heli yolo on'",
		"pwsh -Command \"heli grant issue --action git.push\"",
		"claude plugin uninstall heli-harness@heli-harness",
		"claude plugin disable heli-harness@heli-harness",
		"codex plugin remove heli-harness@heli-harness",
		"grok plugin uninstall heli-harness",
		"pi remove heli-harness",
	];
	for (const command of privileged) {
		for (const extraEnv of [{}, { HELI_YOLO: "1", HELI_ALLOW_COMMAND: "heli-privileged-command,heli-host-integration-removal" }]) {
			const result = evaluate(legacy, "Bash", { command }, extraEnv);
			assert.equal(result.deny, true, `${command} must be denied (${JSON.stringify(extraEnv)})`);
			assert.equal(result.code, "TIER_BLOCKED", `${command}: ${result.reason}`);
			assert.match(result.reason, /human in their own terminal/, command);
		}
	}
	for (const command of ["heli grant list", "heli grant revoke heli-grant-x", "heli yolo off", "heli yolo status", "heli task claim t1 --mode write", "heli task create t2", "heli status", "heli host status", "heli doctor", "cd .heli-harness && ls"]) {
		const result = evaluate(legacy, "Bash", { command });
		assert.equal(result.deny, false, `${command}: ${result.reason}`);
	}

	// 2. The CLI refuses grant issue / yolo on without a human terminal.
	const cliEnv = { ...env };
	const grantCli = spawnSync(process.execPath, [heli, "grant", "issue", "--action", "git.push", legacy], { encoding: "utf8", env: cliEnv });
	assert.equal(grantCli.status, 1, grantCli.stdout);
	assert.match(grantCli.stderr, /interactive terminal/);
	assert.match(grantCli.stderr, /HUMAN_TERMINAL_REQUIRED/);
	assert.equal(listGrants(legacy, { env }).length, 0, "a refused grant issue must not create a grant");
	const yoloCli = spawnSync(process.execPath, [heli, "yolo", "on", legacy], { encoding: "utf8", env: cliEnv });
	assert.equal(yoloCli.status, 1, yoloCli.stdout);
	assert.match(yoloCli.stderr, /interactive terminal/);
	assert.equal(existsSync(join(legacy, ".heli-harness", "state", "yolo.json")), false);
	// Test seam: an explicit terminal argument (not an env var) stands in for a human.
	const previousConfig = process.env.HELI_CONFIG_DIR;
	const previousData = process.env.HELI_DATA_DIR;
	process.env.HELI_CONFIG_DIR = env.HELI_CONFIG_DIR;
	process.env.HELI_DATA_DIR = env.HELI_DATA_DIR;
	try {
		runGrant(["issue", "--action", "git.push", legacy], { terminal: HUMAN });
		assert.equal(listGrants(legacy, { env }).length, 1);
		assert.throws(() => runGrant(["issue", "--action", "git.push", legacy], { terminal: { stdin: false, stdout: true } }), (error) => error.code === "HUMAN_TERMINAL_REQUIRED");
		const yoloDir = workspace("yolo-seam");
		runYolo(["on", yoloDir], { terminal: HUMAN });
		assert.ok(existsSync(join(yoloDir, ".heli-harness", "state", "yolo.json")));
	} finally {
		if (previousConfig === undefined) delete process.env.HELI_CONFIG_DIR;
		else process.env.HELI_CONFIG_DIR = previousConfig;
		if (previousData === undefined) delete process.env.HELI_DATA_DIR;
		else process.env.HELI_DATA_DIR = previousData;
	}

	// 3. current-task.md is narrative: its Mode field no longer enables YOLO.
	const modeYolo = workspace("mode-yolo");
	writeFileSync(join(modeYolo, ".heli-harness", "state", "current-task.md"), "# Current Task\n\nMode: yolo\n\nCurrent status: in progress\n");
	assert.equal(evaluate(modeYolo, "Bash", { command: "git push origin main" }).code, "REMOTE_PUSH_DENIED");

	// 4. Protected state paths in a concurrent workspace with an owner and an observer.
	const ws = workspace("concurrent", { concurrent: true });
	createTask(ws, { taskId: "t1", repositoryId: "demo", worktreePath: ws });
	createSession(ws, { sessionId: "owner", mode: "write", worktreePath: ws });
	attachSession(ws, "owner", "t1", { mode: "write", worktreePath: ws });
	acquireWriteLease(ws, { taskId: "t1", sessionId: "owner", worktreePath: ws });
	createSession(ws, { sessionId: "observer", mode: "observe", worktreePath: ws });
	attachSession(ws, "observer", "t1", { mode: "observe", worktreePath: ws });
	const asOwner = { HELI_SESSION_ID: "owner" };
	const asObserver = { HELI_SESSION_ID: "observer" };
	const write = (cwd, filePath, sessionEnv, content = "x") => evaluate(cwd, "Write", { file_path: filePath, content }, sessionEnv);

	const authorityFiles = [
		".heli-harness/tasks/t1/task.json",
		".heli-harness/tasks/t1/yolo.json",
		".heli-harness/tasks/t1/events.jsonl",
		".heli-harness/tasks/t1/diagnosis.json",
		".heli-harness/sessions/owner.json",
		".heli-harness/locks/tasks/t1.write.lock/lease.json",
		".heli-harness/bindings/worktrees/abc.json",
		".heli-harness/state/yolo.json",
		".heli-harness/workspace/target.json",
		".heli-harness/workspace/schema.json",
		".heli-harness/tasks/t1/yolo.json:hidden",
		"./.heli-harness/./tasks/t1/../t1/yolo.json",
		join(ws, ".heli-harness", "tasks", "t1", "yolo.json"),
		join(env.HELI_CONFIG_DIR, "policy.json"),
		join(env.HELI_DATA_DIR, "grants", "workspaces", "x", "grants.json"),
		join(hostHome, ".grok", "hooks", "heli-harness.json"),
		join(hostHome, ".cursor", "plugins", "local", "heli-harness", "hooks.json"),
	];
	if (process.platform === "win32") {
		authorityFiles.push(".HELI-HARNESS\\TASKS\\T1\\YOLO.JSON", `\\\\?\\${join(ws, ".heli-harness", "tasks", "t1", "yolo.json")}`);
	}
	for (const filePath of authorityFiles) {
		for (const sessionEnv of [asObserver, asOwner, { ...asOwner, HELI_YOLO: "1" }]) {
			const result = write(ws, filePath, sessionEnv);
			assert.equal(result.code, "HELI_STATE_PROTECTED", `${filePath} (${JSON.stringify(sessionEnv)}): ${result.reason}`);
			assert.match(result.reason, /protects its own authority state/);
		}
	}

	// A symlink/junction into Heli state is resolved before classification.
	const link = join(ws, "innocent-dir");
	symlinkSync(join(ws, ".heli-harness", "tasks", "t1"), link, process.platform === "win32" ? "junction" : "dir");
	assert.equal(write(ws, "innocent-dir/yolo.json", asOwner).code, "HELI_STATE_PROTECTED");

	// `..` no longer rides the task-state exemption past the ownership gate.
	const escaped = write(ws, ".heli-harness/tasks/../../src/app.js", asObserver);
	assert.equal(escaped.deny, true);
	assert.equal(escaped.code, "NOT_WRITE_MODE");

	// Narrative files stay writable by the task owner (Review Focus).
	for (const filePath of [".heli-harness/tasks/t1/current-task.md", ".heli-harness/tasks/t1/plan.md", ".heli-harness/tasks/t1/reports/run.json", ".heli-harness/state/current-task.md"]) {
		const result = write(ws, filePath, asOwner);
		assert.equal(result.deny, false, `${filePath}: ${result.reason}`);
	}
	assert.equal(write(ws, "src/app.js", asOwner).deny, false, "the lease holder still writes source files");

	// 5. Claude settings: turning hooks (or the Heli plugin) off is denied; other edits are fine.
	assert.equal(write(ws, ".claude/settings.local.json", asOwner, JSON.stringify({ disableAllHooks: true })).code, "HELI_HOOKS_PROTECTED");
	assert.equal(evaluate(ws, "Edit", { file_path: join(hostHome, ".claude", "settings.json"), old_string: "\"x\": 1", new_string: "\"disableAllHooks\": true" }, asOwner).code, "HELI_HOOKS_PROTECTED");
	assert.equal(write(ws, ".claude/settings.json", asOwner, JSON.stringify({ enabledPlugins: { "heli-harness@heli-harness": false } })).code, "HELI_HOOKS_PROTECTED");
	assert.equal(write(ws, ".claude/settings.json", asOwner, JSON.stringify({ permissions: { allow: ["Bash(npm test)"] } })).deny, false);

	// 6. Shell writes are checked by their targets.
	const shell = (command) => evaluate(legacy, "Bash", { command });
	assert.equal(shell("echo SECRET=1 > .env").code, "ENV_WRITE_DENIED");
	assert.equal(shell("printf x >> apps/api/.env.local").code, "ENV_WRITE_DENIED");
	assert.equal(shell("Set-Content -Path .env -Value x").code, "ENV_WRITE_DENIED");
	for (const command of [
		"echo '{\"enabled\":true}' > .heli-harness/state/yolo.json",
		"Set-Content -Path .heli-harness/tasks/t1/task.json -Value x",
		"cp /tmp/forged.json .heli-harness/tasks/t1/task.json",
		"cd .heli-harness/tasks/t1 && echo '{\"enabled\":true}' > yolo.json",
		"rm .heli-harness/sessions/owner.json",
		`tee "${join(env.HELI_CONFIG_DIR, "policy.json")}" < forged.json`,
	]) {
		assert.equal(shell(command).code, "HELI_STATE_PROTECTED", command);
	}
	// `~` expands to the shell's home directory.
	const tildeHook = evaluate(legacy, "Bash", { command: "tee ~/.grok/hooks/heli-harness.json < forged.json" }, { HOME: hostHome, USERPROFILE: hostHome });
	assert.equal(tildeHook.code, "HELI_STATE_PROTECTED", tildeHook.reason);
	assert.equal(shell("echo '{\"disableAllHooks\": true}' > .claude/settings.local.json").code, "HELI_HOOKS_PROTECTED");
	for (const command of ["echo ok > notes.txt", "cat .heli-harness/state/current-task.md", "echo note >> .heli-harness/state/current-task.md", "ls 2>&1 > build.log"]) {
		assert.equal(shell(command).deny, false, `${command}: ${shell(command).reason}`);
	}

	console.log("self-protection smoke ok");
} finally {
	rmSync(scratch, { recursive: true, force: true });
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `unset HELI_SESSION_ID; node scripts/smoke-self-protection.mjs`
Expected: FAIL with `AssertionError [ERR_ASSERTION]: heli grant issue --action git.push --scope once must be denied ({})`

- [ ] **Step 3: Add the privileged-command and host-removal rules plus shell write targets**

In `.heli-harness/adapters/shared/command-policy.mjs`:

Insert after the `findDelete` function (that is, just before the doc comment whose first text line is ` * Non-removable built-in rules. Ids that also appear in the shipped`):

```js
const YOLO_TASK_MODES = new Set(["yolo", "unguarded", "dangerous"]);

/** Argument lists that follow each Heli CLI entry point in a segment. */
function heliCliInvocations(tokens) {
	const invocations = [];
	tokens.forEach((token, index) => {
		const program = programName(token);
		const isEntry = program === "heli" || program === "heli.mjs" || program === "heli-harness" ||
			token.startsWith("heli-harness@") || /(^|[/:])heli-harness(@|#|$)/.test(token);
		if (!isEntry) return;
		const args = tokens.slice(index + 1).filter((arg) => arg !== "--json" && arg !== "--output-json");
		if (args[0] === "--") args.shift();
		invocations.push(args);
	});
	return invocations;
}

/** Heli subcommands that grant authority, bypass guards or remove Heli. */
function privilegedHeliCommand(args) {
	const [command, sub] = args;
	const rest = args.slice(2);
	const modeIndex = rest.indexOf("--mode");
	if (command === "grant" && sub === "issue") return "heli grant issue";
	if (command === "yolo" && (sub === "on" || sub === "enable")) return "heli yolo on";
	if (command === "task" && sub === "takeover") return "heli task takeover";
	if (command === "task" && sub === "release" && (rest.includes("--force") || rest.includes("--confirm"))) return "heli task release --force";
	if (command === "task" && sub === "create" && (rest.includes("--yolo") || (modeIndex >= 0 && YOLO_TASK_MODES.has(rest[modeIndex + 1])))) return "heli task create --yolo";
	if (command === "session" && (sub === "start" || sub === "attach") && rest.includes("--yolo")) return `heli session ${sub} --yolo`;
	if (command === "session" && sub === "transfer-write") return "heli session transfer-write";
	if (command === "host" && (sub === "remove" || sub === "uninstall")) return `heli host ${sub}`;
	if (command === "uninstall") return "heli uninstall";
	return null;
}

function heliPrivilegeCommand(tokens) {
	for (const args of heliCliInvocations(tokens)) {
		const found = privilegedHeliCommand(args);
		if (found) return found;
	}
	return false;
}

/** `<host> plugin uninstall|remove|disable heli-harness...`, `pi|axga remove heli-harness`. */
function hostIntegrationRemoval(tokens) {
	for (const index of indexesOfProgram(tokens, ["claude", "codex", "grok", "cursor", "opencode", "kimi"])) {
		const args = tokens.slice(index + 1);
		if (args.includes("plugin") && args.some((arg) => ["uninstall", "remove", "rm", "disable"].includes(arg)) &&
			args.some((arg) => arg.startsWith("heli-harness"))) {
			return `${programName(tokens[index])} plugin removal of heli-harness`;
		}
	}
	for (const index of indexesOfProgram(tokens, ["pi", "axga"])) {
		const args = tokens.slice(index + 1);
		if ((args[0] === "remove" || args[0] === "uninstall") && args.some((arg) => arg.includes("heli-harness"))) {
			return `${programName(tokens[index])} ${args[0]} heli-harness`;
		}
	}
	return false;
}

const HUMAN_ONLY_REASON =
	"approvals, YOLO, takeovers, write transfers and removing Heli must be done by a human in their own terminal, never by the agent Heli governs; ask the user to run it themselves";

```

In `BUILTIN_COMMAND_RULES`, after the `git-push-force` entry, add:

```js
	Object.freeze({ id: "heli-privileged-command", tier: "T6", kind: "agent-run Heli privilege command", summary: "heli grant issue", reason: HUMAN_ONLY_REASON, test: heliPrivilegeCommand }),
	Object.freeze({ id: "heli-host-integration-removal", tier: "T6", kind: "removal of the Heli host integration", summary: "host plugin removal", reason: HUMAN_ONLY_REASON, test: hostIntegrationRemoval }),
```

Insert after the `hardDenyReason` function:

```js
const WRITE_PROGRAMS = new Set([
	"tee", "touch", "rm", "mv", "cp", "truncate", "mkdir", "rmdir", "ln", "install", "unlink", "shred", "chmod", "chown",
	"set-content", "sc", "add-content", "ac", "out-file", "new-item", "ni", "remove-item", "ri", "del", "erase", "rd",
	"move-item", "mi", "move", "copy-item", "cpi", "copy", "rename-item", "rni", "ren", "clear-content", "clc",
]);
const CD_PROGRAMS = new Set(["cd", "pushd", "chdir", "set-location", "sl"]);
const REDIRECT_RE = /(?:^|[^<>&=])(?:\d+|&|\*)?>>?\s*("[^"]*"|'[^']*'|[^\s;&|<>]+)/g;
const NULL_SINKS = /^(\/dev\/(null|stdout|stderr)|nul|\$null|&\d*)$/i;

/**
 * Best-effort list of paths a shell command writes, moves or deletes:
 * redirection targets, arguments of file-mutating programs (POSIX and
 * PowerShell/cmd), `dd of=`, and `sed -i`/`perl -i` files. Each target carries
 * the `cd` arguments seen earlier in the same dialect so callers can resolve it
 * both against the original cwd and against the changed directory.
 * @returns {Array<{ path: string, cdPath: string[] }>}
 */
export function shellWriteTargets(analysis) {
	const targets = [];
	const cdByDialect = { posix: [], windows: [] };
	for (const segment of analysis.segments) {
		const cdPath = [...cdByDialect[segment.dialect]];
		for (const match of segment.text.matchAll(REDIRECT_RE)) {
			const target = match[1].replace(/^["']|["']$/g, "");
			if (target && !NULL_SINKS.test(target)) targets.push({ path: target, cdPath });
		}
		const tokens = segment.rawTokens;
		if (CD_PROGRAMS.has(programName(tokens[0])) && tokens[1]) {
			cdByDialect[segment.dialect].push(tokens[1]);
			continue;
		}
		tokens.forEach((token, index) => {
			const program = programName(token);
			const args = tokens.slice(index + 1);
			if (WRITE_PROGRAMS.has(program)) {
				for (const arg of args) {
					if (arg.startsWith("-") || /^\/[a-z?]+$/i.test(arg)) continue;
					targets.push({ path: arg, cdPath });
				}
			} else if (program === "dd") {
				for (const arg of args) if (arg.toLowerCase().startsWith("of=")) targets.push({ path: arg.slice(3), cdPath });
			} else if ((program === "sed" || program === "perl") && args.some((arg) => /^-[a-z]*i/i.test(arg))) {
				for (const arg of args) if (!arg.startsWith("-")) targets.push({ path: arg, cdPath });
			}
		});
	}
	return targets;
}
```

- [ ] **Step 4: Add the human-terminal gate to the CLI**

Create `lib/cli/human-gate.mjs`:

```js
/**
 * Privileged Heli commands (scoped grants, YOLO) must come from a human.
 * A coding agent's shell tool runs without a terminal, so both stdin and stdout
 * must be TTYs. Tests inject `terminal` explicitly as a function argument;
 * there is deliberately no environment-variable bypass an agent could set.
 */
export function realTerminal() {
	return { stdin: process.stdin.isTTY === true, stdout: process.stdout.isTTY === true };
}

export function assertHumanTerminal(command, terminal = realTerminal()) {
	if (terminal?.stdin === true && terminal?.stdout === true) return;
	const windowsHint = process.platform === "win32"
		? " In a Git Bash (mintty) window, run it from Windows Terminal or PowerShell instead, or prefix it with `winpty`."
		: "";
	const error = new Error(
		`\`${command}\` must be run by a human in an interactive terminal (stdin and stdout must be a TTY). ` +
			`A coding agent cannot approve its own actions: ask the user to run \`${command}\` in their own terminal.${windowsHint}`,
	);
	error.code = "HUMAN_TERMINAL_REQUIRED";
	throw error;
}
```

In `lib/cli/grant.mjs`, after line 10 (`import { protocolOk } from "../protocol/result.mjs";`) insert `import { assertHumanTerminal } from "./human-gate.mjs";`, then replace lines 49-53:

```js
export function runGrant(args = []) {
	const { json, sub, flags, positional } = parse(args);
	let result;
	if (sub === "issue") {
		const workspaceRoot = workspaceFrom(positional);
```

with:

```js
/**
 * @param {string[]} args
 * @param {{ terminal?: { stdin: boolean, stdout: boolean } }} [options]
 *   terminal: test seam only; the CLI entry never passes it, so the real TTY state decides.
 */
export function runGrant(args = [], { terminal } = {}) {
	const { json, sub, flags, positional } = parse(args);
	let result;
	if (sub === "issue") {
		assertHumanTerminal("heli grant issue", terminal);
		const workspaceRoot = workspaceFrom(positional);
```

In `lib/cli/yolo.mjs`, after line 2 (`import { join } from "node:path";`) insert `import { assertHumanTerminal } from "./human-gate.mjs";`, then replace lines 69-72:

```js
/**
 * CLI: heli yolo on|off|status [path] [--hours N]
 */
export function runYolo(args) {
```

with:

```js
/**
 * CLI: heli yolo on|off|status [path] [--hours N]
 * @param {{ terminal?: { stdin: boolean, stdout: boolean } }} [options]
 *   terminal: test seam only; the CLI entry never passes it, so the real TTY state decides.
 */
export function runYolo(args, { terminal } = {}) {
```

and replace lines 85-86:

```js
	if (sub === "on" || sub === "enable") {
		const data = yoloOn(cwd, { hours });
```

with:

```js
	if (sub === "on" || sub === "enable") {
		assertHumanTerminal("heli yolo on", terminal);
		const data = yoloOn(cwd, { hours });
```

(`bin/heli.mjs` keeps calling `runGrant(args)` / `runYolo(args)` without options — do not change it.)

- [ ] **Step 5: Stop treating current-task.md `Mode:` as a YOLO switch**

In `.heli-harness/adapters/shared/concurrency/yolo-scope.mjs`:

Line 5: `import { pathExists, readJson, readText } from "./fs-atomic.mjs";` → `import { pathExists, readJson } from "./fs-atomic.mjs";`

Delete the now-unused `field` helper (lines 19-22):

```js
function field(text, label) {
	const match = new RegExp(`^${label}:[ \\t]*(.*)$`, "m").exec(text || "");
	return match ? match[1].trim() : "";
}
```

Line 81: `const { legacyYoloPath, legacyTaskPath } = pathsFor(root);` → `const { legacyYoloPath } = pathsFor(root);`

Replace lines 101-106:

```js
		if (pathExists(legacyTaskPath)) {
			const mode = field(readText(legacyTaskPath, ""), "Mode").toLowerCase();
			if (mode === "yolo" || mode === "unguarded" || mode === "dangerous") {
				return { active: true, source: `current-task.md Mode: ${mode}`, safetyOnly: true };
			}
		}
```

with:

```js
		// current-task.md is a narrative file the agent may edit, so its
		// `Mode:` field is never a YOLO source (it used to be a self-approval path).
```

- [ ] **Step 6: Create the protected-path module**

Create `.heli-harness/adapters/shared/concurrency/protected-paths.mjs`:

```js
/**
 * Protected Heli state: which paths an agent may never write.
 *
 * Every path is normalized before it is classified: resolved against the
 * caller's cwd, `..` collapsed, the nearest existing ancestor realpath'd (so a
 * symlink or junction cannot smuggle a write into Heli state), lowercased on
 * Windows, NTFS alternate-data-stream suffixes (`name:stream`) stripped and
 * Windows device (`\\?\`, `\\.\`) prefixes removed. A UNC/device path that
 * merely mentions a Heli location is treated as protected (we do not try to
 * prove where it points).
 *
 * Kinds:
 *   authority  — task.json/yolo.json/events.jsonl/diagnosis.json, sessions/,
 *                locks/, bindings/, state/yolo.json, workspace/*.json, the
 *                operational root itself, the Heli config/data dirs, and
 *                Heli-installed host hook files. Never agent-writable.
 *   narrative  — current-task.md, plan.md, decisions.md, reports/**, runs/**
 *                (global state/ or a task dir). Writable by the task owner.
 *   claude-settings — .claude/settings*.json (content-checked by the caller).
 *   other      — everything else (normal ownership rules apply).
 */
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { globalConfigDir, globalDataDir } from "./project-binding.mjs";
import { pathsFor } from "./paths.mjs";

const TASK_AUTHORITY_FILES = new Set(["task.json", "yolo.json", "events.jsonl", "diagnosis.json"]);
const TASK_NARRATIVE_FILES = new Set(["current-task.md", "plan.md", "decisions.md"]);
const STATE_NARRATIVE_FILES = new Set(["state/current-task.md", "state/plan.md", "state/decisions.md"]);
const AUTHORITY_DIRS = new Set(["sessions", "locks", "bindings"]);
const HELI_LOCATION_MARKERS = [".heli-harness", "/.heli/", "/.heli-data/", "heli-harness.json", "heli-harness-bundle", "/plugins/local/heli-harness", ".claude/settings"];

/** Where Heli installs host hooks (same rule as lib/cli/host.mjs userHome). */
function hostHome(env) {
	return env.HELI_HOST_HOME || homedir();
}

/** What a shell expands `~` / $HOME / %USERPROFILE% to for this process. */
function expandHome(value, env) {
	const home = env.HOME || env.USERPROFILE || homedir();
	return value
		.replace(/^~(?=$|[\\/])/, home)
		.replace(/^\$\{?HOME\}?(?=$|[\\/])/i, home)
		.replace(/^\$env:(USERPROFILE|HOME)(?=$|[\\/])/i, home)
		.replace(/^%(USERPROFILE|HOME)%(?=$|[\\/])/i, home);
}

function realpathNearestAncestor(path) {
	const tail = [];
	let current = path;
	for (;;) {
		if (existsSync(current)) {
			let real = current;
			try {
				real = realpathSync.native(current);
			} catch {
				try {
					real = realpathSync(current);
				} catch {
					real = current;
				}
			}
			return tail.length ? join(real, ...tail.reverse()) : real;
		}
		const parent = dirname(current);
		if (parent === current) return path;
		tail.push(basename(current));
		current = parent;
	}
}

function canonical(value) {
	let out = value.replaceAll("\\", "/");
	if (process.platform === "win32") out = out.toLowerCase();
	if (out.length > 1 && out.endsWith("/") && !/^[a-z]:\/$/i.test(out)) out = out.slice(0, -1);
	return out;
}

/**
 * Normalize a tool-supplied path for policy decisions.
 * @returns {{ path: string, suspicious: boolean, unc: boolean } | null}
 *   `suspicious` = device/UNC form or an alternate data stream was involved.
 */
export function normalizePolicyPath(rawPath, { cwd = process.cwd(), env = process.env } = {}) {
	let value = String(rawPath ?? "").trim();
	if (!value || value.includes("\0")) return null;
	value = expandHome(value, env);
	let suspicious = false;
	if (/^[\\/]{2}[?.][\\/]/.test(value)) {
		suspicious = true;
		value = value.slice(4);
		if (/^unc[\\/]/i.test(value)) value = `//${value.slice(4)}`;
	}
	if (/^[\\/]{2}[^\\/]/.test(value)) {
		suspicious = true;
		const lowered = value.replaceAll("\\", "/").toLowerCase();
		return { path: lowered, suspicious, unc: true };
	}
	const parts = value.split(/[\\/]/);
	for (let index = 0; index < parts.length; index += 1) {
		const isDrive = index === 0 && /^[a-z]:$/i.test(parts[index]);
		if (!isDrive && parts[index].includes(":")) {
			parts[index] = parts[index].slice(0, parts[index].indexOf(":"));
			suspicious = true;
		}
	}
	value = parts.join("/");
	const absolute = isAbsolute(value) || /^[a-z]:\//i.test(value) ? resolve(value) : resolve(cwd, value);
	return { path: canonical(realpathNearestAncestor(absolute)), suspicious, unc: false };
}

function norm(path, env) {
	return path ? normalizePolicyPath(path, { env })?.path || null : null;
}

function within(path, root) {
	return Boolean(root) && (path === root || path.startsWith(`${root}/`));
}

/** Normalized locations that decide a path's kind for this workspace + environment. */
export function protectedLocations(workspaceRoot, { env = process.env } = {}) {
	const home = hostHome(env);
	const claudeConfigDir = env.CLAUDE_CONFIG_DIR ? norm(env.CLAUDE_CONFIG_DIR, env) : null;
	return {
		operationalRoot: workspaceRoot ? norm(pathsFor(workspaceRoot).operationalRoot, env) : null,
		heliDirs: [...new Set([norm(globalConfigDir(env), env), norm(globalDataDir(env), env)].filter(Boolean))],
		hostHookFiles: [
			norm(join(home, ".grok", "hooks", "heli-harness.json"), env),
			norm(join(home, ".config", "opencode", "plugins", "heli-harness.js"), env),
		],
		hostHookDirs: [
			norm(join(home, ".config", "opencode", "plugins", "heli-harness-bundle"), env),
			norm(join(home, ".cursor", "plugins", "local", "heli-harness"), env),
		],
		claudeConfigDir,
	};
}

function classifyOperational(rel) {
	if (rel === "") return { kind: "authority", label: "the Heli operational state root" };
	const parts = rel.split("/");
	if (parts[0] === "tasks") {
		if (parts.length <= 2) return { kind: "authority", label: `task state ${rel}` };
		const inner = parts.slice(2).join("/");
		if (TASK_AUTHORITY_FILES.has(inner)) return { kind: "authority", label: `task authority file ${rel}` };
		if (TASK_NARRATIVE_FILES.has(inner) || inner.startsWith("reports/") || inner.startsWith("runs/")) {
			return { kind: "narrative", taskId: parts[1] };
		}
		return { kind: "other" };
	}
	if (AUTHORITY_DIRS.has(parts[0])) return { kind: "authority", label: `${parts[0]}/ state` };
	if (rel === "state" || rel === "state/yolo.json") return { kind: "authority", label: "YOLO state" };
	if (parts[0] === "workspace" && (parts.length === 1 || (parts.length === 2 && parts[1].endsWith(".json")))) {
		return { kind: "authority", label: `workspace state ${rel}` };
	}
	if (STATE_NARRATIVE_FILES.has(rel) || rel.startsWith("state/reports/") || rel.startsWith("state/runs/")) {
		return { kind: "narrative", taskId: null };
	}
	return { kind: "other" };
}

/**
 * Classify one normalized policy path (see normalizePolicyPath).
 * @returns {{ kind: "authority"|"narrative"|"claude-settings"|"other", taskId?: string|null, label?: string }}
 */
export function classifyPolicyPath(normalized, locations) {
	if (!normalized) return { kind: "other" };
	const path = normalized.path;
	if (normalized.unc) {
		return HELI_LOCATION_MARKERS.some((marker) => path.includes(marker))
			? { kind: "authority", label: "a UNC/device path into Heli state" }
			: { kind: "other" };
	}
	const op = locations.operationalRoot;
	if (op && within(path, op)) {
		const result = classifyOperational(path === op ? "" : path.slice(op.length + 1));
		if (normalized.suspicious && result.kind !== "other") return { kind: "authority", label: "an alternate-data-stream/device path into Heli state" };
		return result;
	}
	for (const dir of locations.heliDirs) {
		if (within(path, dir)) return { kind: "authority", label: "the Heli config/data directory" };
	}
	if (locations.hostHookFiles.includes(path) || locations.hostHookDirs.some((dir) => within(path, dir))) {
		return { kind: "authority", label: "a Heli-installed host hook" };
	}
	const name = basename(path);
	if ((name === "settings.json" || name === "settings.local.json") &&
		(path.endsWith(`/.claude/${name}`) || (locations.claudeConfigDir && dirname(path) === locations.claudeConfigDir))) {
		return { kind: "claude-settings" };
	}
	return { kind: "other" };
}

/** Normalize + classify a batch of raw tool paths. */
export function classifyToolPaths(rawPaths, { workspaceRoot = null, cwd = process.cwd(), env = process.env } = {}) {
	const locations = protectedLocations(workspaceRoot, { env });
	return (rawPaths || []).map((raw) => {
		const normalized = normalizePolicyPath(raw, { cwd, env });
		return { raw, normalized: normalized?.path || null, ...classifyPolicyPath(normalized, locations) };
	});
}

/**
 * Classify shell write targets (see command-policy shellWriteTargets). Each
 * target is resolved against the hook cwd AND, when the command changed
 * directory first, against that directory — a protected reading wins.
 */
export function classifyShellWriteTargets(targets, { workspaceRoot = null, cwd = process.cwd(), env = process.env } = {}) {
	const entries = [];
	for (const target of targets || []) {
		const bases = [cwd];
		if (target.cdPath?.length) bases.push(resolve(cwd, ...target.cdPath));
		for (const base of bases) entries.push(...classifyToolPaths([target.path], { workspaceRoot, cwd: base, env }));
	}
	return entries;
}

/** True when a settings payload turns Heli off (all hooks, or the Heli plugin). */
export function disablesClaudeHooks(text) {
	const value = String(text ?? "");
	return /"disableAllHooks"\s*:\s*true/i.test(value) || /"heli-harness@[^"]*"\s*:\s*false/i.test(value);
}

export function protectedWriteReason(entry) {
	return `Heli-Harness protects its own authority state: ${entry.raw} is ${entry.label}. Agents may not write it. Use the Heli CLI for normal state changes (heli task/session/target commands), or ask the user to run approval/YOLO commands in their own terminal.`;
}
```

- [ ] **Step 7: Normalize the task-state exemption**

In `.heli-harness/adapters/shared/concurrency/resolve.mjs`, after line 32 (`import { isLinkedWorkspace } from "./project-binding.mjs";`) insert `import { classifyToolPaths } from "./protected-paths.mjs";`, then replace the whole `isTaskStateWriteForContext` function (lines 605-620) with:

```js
/**
 * True when EVERY path is a narrative state file the caller may write without
 * holding write authority: the shared state/ ledger (current-task.md, plan.md,
 * decisions.md, reports/, runs/) or the same files in the caller's OWN task
 * directory. Paths are normalized first (cwd-relative resolution, `..`
 * collapse, realpath, Windows casing), so `tasks/../../src/x` or another
 * task's files never qualify. Authority-bearing files never qualify either.
 */
export function isTaskStateWriteForContext(ctx, paths, { cwd = process.cwd(), env = process.env } = {}) {
	if (!ctx?.workspaceRoot || !Array.isArray(paths) || paths.length === 0) return false;
	const ownTask = ctx.taskId ? String(ctx.taskId).toLowerCase() : null;
	return classifyToolPaths(paths, { workspaceRoot: ctx.workspaceRoot, cwd, env }).every(
		(entry) =>
			entry.kind === "narrative" &&
			(entry.taskId == null || (ownTask !== null && entry.taskId.toLowerCase() === ownTask)),
	);
}
```

(`extensions/pi-extension.js` calls `isTaskStateWriteForContext(execCtx, writePathsEarly)` with Pi's `process.cwd()` — that default keeps it working.)

- [ ] **Step 8: Enforce protected state in hook-core**

In `.heli-harness/adapters/shared/hook-core.mjs`:

Edit A — replace `import { approvalReason, evaluateCommandRules, hardDenyReason } from "./command-policy.mjs";` with:

```js
import { approvalReason, evaluateCommandRules, hardDenyReason, shellWriteTargets } from "./command-policy.mjs";
import {
	classifyShellWriteTargets,
	classifyToolPaths,
	disablesClaudeHooks,
	protectedWriteReason,
} from "./concurrency/protected-paths.mjs";
```

Edit B — in `buildSessionContext` (line 138), replace `until you update current-task.md (or target.json) to resolve it.` with ``until you update current-task.md (or run `heli target set <repo>`) to resolve it.``

Edit C — replace the whole `isTaskStateWrite` function (originally lines 286-298: from `export function isTaskStateWrite(paths) {` through the `);` and closing `}` that follow `path.includes(".heli-harness/tasks/"),`) with:

```js
function stringLeaves(value, out = []) {
	if (typeof value === "string") out.push(value);
	else if (value && typeof value === "object") for (const item of Object.values(value)) stringLeaves(item, out);
	return out;
}
```

Edit D — in `evaluatePreToolUse`, replace:

```js
	const rawCommand = String(toolInput?.command ?? toolInput?.description ?? "");
	const paths = [...pathsFrom(toolInput), ...patchPathsFrom(rawCommand)].map((path) =>
		path.replaceAll("\\", "/").toLowerCase(),
	);
	const name = String(toolName);

	const shellMutation = isLikelyShellMutation(name, rawCommand);
	const isWrite = isFileMutationTool(name, { paths, writeToolNames }) || shellMutation;
	const taskStateOnly = isTaskStateWriteForContext(ctx, paths) || isTaskStateWrite(paths);
```

with:

```js
	const baseCwd = cwd || process.cwd();
	const rawCommand = String(toolInput?.command ?? toolInput?.description ?? "");
	const rawPaths = [...pathsFrom(toolInput), ...patchPathsFrom(rawCommand)];
	const paths = rawPaths.map((path) => path.replaceAll("\\", "/").toLowerCase());
	const name = String(toolName);

	const shellMutation = isLikelyShellMutation(name, rawCommand);
	const isWrite = isFileMutationTool(name, { paths, writeToolNames }) || shellMutation;
	const taskStateOnly = isTaskStateWriteForContext(ctx, rawPaths, { cwd: baseCwd, env });
```

Edit E — directly after the T6 block (the `if (commandPolicy?.hardDenies.length) { return { ... }; }` statement) and before `// Ownership gates — NEVER bypassed by YOLO.`, insert:

```js

	// Heli's own authority state is never agent-writable: not by the lease
	// holder, not under YOLO. Structured writes are checked by their paths,
	// shell commands by the paths they write, move or delete.
	const pathScope = { workspaceRoot: ctx.workspaceRoot, cwd: baseCwd, env };
	const structuredEntries = isWrite ? classifyToolPaths(rawPaths, pathScope) : [];
	const shellEntries = commandPolicy && isShellTool(name)
		? classifyShellWriteTargets(shellWriteTargets(commandPolicy.analysis), pathScope)
		: [];
	const protectedEntry = [...structuredEntries, ...shellEntries].find((entry) => entry.kind === "authority");
	if (protectedEntry) {
		return { deny: true, hardDeny: true, code: "HELI_STATE_PROTECTED", reason: protectedWriteReason(protectedEntry), ctx };
	}
	const settingsWrite = [...structuredEntries, ...shellEntries].some((entry) => entry.kind === "claude-settings");
	if (settingsWrite && disablesClaudeHooks(isShellTool(name) ? rawCommand : stringLeaves(toolInput).join("\n"))) {
		return {
			deny: true,
			hardDeny: true,
			code: "HELI_HOOKS_PROTECTED",
			reason:
				"Heli-Harness blocks settings changes that disable Claude Code hooks or the Heli plugin (disableAllHooks / enabledPlugins). Ask the user to change Claude settings themselves.",
			ctx,
		};
	}
```

Edit F — replace `	if (paths.some((path) => /(^|\/)\.env(\.|$)/.test(path)) && !allowEnvWriteScoped(scope)) {` with:

```js
	const envFile = /(^|\/)\.env(\.|$)/;
	const envWrite = paths.some((path) => envFile.test(path)) ||
		shellEntries.some((entry) => entry.normalized && envFile.test(entry.normalized.toLowerCase()));
	if (envWrite && !allowEnvWriteScoped(scope)) {
```

- [ ] **Step 9: Sync and run the test**

Run: `node --check .heli-harness/adapters/shared/hook-core.mjs && node scripts/sync-plugin-shared.mjs && node scripts/sync-workspace-cli.mjs && unset HELI_SESSION_ID; node scripts/smoke-self-protection.mjs | tail -1`
Expected: last line `self-protection smoke ok` (the lines before it are the CLI output of the seam calls: `Issued grant ...`, `Heli YOLO ON for ...`).

- [ ] **Step 10: Update tests that relied on the old behavior**

`scripts/smoke-yolo-mode.mjs` — after line 12 (`import { pathToFileURL } from "node:url";`) insert `import { runYolo } from "../lib/cli/yolo.mjs";`, then replace lines 75-83:

```js
// 3) CLI yolo on/off
const cliDir = mkdtempSync(join(tmpdir(), "heli-yolo-cli-"));
try {
	mkdirSync(join(cliDir, ".heli-harness", "state"), { recursive: true });
	writeFileSync(join(cliDir, ".heli-harness", "HARNESS.md"), "# Heli\n");
	const heli = join(root, "bin", "heli.mjs");
	const on = spawnSync(process.execPath, [heli, "yolo", "on", cliDir], { encoding: "utf8" });
	assert.equal(on.status, 0, on.stderr || on.stdout);
	assert.ok(existsSync(join(cliDir, ".heli-harness", "state", "yolo.json")));
```

with:

```js
// 3) CLI yolo on is human-only (needs a terminal); yolo off stays scriptable
const cliDir = mkdtempSync(join(tmpdir(), "heli-yolo-cli-"));
try {
	mkdirSync(join(cliDir, ".heli-harness", "state"), { recursive: true });
	writeFileSync(join(cliDir, ".heli-harness", "HARNESS.md"), "# Heli\n");
	const heli = join(root, "bin", "heli.mjs");
	const refused = spawnSync(process.execPath, [heli, "yolo", "on", cliDir], { encoding: "utf8" });
	assert.equal(refused.status, 1, "non-interactive `heli yolo on` must be refused");
	assert.match(refused.stderr, /interactive terminal/);
	assert.ok(!existsSync(join(cliDir, ".heli-harness", "state", "yolo.json")), "a refused yolo on must not write yolo.json");
	// A human at a terminal (test seam: explicit terminal argument, not an env var).
	runYolo(["on", cliDir], { terminal: { stdin: true, stdout: true } });
	assert.ok(existsSync(join(cliDir, ".heli-harness", "state", "yolo.json")));
```

`scripts/quality-guard-strictness.mjs` — in the control-plane probe loop (`for (const probe of controlPlaneProbes) {`), replace `/session/i, controlPlaneDir);` with `/protects its own authority state/i, controlPlaneDir);`. Then delete the now-false gap record near the end of the file (lines 669-672, plus the blank line after it), since the lease holder can no longer write control-plane files:

```js
gap(
	"lease holder can still write control-plane files",
	"a bound write-mode session holding the lease passes the ownership gate and could hand-edit its own lease/schema; acceptable for the trusted writer, recorded for honesty",
);
```

Run: `unset HELI_SESSION_ID; node scripts/smoke-yolo-mode.mjs | tail -1; node scripts/quality-guard-strictness.mjs | grep -E "HARD:|GAPS"`
Expected: `smoke-yolo-mode: ok`, then `HARD: 332 passed, 0 failed` and `GAPS (known soft): 11`.

- [ ] **Step 11: Update YOLO and harness docs**

Replace the whole of `.heli-harness/safety/yolo-mode.md` with:

````markdown
# YOLO / unguarded mode (opt-in)

Default Heli PreToolUse is **strict** (blocks remote git write + `.env`-style secrets + stuck-task gates).

For large autonomous workflows that **must** push remotes or write secret files, a **human** can enable opt-in unguarded mode. This is intentional and explicit — never the default, and never something the governed agent can switch on for itself.

## Enable (any one is enough)

### 1. CLI (recommended)

Run these yourself in an interactive terminal. `heli yolo on` refuses to run without a TTY, and Heli's hooks hard-deny it when a coding agent runs it:

```bash
heli yolo on
heli yolo on . --hours 4   # optional expiry
heli yolo status
heli yolo off
```

Writes `.heli-harness/state/yolo.json` with `{ "enabled": true }`. That file is protected Heli state: agents cannot write it.

### 2. Environment (this shell only)

```powershell
$env:HELI_YOLO = "1"
# or
$env:HELI_GUARDS = "off"
```

```bash
export HELI_YOLO=1
# or
export HELI_GUARDS=off
```

Then start your agent in the **same** shell.

### 3. Granular (strict stays on for other rules)

```powershell
$env:HELI_ALLOW_GIT_PUSH = "1"
$env:HELI_ALLOW_ENV_WRITE = "1"
```

`current-task.md` has no YOLO switch: its `Mode:` field is narrative text the agent can edit, so it never enables YOLO.

## What YOLO skips

- Blanket remote git write block
- `.env`-style secret write block
- T5 approval rules (for example `npm publish`, `git push --force`)
- Stuck-task / plan-step write gates

## What YOLO never skips

- T6 hard-deny rules, including Heli's built-in floor (recursive forced deletes, `git reset --hard`, `git clean -f` with `-d`/`-x`)
- Heli self-protection: agent-run `heli grant issue` / `heli yolo on` / takeovers, and agent writes to Heli's own state
- Ownership / write-authority gates

## What YOLO is **not**

- Not a host sandbox bypass (`--dangerously-skip-permissions` etc. are separate)
- Not permanent unless you leave `yolo.json` / env set
- Not enabled by agent guesswork — only by a human (terminal, environment, or the file written by `heli yolo on`)

## Host notes

| Host | Needs |
|------|--------|
| Grok | User hooks installed + yolo on (cwd must be the workspace with `yolo.json`) |
| Claude / Codex | Plugin hooks + yolo on |
| OpenCode | Plugin loaded + yolo on |
| Kimi | Hooks in config.toml + yolo on |

Always run the agent with **cwd = workspace root** that contains `.heli-harness/state/yolo.json`.
````

In `.heli-harness/HARNESS.md` line 39, replace `— update the state file (or target.json) to resolve it before continuing.` with ``— update the state file (or run `heli target set <repo>`; `target.json` itself is protected Heli state) to resolve it before continuing.``

- [ ] **Step 12: Register the test, regress, commit**

In `package.json` `scripts.check`, replace `node scripts/smoke-command-rules.mjs &&` with `node scripts/smoke-command-rules.mjs && node scripts/smoke-self-protection.mjs &&`.

Run: `node scripts/sync-plugin-shared.mjs --check && node scripts/sync-workspace-cli.mjs --check && unset HELI_SESSION_ID; for t in smoke-command-rules smoke-hook-fail-closed smoke-scoped-grants smoke-extension-load smoke-concurrency-foundation smoke-convergence-authority smoke-cli-task smoke-cli-entry; do node scripts/$t.mjs > /dev/null 2>&1 && echo "ok $t" || echo "FAIL $t"; done`
Expected: eight `ok ...` lines.

Run the full-chain runner from Global Constraints. Expected: `FAILED: ["node scripts/smoke-portable-targets.mjs"]`.

```bash
git add .heli-harness lib/cli/human-gate.mjs lib/cli/grant.mjs lib/cli/yolo.mjs scripts/smoke-self-protection.mjs scripts/smoke-yolo-mode.mjs scripts/quality-guard-strictness.mjs package.json
git status --short
git commit -m "fix: stop agents from approving themselves or editing Heli state" -m "Agent-run heli grant issue, yolo on, takeovers, write transfers, YOLO task/session flags and Heli removal are hard-denied, and grant issue / yolo on require an interactive terminal. Heli authority state (task/session/lock/binding/YOLO/workspace records, ~/.heli, installed host hooks) is protected under normalized paths, settings that disable Claude hooks are denied, shell writes to protected paths and .env files are checked, and current-task.md Mode no longer enables YOLO." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Govern Claude Code's PowerShell, Monitor, NotebookEdit and MCP tools

**Files:**
- Modify: `.heli-harness/adapters/claude-plugin/hooks/hooks.json` (PreToolUse `matcher`)
- Modify: `.heli-harness/adapters/shared/hook-core.mjs` (imports; `DEFAULT_FILE_WRITE_TOOL_NAMES`; shell-tool regex and `isLikelyShellMutation`; `pathLikeValues`; `structuredEntries`)
- Create: `scripts/smoke-claude-windows-coverage.mjs`
- Modify: `package.json`
- Generated: plugin `shared/` copies

**Interfaces:**
- Consumes: Task 3 `analyzeCommand`, `programName`; Task 4 `classifyToolPaths`, `stringLeaves`, `structuredEntries` block.
- Produces: `isMcpTool(toolName): boolean`; `isShellTool` recognizes `powershell`, `pwsh`, `monitor`; `isLikelyShellMutation` recognizes PowerShell cmdlets and aliases; `DEFAULT_FILE_WRITE_TOOL_NAMES` includes `"NotebookEdit"`; MCP tool inputs get protected-path checks on every path-like value.

- [ ] **Step 1: Write the failing coverage test**

Create `scripts/smoke-claude-windows-coverage.mjs`:

```js
#!/usr/bin/env node
/**
 * Claude Code coverage beyond Bash/Edit/Write: the PowerShell tool (Windows
 * default shell), Monitor (runs a command), NotebookEdit, and MCP tools must
 * reach Heli and be governed like their Bash/Write equivalents.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluatePreToolUse, isLikelyShellMutation, isShellTool } from "../.heli-harness/adapters/shared/hook-core.mjs";
import { createTask } from "../lib/concurrency/task.mjs";
import { createSession, attachSession } from "../lib/concurrency/session.mjs";
import { scrubHeliProcessEnv } from "./lib/hermetic-env.mjs";

scrubHeliProcessEnv();
const root = process.cwd();
const hooksJson = JSON.parse(readFileSync(join(root, ".heli-harness", "adapters", "claude-plugin", "hooks", "hooks.json"), "utf8"));
const scratch = mkdtempSync(join(tmpdir(), "heli-claude-coverage-"));
const env = { ...process.env, HELI_CONFIG_DIR: join(scratch, "config"), HELI_DATA_DIR: join(scratch, "data") };
const shippedRules = readFileSync(join(root, ".heli-harness", "safety", "command-rules.json"), "utf8");

// 1. The PreToolUse matcher is a regex (it contains non-name characters) that
//    selects exactly the governed tools.
const matcher = hooksJson.hooks.PreToolUse[0].matcher;
assert.match(matcher, /[^A-Za-z0-9_|]/, "matcher must contain regex characters so Claude treats it as a regex");
const matcherRe = new RegExp(matcher);
for (const tool of ["Bash", "PowerShell", "Monitor", "Edit", "Write", "NotebookEdit", "mcp__fs__write_file", "mcp__github__create_issue"]) {
	assert.ok(matcherRe.test(tool), `matcher must select ${tool}`);
}
for (const tool of ["Read", "Glob", "Grep", "TodoWrite", "WebFetch", "PowerShellX", "xBash"]) {
	assert.equal(matcherRe.test(tool), false, `matcher must not select ${tool}`);
}

// 2. Shell classification for the new tool names and PowerShell mutations.
for (const tool of ["PowerShell", "pwsh", "Monitor", "Bash", "run_command"]) assert.ok(isShellTool(tool), tool);
assert.equal(isShellTool("mcp__shell__run"), false, "MCP tools are never treated as a local shell");
for (const command of [
	"Set-Content -Path src/x.ts -Value 1",
	"Add-Content notes.txt more",
	"'x' | Out-File out.txt",
	"New-Item -ItemType File a.txt",
	"Remove-Item a.txt",
	"Move-Item a.txt b.txt",
	"Copy-Item a.txt b.txt",
	"Rename-Item a.txt b.txt",
	"Clear-Content a.txt",
	"sc a.txt 1",
	"ni a.txt",
	"del a.txt",
	"copy a.txt b.txt",
	"echo 1 > a.txt",
]) {
	assert.equal(isLikelyShellMutation("PowerShell", command), true, command);
}
for (const command of ["Get-ChildItem", "git status", "echo sc is a word", "Get-Content a.txt"]) {
	assert.equal(isLikelyShellMutation("PowerShell", command), false, command);
}

function hook(cwd, payload, extraEnv = {}) {
	const result = spawnSync(process.execPath, [join(root, ".heli-harness", "adapters", "claude-plugin", "hooks", "heli-pre-tool-use.mjs")], {
		cwd,
		input: JSON.stringify(payload),
		encoding: "utf8",
		env: { ...env, ...extraEnv },
	});
	assert.equal(result.status, 0, result.stderr);
	const body = result.stdout.trim() ? JSON.parse(result.stdout) : {};
	return { denied: body?.hookSpecificOutput?.permissionDecision === "deny", reason: body?.hookSpecificOutput?.permissionDecisionReason || "" };
}

try {
	const ws = join(scratch, "ws");
	mkdirSync(join(ws, ".heli-harness", "safety"), { recursive: true });
	mkdirSync(join(ws, ".heli-harness", "state"), { recursive: true });
	writeFileSync(join(ws, ".heli-harness", "HARNESS.md"), "# Heli\n");
	writeFileSync(join(ws, ".heli-harness", "safety", "command-rules.json"), shippedRules);

	// 3. Synthetic Claude payloads through the real wrapper.
	const cases = [
		[{ tool_name: "PowerShell", tool_input: { command: "git push origin main" } }, /git push/],
		[{ tool_name: "PowerShell", tool_input: { command: "Set-Content .env x" } }, /\.env/],
		[{ tool_name: "PowerShell", tool_input: { command: "Remove-Item -Recurse -Force src" } }, /tier T6/],
		[{ tool_name: "Monitor", tool_input: { command: "rm -rf build", description: "watch" } }, /tier T6/],
		[{ tool_name: "NotebookEdit", tool_input: { notebook_path: ".heli-harness/state/yolo.json", new_source: "{}" } }, /authority state/],
		[{ tool_name: "mcp__fs__write_file", tool_input: { path: ".heli-harness/state/yolo.json", content: "{\"enabled\":true}" } }, /authority state/],
		[{ tool_name: "mcp__fs__move_file", tool_input: { source: "x.json", destination: `${ws}/.heli-harness/workspace/target.json` } }, /authority state/],
	];
	for (const [payload, reason] of cases) {
		const out = hook(ws, payload);
		assert.equal(out.denied, true, `${payload.tool_name} ${JSON.stringify(payload.tool_input)} must be denied`);
		assert.match(out.reason, reason, payload.tool_name);
	}
	for (const payload of [
		{ tool_name: "PowerShell", tool_input: { command: "Get-ChildItem" } },
		{ tool_name: "PowerShell", tool_input: { command: "Remove-Item file.txt" } },
		{ tool_name: "Monitor", tool_input: { command: "npm run dev" } },
		{ tool_name: "NotebookEdit", tool_input: { notebook_path: "analysis.ipynb", new_source: "print(1)" } },
		{ tool_name: "mcp__fs__read_file", tool_input: { path: "src/app.js" } },
		{ tool_name: "mcp__github__create_issue", tool_input: { title: "bug", body: "see docs/x.md" } },
	]) {
		const out = hook(ws, payload);
		assert.equal(out.denied, false, `${payload.tool_name} ${JSON.stringify(payload.tool_input)}: ${out.reason}`);
	}

	// 4. PowerShell writes face the ownership gate like Bash writes.
	const conc = join(scratch, "concurrent");
	mkdirSync(join(conc, ".heli-harness", "safety"), { recursive: true });
	mkdirSync(join(conc, ".heli-harness", "workspace"), { recursive: true });
	writeFileSync(join(conc, ".heli-harness", "HARNESS.md"), "# Heli\n");
	writeFileSync(join(conc, ".heli-harness", "safety", "command-rules.json"), shippedRules);
	writeFileSync(join(conc, ".heli-harness", "workspace", "schema.json"), JSON.stringify({ schemaVersion: 1, mode: "concurrent" }));
	createTask(conc, { taskId: "t1", repositoryId: "demo", worktreePath: conc });
	createSession(conc, { sessionId: "observer", mode: "observe", worktreePath: conc });
	attachSession(conc, "observer", "t1", { mode: "observe", worktreePath: conc });
	const observerWrite = evaluatePreToolUse({ cwd: conc, host: "claude", env: { ...env, HELI_SESSION_ID: "observer" }, toolName: "PowerShell", toolInput: { command: "Set-Content src/x.ts 'y'" } });
	assert.equal(observerWrite.deny, true);
	assert.equal(observerWrite.code, "NOT_WRITE_MODE");
	assert.equal(observerWrite.coverage, "shell-mutation-best-effort");

	console.log("claude windows coverage smoke ok");
} finally {
	rmSync(scratch, { recursive: true, force: true });
}
```

Run: `unset HELI_SESSION_ID; node scripts/smoke-claude-windows-coverage.mjs`
Expected: FAIL with `AssertionError [ERR_ASSERTION]: matcher must contain regex characters so Claude treats it as a regex`

- [ ] **Step 2: Widen the Claude matcher**

In `.heli-harness/adapters/claude-plugin/hooks/hooks.json`, change the PreToolUse matcher from `"matcher": "Bash|Edit|Write",` to:

```json
        "matcher": "^(Bash|PowerShell|Monitor|Edit|Write|NotebookEdit)$|^mcp__",
```

(Claude Code treats a matcher containing characters other than letters, digits, `_`, `-`, spaces, `,` and `|` as a JavaScript regex, matched case-sensitively; a plugin's `hooks/hooks.json` uses the same semantics as settings hooks.)

- [ ] **Step 3: Teach the kernel the new tools**

In `.heli-harness/adapters/shared/hook-core.mjs`:

Edit A — after `import { join } from "node:path";` add `import { fileURLToPath } from "node:url";`, and replace the command-policy import line `import { approvalReason, evaluateCommandRules, hardDenyReason, shellWriteTargets } from "./command-policy.mjs";` with:

```js
import {
	analyzeCommand,
	approvalReason,
	evaluateCommandRules,
	hardDenyReason,
	programName,
	shellWriteTargets,
} from "./command-policy.mjs";
```

Edit B — in `DEFAULT_FILE_WRITE_TOOL_NAMES`, after `"search_replace",` add `"NotebookEdit",` (NotebookEdit's single-token name never matches the verb fallback, so it must be listed).

Edit C — replace:

```js
const SHELL_TOOL_NAME_RE = /(^|[_\-.])(bash|shell|terminal|exec|run_command|run-command)($|[_\-.])/;
```

with:

```js
// Claude Code on Windows runs commands through `PowerShell` (no Bash tool without
// Git Bash) and `Monitor` runs a background command; both carry `command`.
const SHELL_TOOL_NAME_RE = /(^|[_\-.])(bash|shell|terminal|exec|run_command|run-command|powershell|pwsh|monitor)($|[_\-.])/;
const POWERSHELL_WRITE_CMDLETS = /\b(set-content|add-content|out-file|new-item|remove-item|move-item|copy-item|rename-item|clear-content|tee-object)\b/;
// PowerShell/cmd aliases that are also common words only count at command position.
const WRITE_ALIASES = new Set(["sc", "ac", "ni", "ri", "mi", "cpi", "rni", "clc", "del", "erase", "rd", "rmdir", "move", "copy", "ren"]);
```

and insert after the `isShellTool` function:

```js

/** MCP tools are named mcp__<server>__<tool>. */
export function isMcpTool(toolName) {
	return String(toolName ?? "").toLowerCase().startsWith("mcp__");
}
```

and in `isLikelyShellMutation`, after the line `	if (/\b(tee|touch|mkdir|rmdir|rm|mv|cp|truncate)\b/.test(command)) return true;` insert:

```js
	if (POWERSHELL_WRITE_CMDLETS.test(command)) return true;
	if (analyzeCommand(commandText).segments.some((segment) => WRITE_ALIASES.has(programName(segment.rawTokens[0])))) return true;
```

Edit D — insert after the `stringLeaves` function:

```js

const PATH_KEY_RE = /path|file|dir|dest|target|source|uri|location/i;

/**
 * MCP tool inputs are server-defined, so any string that looks like a
 * filesystem path is a candidate: values under path-like keys, and
 * whitespace-free values that contain a separator or start with `~`.
 */
function pathLikeValues(value, key = "", out = []) {
	if (typeof value === "string") {
		let text = value.trim();
		if (/^file:\/\//i.test(text)) {
			try {
				text = fileURLToPath(text);
			} catch {
				/* keep the raw text */
			}
		}
		const underPathKey = PATH_KEY_RE.test(key) && text.length > 0 && text.length <= 1024 && !text.includes("\n");
		const looksLikePath = text.length <= 1024 && !/\s/.test(text) && (/[\\/]/.test(text) || text.startsWith("~"));
		if (underPathKey || looksLikePath) out.push(text);
	} else if (value && typeof value === "object") {
		for (const [childKey, child] of Object.entries(value)) pathLikeValues(child, Array.isArray(value) ? key : childKey, out);
	}
	return out;
}
```

Edit E — replace `	const structuredEntries = isWrite ? classifyToolPaths(rawPaths, pathScope) : [];` with:

```js
	// MCP tools: server-defined inputs, so every path-like value is checked.
	const structuredEntries = isMcpTool(name)
		? classifyToolPaths([...new Set([...rawPaths, ...pathLikeValues(toolInput)])], pathScope)
		: isWrite
			? classifyToolPaths(rawPaths, pathScope)
			: [];
```

- [ ] **Step 4: Sync and run the test**

Run: `node --check .heli-harness/adapters/shared/hook-core.mjs && node scripts/sync-plugin-shared.mjs && unset HELI_SESSION_ID; node scripts/smoke-claude-windows-coverage.mjs`
Expected: `claude windows coverage smoke ok`

- [ ] **Step 5: Register the test, regress, commit**

In `package.json` `scripts.check`, replace `node scripts/smoke-claude-plugin.mjs &&` with `node scripts/smoke-claude-plugin.mjs && node scripts/smoke-claude-windows-coverage.mjs &&`.

Run: `node scripts/sync-plugin-shared.mjs --check && unset HELI_SESSION_ID; for t in smoke-claude-plugin smoke-self-protection smoke-command-rules quality-guard-strictness smoke-concurrency-foundation smoke-extension-load; do node scripts/$t.mjs > /dev/null 2>&1 && echo "ok $t" || echo "FAIL $t"; done`
Expected: six `ok ...` lines (`smoke-claude-plugin` runs `claude plugin validate` on the new matcher when the `claude` CLI is installed).

Run the full-chain runner from Global Constraints. Expected: `FAILED: ["node scripts/smoke-portable-targets.mjs"]`.

```bash
git add .heli-harness/adapters scripts/smoke-claude-windows-coverage.mjs package.json
git status --short
git commit -m "fix: govern Claude PowerShell, Monitor, NotebookEdit and MCP tools" -m "The Claude PreToolUse matcher is now a regex covering Bash, PowerShell, Monitor, Edit, Write, NotebookEdit and mcp__ tools. The kernel treats PowerShell/pwsh/Monitor as shells, recognizes PowerShell file-mutating cmdlets and aliases, treats NotebookEdit as a file writer, and checks every path-like MCP input against protected Heli state." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Harden experimental cloud sync

**Files:**
- Modify: `cloud/core.mjs:18-28` (constants/helpers), `:71-78` (after `approvePending`), `:149-204` (`GET /activate`, new `POST /activate/confirm`, callback)
- Modify: `lib/cli/cloud-bundle.mjs:22-23`, `:121-178` (`packBundle`, `unpackBundle`, new `policyBearingChanges`)
- Modify: `lib/cli/cloud.mjs:21-30` (imports), `:333-340` (push), `:380-406` (pull), `:448-490` (init)
- Modify: `bin/heli.mjs:77-80` (usage)
- Modify: `docs/architecture/cloud-sync.md`
- Modify: `scripts/smoke-cloud-sync.mjs:11`, `:296-299`, `:345`
- Generated: `.heli-harness/heli.mjs`, `.heli-harness/cli/cloud.mjs`, `.heli-harness/cli/cloud-bundle.mjs`

**Interfaces:**
- Consumes: nothing from Tasks 2–5 (independent after Task 1).
- Produces: `E2E_SCHEME = "aes-256-gcm-scrypt-bound"` (exported); `packBundle(files, { passphrase, workspaceId, version })`; `unpackBundle(bytes, { passphrase, requireEncryption, workspaceId, version })`; `policyBearingChanges(localFiles, incomingFiles) → Array<{ rel, change: "added"|"modified"|"enables YOLO" }>`; API `GET /activate` (confirmation page only), `POST /activate/confirm` (same-origin, 303 to GitHub, sets `heli_activate` cookie), callback requires the matching `oauthstate:<state>` + cookie; CLI flags `heli pull --accept-policy-changes`, `heli init ... --accept-policy-changes`.

- [ ] **Step 1: Extend the cloud smoke test (failing)**

In `scripts/smoke-cloud-sync.mjs`:

Line 11: `import { spawn } from "node:child_process";` → `import { spawn, spawnSync } from "node:child_process";`

Replace lines 297-299:

```js
	const outer = JSON.parse(gunzipSync(Buffer.from(storedBundle)).toString("utf8"));
	assert.equal(outer.encryption, "aes-256-gcm-scrypt", "stored bundle is encrypted");
	assert.ok(!JSON.stringify(outer).includes("secret contents"), "no plaintext on the server");
```

with:

```js
	const outer = JSON.parse(gunzipSync(Buffer.from(storedBundle)).toString("utf8"));
	assert.equal(outer.encryption, "aes-256-gcm-scrypt-bound", "stored bundle is encrypted and bound");
	assert.equal(outer.workspaceId, syncState.workspaceId, "ciphertext is bound to its sync workspace");
	assert.equal(outer.version, 6, "ciphertext is bound to the version it was stored as");
	assert.ok(!JSON.stringify(outer).includes("secret contents"), "no plaintext on the server");
```

Replace line 345 (`	console.log("cloud sync smoke ok");`) with:

```js
	// ---- Hardening: a hostile or broken server cannot downgrade, roll back,
	// relabel, or silently change governance through a pull ----
	const wsId = syncState.workspaceId;
	const tokenA = JSON.parse(readFileSync(join(root, "cfg-a", "credentials.json"), "utf8")).token;
	const authA = { authorization: `Bearer ${tokenA}` };
	const headVersion = async () => (await (await fetch(new URL(`/ws/${wsId}/versions`, url), { headers: authA })).json()).currentVersion;
	const pushRaw = async (bytes) => {
		const response = await fetch(new URL(`/ws/${wsId}/push`, url), {
			method: "POST",
			headers: { ...authA, "content-type": "application/octet-stream", "x-base-version": String(await headVersion()) },
			body: bytes,
		});
		const text = await response.text();
		assert.equal(response.status, 200, text);
		return JSON.parse(text).version;
	};
	const { packBundle } = await import("../lib/cli/cloud-bundle.mjs");

	// E2E is latched on for B, so a plaintext head is refused and nothing is written.
	assert.equal(JSON.parse(readFileSync(join(wsB, ".heli-harness", "state", "sync.json"), "utf8")).e2e, true);
	const plaintextVersion = await pushRaw(packBundle({ "profiles/demo.md": "# downgraded\n" }));
	const downgrade = await cli(["pull", "--force"], { ...cfgB, ...passphrase }, { cwd: wsB });
	assert.equal(downgrade.status, 1, "plaintext must be refused when E2E is on");
	assert.match(downgrade.stderr, /Refusing an unencrypted bundle/);
	assert.equal(readFileSync(join(wsB, ".heli-harness", "profiles", "demo.md"), "utf8"), "# demo v6 secret contents\n");

	// A proper encrypted head on top of it; B applies it.
	ok(await cli(["push", "--force"], { ...cfgA, ...passphrase }, { cwd: wsA }), "encrypted push over the injected plaintext");
	const goodHead = await headVersion();
	assert.equal(goodHead, plaintextVersion + 1);
	ok(await cli(["pull", "--force"], { ...cfgB, ...passphrase }, { cwd: wsB }), "pull the encrypted head");

	// Rollback: the server claims an older head -> refused; an explicit --version restore still works.
	const wsKey = (await store.list("ws:")).find(({ value }) => value.id === wsId).key;
	const wsRecord = await store.get(wsKey);
	await store.put(wsKey, { ...wsRecord, currentVersion: 6 });
	const rollback = await cli(["pull", "--force"], { ...cfgB, ...passphrase }, { cwd: wsB });
	assert.equal(rollback.status, 1, "an older head must be refused");
	assert.match(rollback.stderr, /possible rollback/);
	ok(await cli(["pull", "--version", "6", "--force"], { ...cfgB, ...passphrase }, { cwd: wsB }), "deliberate restore of v6");
	await store.put(wsKey, wsRecord);

	// Relabel: the server serves v6's ciphertext as the head -> AES-GCM binding fails.
	const headBlob = await store.blobGet(`bundle:${wsId}:${goodHead}`);
	await store.blobPut(`bundle:${wsId}:${goodHead}`, await store.blobGet(`bundle:${wsId}:6`));
	const relabeled = await cli(["pull", "--force"], { ...cfgB, ...passphrase }, { cwd: wsB });
	assert.equal(relabeled.status, 1, "a relabeled bundle must not decrypt");
	assert.match(relabeled.stderr, /different workspace or version/);
	await store.blobPut(`bundle:${wsId}:${goodHead}`, headBlob);

	// Governance-bearing changes need explicit acceptance; a refused pull writes nothing.
	writeFileSync(join(wsA, ".heli-harness", "safety", "command-rules.json"), `${JSON.stringify({ version: 1, rules: [] })}\n`);
	writeFileSync(join(wsA, ".heli-harness", "tasks", "portable-restore", "yolo.json"), `${JSON.stringify({ enabled: true })}\n`);
	ok(await cli(["push", "--force"], { ...cfgA, ...passphrase }, { cwd: wsA }), "push governance changes");
	const policyPull = await cli(["pull", "--force"], { ...cfgB, ...passphrase }, { cwd: wsB });
	assert.equal(policyPull.status, 1, "governance changes must not apply silently");
	assert.match(policyPull.stderr, /safety\/command-rules\.json \(modified\)/);
	assert.match(policyPull.stderr, /tasks\/portable-restore\/yolo\.json \(added\)/);
	assert.match(policyPull.stderr, /--accept-policy-changes/);
	assert.equal(existsSync(join(wsB, ".heli-harness", "tasks", "portable-restore", "yolo.json")), false, "a refused pull writes nothing");
	ok(await cli(["pull", "--force", "--accept-policy-changes"], { ...cfgB, ...passphrase }, { cwd: wsB }), "accept governance changes");
	assert.deepEqual(JSON.parse(readFileSync(join(wsB, ".heli-harness", "safety", "command-rules.json"), "utf8")).rules, []);

	// init --clone: index.json paths/remotes from the server cannot escape the
	// workspace or inject git options; a safe local remote still clones.
	const remoteRepo = join(root, "remote-repo");
	const git = (...gitArgs) => {
		const result = spawnSync("git", gitArgs, { encoding: "utf8" });
		assert.equal(result.status, 0, result.stderr);
	};
	git("init", "-q", remoteRepo);
	writeFileSync(join(remoteRepo, "README.md"), "# remote\n");
	git("-C", remoteRepo, "add", "README.md");
	git("-C", remoteRepo, "-c", "user.name=heli", "-c", "user.email=heli@example.invalid", "commit", "-q", "-m", "init");
	writeFileSync(
		join(wsA, ".heli-harness", "workspace", "index.json"),
		`${JSON.stringify({
			schemaVersion: 1,
			workspaceRoot: ".",
			repos: [
				{ name: "good", path: "repos/good", remote: remoteRepo },
				{ name: "escape", path: "../escaped", remote: remoteRepo },
				{ name: "option", path: "repos/option", remote: "--upload-pack=touch pwned" },
				{ name: "dash", path: "-rf", remote: remoteRepo },
			],
		})}\n`,
	);
	ok(await cli(["push", "--force"], { ...cfgA, ...passphrase }, { cwd: wsA }), "push repo index");
	const wsD = join(root, "ws-d");
	const initD = ok(await cli(["init", "lab", "--dir", wsD, "--clone", "--accept-policy-changes"], { ...cfgA, ...passphrase }), "init --clone");
	const initOutput = `${initD.stdout}\n${initD.stderr}`;
	assert.ok(existsSync(join(wsD, "repos", "good", "README.md")), "a safe remote is cloned");
	assert.equal(existsSync(join(root, "escaped")), false, "a ../ path must not be cloned outside the workspace");
	assert.equal(existsSync(join(wsD, "repos", "option")), false, "an option-shaped remote must not reach git");
	assert.match(initOutput, /unsafe path "\.\.\/escaped"/);
	assert.match(initOutput, /unsafe remote "--upload-pack=touch pwned"/);
	assert.match(initOutput, /unsafe path "-rf"/);

	// Browser activation: a link cannot approve a device in one click, and the
	// OAuth state is random, single-use and bound to the confirming browser.
	{
		const githubCalls = [];
		const fakeGitHub = async (target) => {
			githubCalls.push(String(target));
			if (String(target).startsWith("https://github.com/login/oauth/access_token")) return Response.json({ access_token: "gho_fake" });
			if (String(target) === "https://api.github.com/user") return Response.json({ id: 42, login: "octo" });
			throw new Error(`unexpected fetch: ${target}`);
		};
		const oauthApi = createApi(memoryStore(), { githubClientId: "client-id", githubClientSecret: "client-secret", fetchImpl: fakeGitHub });
		const origin = "https://sync.example";
		const call = (path, init = {}) => oauthApi.fetch(new Request(`${origin}${path}`, init));
		const device = await (await call("/auth/device/code", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ device_name: "attacker-laptop" }),
		})).json();
		const pollToken = async () => (await call("/auth/device/token", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ device_code: device.device_code }),
		})).json();
		const confirm = (fromOrigin = origin) => call("/activate/confirm", {
			method: "POST",
			headers: { origin: fromOrigin, "content-type": "application/x-www-form-urlencoded" },
			body: `code=${device.user_code}`,
		});
		const issued = (response) => ({
			state: new URL(response.headers.get("location")).searchParams.get("state"),
			cookie: /heli_activate=([0-9a-f]+)/.exec(response.headers.get("set-cookie") || "")?.[1],
		});

		const page = await call(`/activate?code=${device.user_code}`);
		assert.equal(page.status, 200);
		assert.equal(page.headers.get("location"), null, "GET /activate must never redirect to GitHub");
		const pageHtml = await page.text();
		assert.ok(pageHtml.includes(device.user_code) && pageHtml.includes("attacker-laptop"), "the page shows the code and device");
		assert.match(pageHtml, /<form method="POST" action="\/activate\/confirm">/);
		assert.equal((await call(`/auth/github/callback?code=gh&state=${device.user_code}`)).status, 400, "state = user code approves nothing");
		assert.equal((await confirm("https://evil.example")).status, 403, "cross-site confirm is refused");

		const first = await confirm();
		assert.equal(first.status, 303);
		const unbound = issued(first);
		assert.match(unbound.state, /^[0-9a-f]{64}$/);
		assert.notEqual(unbound.state, device.user_code);
		assert.match(first.headers.get("set-cookie"), /HttpOnly/);
		assert.match(first.headers.get("set-cookie"), /SameSite=Lax/);
		assert.equal((await call(`/auth/github/callback?code=gh&state=${unbound.state}`)).status, 400, "no cookie -> refused");
		const wrong = issued(await confirm());
		assert.equal((await call(`/auth/github/callback?code=gh&state=${wrong.state}`, { headers: { cookie: `heli_activate=${"0".repeat(64)}` } })).status, 400, "wrong cookie -> refused");
		assert.equal(githubCalls.length, 0, "unbound states never reach GitHub");
		assert.equal((await pollToken()).error, "authorization_pending");

		const good = issued(await confirm());
		const callback = await call(`/auth/github/callback?code=gh&state=${good.state}`, { headers: { cookie: `heli_activate=${good.cookie}` } });
		assert.equal(callback.status, 200, await callback.text());
		const token = await pollToken();
		assert.equal(token.login, "octo");
		assert.ok(token.token);
		assert.equal((await call(`/auth/github/callback?code=gh&state=${good.state}`, { headers: { cookie: `heli_activate=${good.cookie}` } })).status, 400, "a state is single-use");
	}

	console.log("cloud sync smoke ok");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `unset HELI_SESSION_ID; node scripts/smoke-cloud-sync.mjs`
Expected: FAIL with `AssertionError [ERR_ASSERTION]: stored bundle is encrypted and bound` (actual `'aes-256-gcm-scrypt'`).

- [ ] **Step 3: Replace one-click activation with a confirmed, browser-bound flow**

In `cloud/core.mjs`:

Replace lines 18-28 (the constants block through the end of `function json(...)`) with:

```js
const DEVICE_CODE_TTL_MS = 15 * 60 * 1000;
const ACTIVATION_STATE_TTL_MS = 10 * 60 * 1000;
const ACTIVATE_COOKIE = "heli_activate";
const MAX_BUNDLE_BYTES = 10 * 1024 * 1024;
const RETAINED_VERSIONS = 10;
const USER_CODE_ALPHABET = "BCDFGHJKMNPQRSTVWXZ23456789"; // no ambiguous chars

function json(data, status = 200, headers = {}) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});
}

function html(body, status = 200) {
	return new Response(`<!doctype html><meta charset="utf-8"><title>Heli device activation</title>${body}`, {
		status,
		headers: {
			"content-type": "text/html; charset=utf-8",
			"cache-control": "no-store",
			"x-frame-options": "DENY",
			"content-security-policy": "default-src 'none'; form-action 'self'; frame-ancestors 'none'",
		},
	});
}

function escapeHtml(value) {
	return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[ch]);
}

function readCookie(request, name) {
	for (const part of (request.headers.get("cookie") || "").split(";")) {
		const [key, ...value] = part.trim().split("=");
		if (key === name) return value.join("=");
	}
	return null;
}
```

Inside `createApi`, directly after the `approvePending` function (lines 71-78), insert:

```js

	/** Pending, unexpired, not-yet-approved device request for a user code. */
	async function activatablePending(userCode) {
		const deviceCode = userCode ? await store.get(`usercode:${userCode}`) : null;
		if (!deviceCode) return null;
		const pending = await store.get(`pending:${deviceCode}`);
		if (!pending || pending.expiresAt < now() || pending.approved) return null;
		return pending;
	}

	function normalizeUserCode(value) {
		return String(value || "").trim().toUpperCase();
	}
```

Replace the `"GET /activate"` route and the first part of `"GET /auth/github/callback"` (lines 149-180, from `		// Browser activation: enter/confirm the user code, then bounce via GitHub OAuth.` through the `if (!code || !userCode || !githubClientId || !githubClientSecret) { return new Response("Invalid activation callback.", { status: 400 }); }` block) with:

```js
		// Browser activation step 1: enter the code, then CONFIRM it on a page
		// that shows the code and device. A link can no longer approve a device
		// in one click (GET never redirects to GitHub).
		"GET /activate": async (request) => {
			if (!githubClientId) {
				return new Response("Activation requires GitHub OAuth configuration.", { status: 503 });
			}
			const userCode = normalizeUserCode(new URL(request.url).searchParams.get("code"));
			if (!userCode) {
				return html(
					'<form method="GET" action="/activate"><h1>Heli device activation</h1>' +
						"<p>Enter the code shown in your terminal:</p>" +
						'<input name="code" autofocus autocomplete="off" placeholder="XXXX-XXXX"> <button>Continue</button></form>',
				);
			}
			const pending = await activatablePending(userCode);
			if (!pending) return html("<h1>Activation code invalid or expired</h1><p>Re-run <code>heli auth login</code>.</p>", 400);
			return html(
				"<h1>Authorize this device?</h1>" +
					`<p>Code: <strong>${escapeHtml(userCode)}</strong><br>Device: <strong>${escapeHtml(pending.deviceName)}</strong></p>` +
					"<p>Only continue if <em>you</em> just ran <code>heli auth login</code> and your terminal shows this exact code. " +
					"Authorizing gives that device access to your Heli sync workspaces.</p>" +
					'<form method="POST" action="/activate/confirm">' +
					`<input type="hidden" name="code" value="${escapeHtml(userCode)}"><button>Authorize this device</button></form>`,
			);
		},

		// Browser activation step 2: explicit same-origin POST. Issues a random,
		// single-use OAuth state bound to the user code and to a cookie in THIS
		// browser, then sends the browser to GitHub.
		"POST /activate/confirm": async (request) => {
			if (!githubClientId) {
				return new Response("Activation requires GitHub OAuth configuration.", { status: 503 });
			}
			const url = new URL(request.url);
			// Browsers attach Origin to every POST; a cross-site auto-submitting form cannot forge ours.
			if (request.headers.get("origin") !== url.origin) {
				return html("<h1>Cross-site activation request refused</h1>", 403);
			}
			const form = new URLSearchParams(await request.text());
			const userCode = normalizeUserCode(form.get("code"));
			if (!(await activatablePending(userCode))) {
				return html("<h1>Activation code invalid or expired</h1><p>Re-run <code>heli auth login</code>.</p>", 400);
			}
			const state = randomHex(32);
			const browserNonce = randomHex(32);
			await store.put(`oauthstate:${state}`, {
				userCode,
				browserHash: await sha256Hex(browserNonce),
				expiresAt: now() + ACTIVATION_STATE_TTL_MS,
			});
			const redirect = new URL("https://github.com/login/oauth/authorize");
			redirect.searchParams.set("client_id", githubClientId);
			redirect.searchParams.set("scope", "read:user");
			redirect.searchParams.set("state", state);
			redirect.searchParams.set("redirect_uri", `${url.origin}/auth/github/callback`);
			const secure = url.protocol === "https:" ? "; Secure" : "";
			return new Response(null, {
				status: 303,
				headers: {
					location: redirect.toString(),
					"set-cookie": `${ACTIVATE_COOKIE}=${browserNonce}; Path=/auth/github/callback; HttpOnly; SameSite=Lax; Max-Age=${ACTIVATION_STATE_TTL_MS / 1000}${secure}`,
					"cache-control": "no-store",
				},
			});
		},

		"GET /auth/github/callback": async (request) => {
			const url = new URL(request.url);
			const code = url.searchParams.get("code");
			const state = url.searchParams.get("state");
			if (!code || !state || !githubClientId || !githubClientSecret) {
				return new Response("Invalid activation callback.", { status: 400 });
			}
			// The state must be one we issued, unexpired, and bound to this
			// browser's cookie. It is single-use: consumed before anything else.
			const activation = await store.get(`oauthstate:${state}`);
			await store.delete(`oauthstate:${state}`);
			const browserNonce = readCookie(request, ACTIVATE_COOKIE);
			if (!activation || activation.expiresAt < now() || !browserNonce || (await sha256Hex(browserNonce)) !== activation.browserHash) {
				return new Response("Activation session invalid or expired. Open the link printed by heli auth login and confirm the code again.", {
					status: 400,
					headers: { "content-type": "text/plain; charset=utf-8" },
				});
			}
			const userCode = activation.userCode;
```

(The rest of the callback — the GitHub token exchange and user lookup — stays.) Then replace the callback's final response:

```js
			const ok = await approvePending(userCode, { userId: `gh:${ghUser.id}`, login: ghUser.login });
			return new Response(
				ok
					? "Device authorized. You can close this tab and return to your terminal."
					: "Activation code invalid or expired. Re-run: heli auth login",
				{ status: ok ? 200 : 400, headers: { "content-type": "text/plain; charset=utf-8" } },
			);
```

with:

```js
			const ok = await approvePending(userCode, { userId: `gh:${ghUser.id}`, login: ghUser.login });
			return new Response(
				ok
					? "Device authorized. You can close this tab and return to your terminal."
					: "Activation code invalid or expired. Re-run: heli auth login",
				{
					status: ok ? 200 : 400,
					headers: {
						"content-type": "text/plain; charset=utf-8",
						"set-cookie": `${ACTIVATE_COOKIE}=; Path=/auth/github/callback; HttpOnly; SameSite=Lax; Max-Age=0`,
					},
				},
			);
```

(The test-only `POST /activate` JSON route stays unchanged; it is still disabled unless `testLogin`.)

- [ ] **Step 4: Bind ciphertext to workspace and version; detect governance changes**

In `lib/cli/cloud-bundle.mjs`, replace lines 22-23:

```js
export const BUNDLE_FORMAT = "heli-bundle-v1";
const E2E_SCHEME = "aes-256-gcm-scrypt";
```

with:

```js
export const BUNDLE_FORMAT = "heli-bundle-v1";
// The GCM additional authenticated data binds ciphertext to its sync workspace
// id and version, so a server cannot replay or relabel bundles.
export const E2E_SCHEME = "aes-256-gcm-scrypt-bound";
const LEGACY_E2E_SCHEME = "aes-256-gcm-scrypt";

function bundleAad(workspaceId, version) {
	return Buffer.from(`${BUNDLE_FORMAT}|${workspaceId}|${version}`, "utf8");
}
```

Replace `packBundle` and `unpackBundle` (lines 121-178) with:

```js
/**
 * @param {Record<string, string>} files
 * @param {{ passphrase?: string|null, workspaceId?: string|null, version?: number|null }} [options]
 *   Encrypted bundles must name the sync workspace id and the version they will be stored as.
 */
export function packBundle(files, { passphrase = null, workspaceId = null, version = null } = {}) {
	if (!passphrase) {
		return gzipSync(Buffer.from(JSON.stringify({ format: BUNDLE_FORMAT, encryption: "none", files }), "utf8"));
	}
	if (!workspaceId || !Number.isInteger(version) || version < 1) {
		throw new Error("An encrypted bundle must be bound to its sync workspace id and version.");
	}
	const salt = randomBytes(16);
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
	cipher.setAAD(bundleAad(workspaceId, version));
	const plaintext = gzipSync(Buffer.from(JSON.stringify(files), "utf8"));
	const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
	return gzipSync(
		Buffer.from(
			JSON.stringify({
				format: BUNDLE_FORMAT,
				encryption: E2E_SCHEME,
				workspaceId,
				version,
				salt: salt.toString("base64"),
				iv: iv.toString("base64"),
				data: ciphertext.toString("base64"),
			}),
			"utf8",
		),
	);
}

/**
 * @param {Buffer} bytes
 * @param {{ passphrase?: string|null, requireEncryption?: boolean, workspaceId?: string|null, version?: number|null }} [options]
 *   requireEncryption: refuse plaintext (E2E is on locally). workspaceId/version: the
 *   values this machine expects; they are verified by AES-GCM, not trusted from the bundle.
 */
export function unpackBundle(bytes, { passphrase = null, requireEncryption = false, workspaceId = null, version = null } = {}) {
	let parsed;
	try {
		parsed = JSON.parse(gunzipSync(bytes).toString("utf8"));
	} catch {
		throw new Error("Bundle is not a valid heli-bundle (gzip/JSON parse failed).");
	}
	if (parsed.format !== BUNDLE_FORMAT) {
		throw new Error(`Unsupported bundle format: ${parsed.format || "unknown"}`);
	}
	if (!parsed.encryption || parsed.encryption === "none") {
		if (requireEncryption) {
			throw new Error("Refusing an unencrypted bundle: end-to-end encryption is on for this workspace, so the sync server must only return ciphertext.");
		}
		if (!parsed.files || typeof parsed.files !== "object") throw new Error("Bundle has no files map.");
		return parsed.files;
	}
	if (parsed.encryption === LEGACY_E2E_SCHEME) {
		throw new Error("Refusing a legacy end-to-end bundle that is not bound to its workspace and version. Re-push it from an up-to-date heli client.");
	}
	if (parsed.encryption !== E2E_SCHEME) {
		throw new Error(`Bundle encryption "${parsed.encryption}" is not supported by this CLI version.`);
	}
	if (!passphrase) {
		throw new Error("Bundle is end-to-end encrypted. Set HELI_E2E_PASSPHRASE and retry.");
	}
	if (!workspaceId || !Number.isInteger(version)) {
		throw new Error("Cannot verify an encrypted bundle without the expected sync workspace id and version.");
	}
	const salt = Buffer.from(parsed.salt, "base64");
	const iv = Buffer.from(parsed.iv, "base64");
	const payload = Buffer.from(parsed.data, "base64");
	const tag = payload.subarray(payload.length - 16);
	const ciphertext = payload.subarray(0, payload.length - 16);
	let plaintext;
	try {
		const decipher = createDecipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
		decipher.setAAD(bundleAad(workspaceId, version));
		decipher.setAuthTag(tag);
		plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
	} catch {
		throw new Error("Decryption failed: wrong HELI_E2E_PASSPHRASE, a corrupted bundle, or a bundle that belongs to a different workspace or version.");
	}
	return JSON.parse(gunzipSync(plaintext).toString("utf8"));
}

const POLICY_DIRS = ["safety/", "policies/"];
const TASK_YOLO_FILE_RE = /^tasks\/[^/]+\/yolo\.json$/;
const TASK_FILE_RE = /^tasks\/[^/]+\/task\.json$/;

function taskEnablesYolo(text) {
	try {
		const task = JSON.parse(text);
		return task?.yolo?.enabled === true || ["yolo", "unguarded", "dangerous"].includes(task?.mode);
	} catch {
		return false;
	}
}

const sameText = (a, b) => String(a).replace(/\r\n/g, "\n") === String(b).replace(/\r\n/g, "\n");

/**
 * Governance-bearing differences an incoming bundle would apply: any added or
 * modified file under safety/ or policies/, any tasks/<id>/yolo.json, and any
 * task.json that turns YOLO on.
 * @returns {Array<{ rel: string, change: string }>}
 */
export function policyBearingChanges(localFiles, incomingFiles) {
	const changes = [];
	for (const [rel, content] of Object.entries(incomingFiles)) {
		const local = localFiles[rel];
		if (local !== undefined && sameText(local, content)) continue;
		const change = local === undefined ? "added" : "modified";
		if (POLICY_DIRS.some((dir) => rel.startsWith(dir)) || TASK_YOLO_FILE_RE.test(rel)) {
			changes.push({ rel, change });
		} else if (TASK_FILE_RE.test(rel) && taskEnablesYolo(content) && !(local !== undefined && taskEnablesYolo(local))) {
			changes.push({ rel, change: "enables YOLO" });
		}
	}
	return changes.sort((a, b) => (a.rel < b.rel ? -1 : 1));
}
```

- [ ] **Step 5: Enforce the checks in push, pull and init**

In `lib/cli/cloud.mjs`:

In the `./cloud-bundle.mjs` import list (lines 21-30), add `policyBearingChanges,` after `normalizeTaskFilesForBundle,`.

In `runPush`, replace lines 333-336:

```js
	const bundle = packBundle(files, { passphrase: passphraseFor(state) });
	let baseVersion = state.lastVersion ?? 0;
	for (;;) {
		try {
```

with:

```js
	const passphrase = passphraseFor(state);
	let baseVersion = state.lastVersion ?? 0;
	for (;;) {
		// Encrypted bundles are bound to the version they will be stored as, so
		// re-pack on every attempt (a --force retry changes the base version).
		const bundle = packBundle(files, { passphrase, workspaceId: state.workspaceId, version: baseVersion + 1 });
		try {
```

In `runPull`, replace lines 385-387:

```js
	const bytes = Buffer.from(await response.arrayBuffer());
	const unpackedFiles = unpackBundle(bytes, { passphrase: process.env.HELI_E2E_PASSPHRASE || null });
	const files = restoreTaskFilesForWorkspace(workspaceRoot, unpackedFiles);
```

with:

```js
	const version = Number(response.headers.get("x-version"));
	if (!Number.isInteger(version) || version < 1) {
		throw new Error("Pull failed: the sync server did not report a valid bundle version.");
	}
	const requestedVersion = versionArg ? Number(versionArg) : null;
	if (requestedVersion !== null && version !== requestedVersion) {
		throw new Error(`Pull refused: requested v${requestedVersion} but the sync server returned v${version}.`);
	}
	const lastApplied = Number(state.lastVersion) || 0;
	if (requestedVersion === null && version < lastApplied) {
		throw new Error(
			`Pull refused: the sync server offered v${version}, older than v${lastApplied} already applied on this machine (possible rollback). ` +
				`To restore an older version on purpose, run: heli pull --version ${version}`,
		);
	}
	const bytes = Buffer.from(await response.arrayBuffer());
	const unpackedFiles = unpackBundle(bytes, {
		passphrase: process.env.HELI_E2E_PASSPHRASE || null,
		requireEncryption: Boolean(state.e2e),
		workspaceId: state.workspaceId,
		version,
	});
	const files = restoreTaskFilesForWorkspace(workspaceRoot, unpackedFiles);
	const policyChanges = policyBearingChanges(collectBundleFiles(workspaceRoot), files);
	if (policyChanges.length && !args.includes("--accept-policy-changes")) {
		for (const change of policyChanges) console.error(`  governance change: ${change.rel} (${change.change})`);
		throw new Error(
			`Pull refused: v${version} changes ${policyChanges.length} governance file(s) (safety/, policies/ or task YOLO state). ` +
				"Nothing was written. Review the list above, then re-run with --accept-policy-changes to apply it.",
		);
	}
```

and delete the later duplicate `	const version = Number(response.headers.get("x-version"));` line (line 399, just before `writeJsonAtomic(syncStatePath(workspaceRoot), {`).

Replace the `heli init` section — from the line `// -------------------------------------------------------------- heli init` through the end of `runInit` (lines 448-490) — with:

```js
// -------------------------------------------------------------- heli init

/** A workspace-relative repo path: no absolute/drive/UNC forms, no "..", no leading "-". */
function safeRepoPath(value) {
	const text = String(value ?? "").trim();
	if (!text || text.startsWith("-") || isAbsolute(text) || /^[a-zA-Z]:/.test(text) || /^[\\/]/.test(text)) return null;
	if (text.split(/[\\/]/).includes("..")) return null;
	return text;
}

function safeRemote(value) {
	const text = String(value ?? "").trim();
	return text && !text.startsWith("-") ? text : null;
}

async function runInit(args, packageRoot) {
	const name = args.find((a) => !a.startsWith("--"));
	if (!name) throw new Error("Usage: heli init <sync-workspace-name> [--dir path] [--clone] [--accept-policy-changes]");
	const creds = requireCredentials();
	const dirArg = flagValue(args, "--dir");
	const dir = dirArg ? (isAbsolute(dirArg) ? dirArg : join(process.cwd(), dirArg)) : process.cwd();

	if (
		!existsSync(join(dir, ".heli-harness")) &&
		!existsSync(join(dir, ".heli", "workspace.json"))
	) {
		mkdirSync(dir, { recursive: true });
		const { runInstall } = await import("./install.mjs");
		runInstall(packageRoot, [dir]);
	}

	const list = await api(creds, "GET", "/ws");
	const ws = list.find((w) => w.name === name || w.id === name);
	if (!ws) throw new Error(`No sync workspace named "${name}". Run: heli ws list`);
	linkWorkspace(dir, { ...ws, currentVersion: 0 });
	await runPull([dir, "--force", ...(args.includes("--accept-policy-changes") ? ["--accept-policy-changes"] : [])]);

	// Offer the product repos back: entries with a `remote` can be re-cloned.
	// index.json comes from the sync server, so its paths/remotes are untrusted.
	const index = readJson(pathsFor(dir).indexPath, {});
	const repos = Array.isArray(index.repos) ? index.repos : [];
	for (const repo of repos) {
		if (!repo.path) continue;
		const repoPath = safeRepoPath(repo.path);
		if (!repoPath) {
			console.warn(`Skipping repo ${repo.name}: unsafe path ${JSON.stringify(repo.path)} in workspace/index.json (must stay inside the workspace and not start with "-").`);
			continue;
		}
		if (existsSync(join(dir, repoPath))) continue;
		if (repo.remote && !safeRemote(repo.remote)) {
			console.warn(`Skipping repo ${repo.name}: unsafe remote ${JSON.stringify(repo.remote)} in workspace/index.json.`);
			continue;
		}
		if (repo.remote && args.includes("--clone")) {
			console.log(`Cloning ${repo.name} from ${repo.remote}...`);
			// "--" ends git's option parsing: neither value can inject a git option.
			const result = spawnSync("git", ["clone", "--", repo.remote, join(dir, repoPath)], { stdio: "inherit" });
			if (result.status !== 0) console.warn(`Clone failed for ${repo.name} — clone it manually.`);
		} else {
			console.log(
				`Missing repo: ${repo.name} at ${repo.path}` +
					(repo.remote ? ` — clone with: git clone -- ${repo.remote} ${repo.path} (or re-run init with --clone)` : " — no remote recorded in workspace/index.json; clone it manually"),
			);
		}
	}

	console.log(`\nWorkspace "${ws.name}" restored at ${dir}. Next: open your agent from this folder.`);
}
```

- [ ] **Step 6: Mark cloud sync experimental in the CLI help**

In `bin/heli.mjs`, replace lines 77-80:

```
  auth login|logout|status|devices     (cloud sync)
  ws create|link|unlink|list|versions|delete  (cloud sync; unlink = back to local-only)
  push | pull | sync [auto|e2e on|off] (cloud sync)
  init <name> [--dir p] [--clone]      (cloud sync: full device restore)
```

with:

```
Experimental cloud sync (optional; see docs/architecture/cloud-sync.md):
  auth login|logout|status|devices
  ws create|link|unlink|list|versions|delete  (unlink = back to local-only)
  push | pull [--version N] [--accept-policy-changes] | sync [auto|e2e on|off]
  init <name> [--dir p] [--clone] [--accept-policy-changes]  (full device restore)
```

- [ ] **Step 7: Sync the embedded CLI and run the cloud test**

Run: `node scripts/sync-workspace-cli.mjs && unset HELI_SESSION_ID; node scripts/smoke-cloud-sync.mjs`
Expected: `cloud sync smoke: cross-root task target restored` then `cloud sync smoke ok`

- [ ] **Step 8: Update the cloud-sync design doc**

In `docs/architecture/cloud-sync.md` (it is exempt from version checks; do not add `v0.8` anywhere — `validate-release` forbids it):

1. After line 4 (`**Architecture status:** shipped optional service with historical v0.7 phase notes retained`) insert the line: `**Status:** Experimental — optional, off by default, and not part of Heli's governance security boundary. See [Integrity hardening](#integrity-hardening).`
2. In the Phase 2 amendment 4 (line 14), replace:

```markdown
Scheme: `aes-256-gcm-scrypt` (scrypt-derived 256-bit key, random salt+iv per bundle, GCM tag appended).
```

with:

```markdown
Scheme: `aes-256-gcm-scrypt-bound` (scrypt-derived 256-bit key, random salt+iv per bundle, GCM tag appended, sync workspace id + version bound as additional authenticated data; the original unbound `aes-256-gcm-scrypt` bundles are refused).
```

3. In "Auth — OAuth device flow", after the bullet that ends with `` `code + https://heli.<domain>/activate`, and polls.`` insert:

```markdown
- `GET /activate?code=…` only renders a confirmation page showing the code and the
  requesting device name; it never redirects. The user must press **Authorize**, a
  same-origin `POST /activate/confirm` (cross-origin posts are refused), which
  stores a random single-use OAuth `state` (10 min TTL) bound to the user code and to
  an `HttpOnly; SameSite=Lax` cookie in that browser. The GitHub callback approves the
  device only when the state exists, is unexpired and matches that cookie.
```

4. In the data-model block, after `usercode:<user-code>            → device-code lookup for the activation page` add:

```
oauthstate:<state>              → { userCode, browserHash, expiresAt } single-use
                                  activation state (10 min TTL)
```

5. In the CLI surface block, change `heli pull [--version N] [--force]` to `heli pull [--version N] [--force] [--accept-policy-changes]` and `heli init <name> [--dir path] [--clone]` to `heli init <name> [--dir path] [--clone] [--accept-policy-changes]`.
6. In "Security & Privacy", change ``Scheme `aes-256-gcm-scrypt`: a scrypt-derived 256-bit key`` to ``Scheme `aes-256-gcm-scrypt-bound`: a scrypt-derived 256-bit key``.
7. Insert a new section immediately before `## Risks`:

```markdown
## Integrity hardening

The sync server is treated as untrusted for governance purposes:

- **No downgrade:** when E2E is on for a workspace (set locally or latched by pulling
  ciphertext), `heli pull` refuses plaintext bundles.
- **No relabeling:** encrypted bundles authenticate the sync workspace id and version
  as AES-GCM additional data, so a bundle cannot be served under another version or
  workspace.
- **No silent rollback:** a pull that would apply a version older than the one this
  machine already applied is refused unless the user asks for it explicitly with
  `heli pull --version N`.
- **No silent governance changes:** a pull that would add or change anything under
  `safety/` or `policies/`, add or change a `tasks/*/yolo.json`, or turn a task's YOLO
  mode on is refused as a whole (nothing is written) and lists the files; re-run with
  `--accept-policy-changes` after reviewing them. `heli init` forwards the flag.
- **No option injection:** `heli init --clone` skips repo entries whose path is
  absolute, contains `..` or starts with `-`, or whose remote starts with `-`, and runs
  `git clone -- <remote> <path>`.

```

Run: `node scripts/validate-release.mjs > /dev/null && echo release-ok; node scripts/validate-doc-currentness.mjs | tail -1`
Expected: `release-ok` and `  ✅ documentation currentness: ... current-facing Markdown files scanned against v0.10.3`

- [ ] **Step 9: Regress and commit**

Run: `node scripts/sync-workspace-cli.mjs --check && unset HELI_SESSION_ID; for t in smoke-cli-entry smoke-linked-portability smoke-cli-task; do node scripts/$t.mjs > /dev/null 2>&1 && echo "ok $t" || echo "FAIL $t"; done`
Expected: `sync-workspace-cli --check: ok` and three `ok ...` lines.

Run the full-chain runner from Global Constraints. Expected: `FAILED: ["node scripts/smoke-portable-targets.mjs"]`.

```bash
git add cloud/core.mjs lib/cli/cloud-bundle.mjs lib/cli/cloud.mjs bin/heli.mjs .heli-harness/heli.mjs .heli-harness/cli docs/architecture/cloud-sync.md scripts/smoke-cloud-sync.mjs
git status --short
git commit -m "fix: harden experimental cloud sync login and pulls" -m "Device activation now needs an explicit same-origin confirmation and a random single-use OAuth state bound to the confirming browser. Pulls refuse plaintext when E2E is on, refuse rollbacks and relabeled ciphertext (bundles bind workspace id and version as AES-GCM AAD), and refuse governance changes without --accept-policy-changes. heli init --clone rejects unsafe repo paths and remotes and passes -- to git. Cloud sync is labeled experimental." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Release hygiene, docs truth, and the v0.10.4 bump

**Files:**
- Modify: `scripts/validate-doc-currentness.mjs:65-66`, `:88-94`
- Modify: `.heli-harness/safety/command-tiers.md:3`, `docs/architecture/acp-governance-proxy.md:3`, `docs/architecture/evidence-governed-autonomy.md:4`, `docs/decisions/0002-portable-governance-kernel.md:5`, `:21`
- Modify: `.github/workflows/release.yml:74-119`
- Modify (full rewrite): `scripts/lib/release-version.mjs`, `scripts/release.mjs`
- Modify: `scripts/smoke-release-npm.mjs:3-7`, `:145`
- Modify: `SECURITY.md:11`, `docs/ENFORCEMENT_MATRIX.md:16-17`, `:22`, `docs/ADAPTER_SUPPORT_MATRIX.md:48`, `README.md:109-121`, `INSTALL.md:157`, `.heli-harness/safety/command-tiers.md` (new section before `## T0`), `docs/architecture/governance-model.md:120`
- Modify: `CHANGELOG.md` (new top entry), then every file `scripts/release.mjs --prepare-only` rewrites

**Interfaces:**
- Consumes: behavior from Tasks 1–6 (documented here).
- Produces: `releaseVersionFiles(root): string[]` in `scripts/lib/release-version.mjs`; `scripts/release.mjs <x.y.z> [summary] [--push] [--prepare-only]`.

- [ ] **Step 1: Fix the doc-currentness version regex (red)**

In `scripts/validate-doc-currentness.mjs`, replace line 66 (`const oldVersion = /\bv0\.(?:[0-9])(?:\.\d+|\.x)?\b/g;`) with:

```js
// Any minor width (v0.9.1, v0.10.1, v0.11.x); the old single-digit pattern
// silently skipped every v0.10.x reference.
const oldVersion = /\bv0\.(\d+)(?:\.(\d+|x))?\b/g;
const currentMinor = currentVersion.split(".")[1];

/** The exact current tag, or a bare series reference to the current minor line (v0.10 / v0.10.x). */
function isCurrentReference(match) {
	if (match[0] === currentTag) return true;
	return match[1] === currentMinor && (match[2] === undefined || match[2] === "x");
}
```

and replace lines 88-94:

```js
		const matches = [...line.matchAll(oldVersion)].map((m) => m[0]);
		for (const match of matches) {
			if (match === currentTag) continue;
			if (!historicalLineMarker.test(line)) {
				fail(path, `line ${index + 1} references ${match} without historical/compatibility context`);
			}
		}
```

with:

```js
		for (const match of line.matchAll(oldVersion)) {
			if (isCurrentReference(match)) continue;
			if (!historicalLineMarker.test(line)) {
				fail(path, `line ${index + 1} references ${match[0]} without historical/compatibility context`);
			}
		}
```

Run: `node scripts/validate-doc-currentness.mjs | tail -7`
Expected: FAIL listing exactly five issues — `.heli-harness/safety/command-tiers.md: line 3 references v0.10.1`, `docs/architecture/acp-governance-proxy.md: line 3 references v0.10.1`, `docs/architecture/evidence-governed-autonomy.md: line 4 references v0.10.1`, `docs/decisions/0002-portable-governance-kernel.md: line 5 references v0.10.1`, `... line 21 references v0.10.1` — and `document-currentness: FAIL (5 issue(s), ...)`.

- [ ] **Step 2: Fix the stale references (green)**

Make these whole-line replacements (`-` line = current text, `+` line = new text):

`.heli-harness/safety/command-tiers.md` line 3:

```diff
-**Current release:** `v0.10.1`
+**Current release:** `v0.10.3`
```

`docs/architecture/acp-governance-proxy.md` line 3:

```diff
-**Status:** Experimental integration; not part of the stable v0.10.1 governance-kernel contract.
+**Status:** Experimental integration; not part of the stable governance-kernel contract.
```

`docs/architecture/evidence-governed-autonomy.md` line 4:

```diff
-**Current baseline:** `v0.10.1` — see [Current Heli architecture](README.md) and [Governance Model](governance-model.md).
+**Current architecture:** see [Current Heli architecture](README.md) and [Governance Model](governance-model.md).
```

`docs/decisions/0002-portable-governance-kernel.md` lines 5 and 21:

```diff
-Accepted — current architecture for `v0.10.1`
+Accepted — current architecture (introduced in `v0.10.1`)
```

```diff
-For `v0.10.1`:
+Since `v0.10.1`:
```

Run: `node scripts/validate-doc-currentness.mjs | tail -1`
Expected: `  ✅ documentation currentness: ... current-facing Markdown files scanned against v0.10.3`

- [ ] **Step 3: Write the failing release tests**

In `scripts/smoke-release-npm.mjs`, replace lines 3-7:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveNpmCheckInvocation } from "./lib/release-npm.mjs";
```

with:

```js
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveNpmCheckInvocation } from "./lib/release-npm.mjs";
import { currentVersion, releaseVersionFiles } from "./lib/release-version.mjs";
```

and replace the final line `console.log("release npm invocation smoke ok");` with:

```js
// Release workflow: a missing NPM_TOKEN must fail the run loudly, never skip
// publication while still reporting success (0.10.x never reached npm that way).
{
	const workflow = readFileSync(join(root, ".github", "workflows", "release.yml"), "utf8").replace(/\r\n/g, "\n");
	const start = workflow.indexOf("- name: Publish to npm");
	const end = workflow.indexOf("- name: Build release notes");
	assert.ok(start > 0 && end > start, "release.yml must keep a 'Publish to npm' step before 'Build release notes'");
	const publishStep = workflow.slice(start, end);
	assert.match(publishStep, /if \[ -z "\$\{NODE_AUTH_TOKEN:-\}" \]; then\n\s*echo "::error::[^\n]*"\n\s*exit 1/, "missing NPM_TOKEN must exit 1 with an ::error:: annotation");
	assert.doesNotMatch(publishStep, /exit 0|skipped-no-token|::warning::/, "missing NPM_TOKEN must not be treated as success");
}

// Every tracked file that names the current version is rewritten by the release
// script, except history and fixtures that pin a version on purpose.
{
	const version = currentVersion(root);
	const grep = spawnSync("git", ["grep", "-l", "--fixed-strings", version], { cwd: root, encoding: "utf8" });
	if (grep.status === 0 || grep.status === 1) {
		const listed = new Set(releaseVersionFiles(root));
		const intentional = (path) =>
			path === "CHANGELOG.md" ||
			path.startsWith("docs/reports/") ||
			path.startsWith("docs/superpowers/plans/") ||
			path === "scripts/smoke-host-manager.mjs";
		const missing = grep.stdout.split(/\r?\n/).filter(Boolean).filter((path) => !intentional(path) && !listed.has(path));
		assert.deepEqual(missing, [], `scripts/release.mjs would leave ${version} behind in: ${missing.join(", ")}`);
	}
	const releaseText = readFileSync(join(root, "scripts", "release.mjs"), "utf8");
	assert.match(releaseText, /releaseVersionFiles\(root\)/, "release.mjs must use the shared version-file list");
	assert.match(releaseText, /--prepare-only/, "release.mjs must support --prepare-only");
}

console.log("release npm invocation smoke ok");
```

Run: `node scripts/smoke-release-npm.mjs`
Expected: FAIL with `SyntaxError: The requested module './lib/release-version.mjs' does not provide an export named 'releaseVersionFiles'`

- [ ] **Step 4: Share a complete release version-file list**

Replace the whole of `scripts/lib/release-version.mjs` with:

```js
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
```

(The canonical `.heli-harness/skills/heli-install/SKILL.md`, `safety/secrets.md`, `safety/command-tiers.md` and the adapters' `install.md` files were missing before, so the old script would have bumped the plugin skill copies but not the canonical skill and failed `sync-plugin-skills --check`.)

Run: `node scripts/smoke-release-npm.mjs`
Expected: FAIL with `missing NPM_TOKEN must exit 1 with an ::error:: annotation`

- [ ] **Step 5: Make the publish step fail loudly**

In `.github/workflows/release.yml`, replace lines 74-90 (the `Publish to npm when credentials are configured` step) with:

```yaml
      - name: Publish to npm
        if: steps.npm_meta.outputs.exists != 'true'
        id: npm_publish
        shell: bash
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
          VERSION: ${{ steps.meta.outputs.version }}
          PACKAGE_FILE: ${{ steps.pack.outputs.file }}
        run: |
          set -euo pipefail
          if [ -z "${NODE_AUTH_TOKEN:-}" ]; then
            echo "::error::NPM_TOKEN is not configured, so heli-harness@${VERSION} was NOT published to npm. Add the NPM_TOKEN repository secret and re-run this workflow; no tag or GitHub release is created until publication succeeds."
            exit 1
          fi
          npm publish "$PACKAGE_FILE" --access public --provenance
          echo "status=published" >> "$GITHUB_OUTPUT"
```

and, in the `Build release notes` step, replace its now-unreachable else branch (lines 115-119):

```yaml
          if [ "$NPM_EXISTS" = "true" ] || [ "$NPM_STATUS" = "published" ]; then
            printf '\n**npm:** heli-harness@%s\n' "$VERSION" >> release-notes.md
          else
            printf '\n**npm:** registry publication not performed by this workflow (NPM_TOKEN unavailable).\n' >> release-notes.md
          fi
```

with:

```yaml
          printf '\n**npm:** heli-harness@%s\n' "$VERSION" >> release-notes.md
```

(A failed publish step stops the job, so the tag/release steps only run after npm has the version.)

Run: `node scripts/smoke-release-npm.mjs`
Expected: FAIL with `release.mjs must use the shared version-file list`

- [ ] **Step 6: Give the release script `--prepare-only` and the shared list**

Replace the whole of `scripts/release.mjs` with:

```js
#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveNpmCheckInvocation } from "./lib/release-npm.mjs";
import { releaseVersionFiles } from "./lib/release-version.mjs";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const nextVersion = args.shift();
const push = args.includes("--push");
// --prepare-only: rewrite versions + the CHANGELOG heading, then stop (no
// check, commit or tag). For version bumps inside a PR: CI runs the checks and
// the release workflow tags main.
const prepareOnly = args.includes("--prepare-only");
const summary = args.filter((arg) => arg !== "--push" && arg !== "--prepare-only").join(" ") || "Release updates";
const semver = /^(\d+)\.(\d+)\.(\d+)$/;

function fail(message) {
	console.error(`release: ${message}`);
	process.exit(1);
}

function run(command, commandArgs) {
	const result = spawnSync(command, commandArgs, { cwd: root, encoding: "utf8", stdio: "inherit" });
	if (result.error) console.error(`release: spawn error: ${result.error.message}`);
	if (result.status !== 0) fail(`${command} ${commandArgs.join(" ")} failed`);
}

function git(...gitArgs) {
	return spawnSync("git", ["-C", root, ...gitArgs], { encoding: "utf8" });
}

if (!nextVersion || !semver.test(nextVersion)) fail("usage: npm run release -- <x.y.z> [summary] [--push] [--prepare-only]");

const packagePath = join(root, "package.json");
const current = JSON.parse(readFileSync(packagePath, "utf8")).version;
if (!semver.test(current)) fail(`current package version is invalid: ${current}`);
if (nextVersion === current) fail(`version is already ${current}`);
const compareSemver = (a, b) => {
	const pa = a.split(".").map(Number);
	const pb = b.split(".").map(Number);
	for (let i = 0; i < 3; i++) {
		if (pa[i] !== pb[i]) return pa[i] - pb[i];
	}
	return 0;
};
if (compareSemver(nextVersion, current) <= 0) fail(`new version ${nextVersion} must be greater than ${current}`);

const status = git("status", "--porcelain=v1").stdout;
const dirtyPaths = status.split("\n").filter(Boolean).map((line) => line.slice(3).trim().replaceAll("\\", "/"));
const allowed = [
	"package.json", "manifest.json", ".heli-harness/manifest.json", ".heli-harness/adapters/",
	"README.md", "ROADMAP.md", "INSTALL.md", "CHANGELOG.md", "docs/INSTALL_MATRIX.md", "docs/ADAPTER_SUPPORT_MATRIX.md",
	"scripts/smoke-claude-plugin.mjs", "scripts/smoke-codex-plugin.mjs", "scripts/smoke-cursor-plugin.mjs",
	"scripts/smoke-pack-artifact.mjs",
	"scripts/lib/release-version.mjs", "scripts/lib/release-npm.mjs", "scripts/release.mjs",
	".agents/",
];
const isAllowed = (path) => allowed.some((prefix) => path === prefix || path.startsWith(prefix));
const unrelated = dirtyPaths.filter((path) => !isAllowed(path));
if (unrelated.length) fail(`unrelated dirty paths: ${unrelated.join(", ")}`);

const versionFiles = releaseVersionFiles(root);
for (const relativePath of versionFiles) {
	const path = join(root, relativePath);
	writeFileSync(path, readFileSync(path, "utf8").replaceAll(current, nextVersion));
}

const changelog = join(root, "CHANGELOG.md");
const changelogText = readFileSync(changelog, "utf8");
const unreleasedHeading = /^## Unreleased[^\n]*$/m;
if (unreleasedHeading.test(changelogText)) {
	// Hand-written Unreleased section becomes the release entry — matches actual
	// practice; a stub insert would orphan it below a content-free heading.
	writeFileSync(changelog, changelogText.replace(unreleasedHeading, `## v${nextVersion} - ${summary}`));
} else {
	writeFileSync(changelog, changelogText.replace(/^# Changelog\r?\n/, `# Changelog\n\n## v${nextVersion} - ${summary}\n\n### Changed\n\n- Release metadata and validation updated.\n`));
}

if (prepareOnly) {
	console.log(`release: prepared v${nextVersion} in ${versionFiles.length} version files + CHANGELOG.md (not checked, committed or tagged)`);
	process.exit(0);
}

// Decision lives in scripts/lib/release-npm.mjs so it stays unit-testable
// (scripts/smoke-release-npm.mjs) instead of only being provable by a real release.
// npm_execpath is normally set here because release runs via `npm run release`.
const npmCheck = resolveNpmCheckInvocation({
	npmExecpath: process.env.npm_execpath,
	platform: process.platform,
	execPath: process.execPath,
});
run(npmCheck.command, npmCheck.args);
run("git", ["diff", "--check"]);

const stagePaths = [...new Set([...versionFiles, "CHANGELOG.md", "scripts/release.mjs", "scripts/lib/release-version.mjs", "scripts/lib/release-npm.mjs"])];
run("git", ["add", "--", ...stagePaths]);
run("git", ["commit", "-m", `chore(release): v${nextVersion}`]);
run("git", ["tag", "-a", `v${nextVersion}`, "-m", `Release v${nextVersion}`]);
if (push) run("git", ["push", "origin", "main", `v${nextVersion}`]);

console.log(`release: created v${nextVersion}${push ? " and pushed it" : " (not pushed; pass --push to push)"}`);
```

Run: `node scripts/smoke-release-npm.mjs`
Expected: `release npm invocation smoke ok`

- [ ] **Step 7: Document the new behavior**

`SECURITY.md` — replace line 11 (the paragraph starting `Where a compatible host loads the bundled PreToolUse hook, its tested blocking scope is narrow:`) with:

```markdown
Where a compatible host loads the bundled PreToolUse hook, Heli:

- **fails closed** — when the hook cannot evaluate a call (unreadable input, broken workspace state, an internal error) it denies the call and points to `heli doctor`, instead of crashing (hosts treat a crashed or timed-out hook as "allow"). PreToolUse hook timeouts are 30 seconds;
- **evaluates every command rule** — any T6 match is a hard deny that scoped grants, YOLO and `HELI_ALLOW_COMMAND` cannot override, and each matched T5 rule needs its own approval. A built-in T6 floor applies even when `safety/command-rules.json` is empty, and a missing or unreadable rules file denies shell commands until it is restored;
- **protects itself** — agent-run `heli grant issue`, `heli yolo on`, task takeovers, write transfers and Heli removal are hard-denied, and `heli grant issue` / `heli yolo on` refuse to run without an interactive terminal. Agents cannot write Heli's authority state (task, session, lock, binding, YOLO and workspace records, `~/.heli`, Heli-installed host hooks) or switch Claude Code hooks off;
- denies remote Git pushes, `.env`-style writes and writes while task state is stuck or target-mismatched unless a human approved them.

The command tiers in `.heli-harness/safety/command-tiers.md` remain the policy reference. Hooks are guardrails, **not a sandbox**: command parsing is best-effort, and an agent that can run arbitrary code (for example a script that calls Heli's library directly) can still work around them. Pair Heli with host permissions and an OS-level sandbox for untrusted work.

## Cloud Sync

Cloud sync is experimental and optional. Pulls refuse plaintext when end-to-end encryption is on, refuse rollbacks and relabeled bundles, and never apply `safety/`, `policies/` or task YOLO changes without `--accept-policy-changes`. See `docs/architecture/cloud-sync.md`.
```

`docs/ENFORCEMENT_MATRIX.md` — replace lines 16-17 (the `Scoped grants` and `T6 hard deny` rows) with:

```markdown
| Scoped grants | approvals bounded by action/resource/execution/time/use; project files cannot self-approve; issued only by a human at an interactive terminal; consumed only when the call is finally allowed | `heli grant issue|list|revoke` + evaluator | `smoke-scoped-grants`, `smoke-command-rules`, `smoke-self-protection` |
| T6 hard deny | every rule is evaluated; any T6 match wins over grants, YOLO and `HELI_ALLOW_COMMAND`; a non-removable built-in floor survives empty rules files; a missing/unreadable rules file denies shell commands | shared guard/evaluator | `smoke-command-rules`, quality guard + scoped-grant smokes |
| Fail-closed hooks | a hook that cannot evaluate a call denies it; the decision is emitted before audit side effects; 30 s PreToolUse timeouts | shared PreToolUse wrappers + host hook configs | `smoke-hook-fail-closed`, `smoke-hook-configs` |
| Heli self-protection | agents cannot issue grants, enable YOLO, take over or transfer write authority, remove Heli, write Heli authority state or disable Claude Code hooks | shared guard + CLI terminal gate | `smoke-self-protection` |
| Claude Code tool coverage | Bash, PowerShell, Monitor, Edit, Write, NotebookEdit and MCP tools reach the guard | Claude plugin PreToolUse matcher | `smoke-claude-windows-coverage` |
```

and after line 22 (the `Evidence portability` row) add:

```markdown
| Cloud sync integrity (experimental) | pulls refuse plaintext under E2E, rollbacks, relabeled ciphertext and unaccepted governance changes; activation needs an explicit confirmation | `heli pull`, `heli init`, sync API | `smoke-cloud-sync` |
```

`docs/ADAPTER_SUPPORT_MATRIX.md` line 48 — replace the whole line (it starts `**Claude Code.** Managed install resolves the plugin`) with:

```markdown
**Claude Code.** Managed install resolves the plugin from the globally installed Heli package. Direct project-local plugin installation is compatibility/dogfood only. The PreToolUse matcher covers `Bash`, `PowerShell` (the default shell on Windows, and the only shell there without Git Bash), `Monitor`, `Edit`, `Write`, `NotebookEdit` and every `mcp__*` tool; other built-in tools such as `Read`, `Glob` and `WebFetch` are not routed through Heli. Hooks fail closed and time out after 30 seconds.
```

`README.md` — in `## Scoped approvals` (lines 109-121) replace these three lines:

```markdown
Broad bypass is no longer the preferred temporary-approval path.

Example:
```

with:

```markdown
Broad bypass is no longer the preferred temporary-approval path. Approvals come from a **human**: `heli grant issue` and `heli yolo on` only run in an interactive terminal, and the Heli hooks hard-deny them when a coding agent tries to run them itself.

Example (run in your own terminal):
```

and replace `Grants are bounded by action/resource/execution and may also be bounded by host session, time, and usage count. T6 hard-deny rules remain non-grantable.` with `Grants are bounded by action/resource/execution and may also be bounded by host session, time, and usage count. Each matched T5 rule needs its own grant, and a grant is used up only when the call is finally allowed. T6 hard-deny rules — including Heli's built-in floor — remain non-grantable.`

`INSTALL.md` line 157 — replace the line `For actions that require temporary approval, prefer scoped grants:` with:

```markdown
For actions that require temporary approval, prefer scoped grants. A human issues them in an interactive terminal; Heli refuses `heli grant issue` without a TTY and its hooks deny it when an agent runs it:
```

`docs/architecture/governance-model.md` line 120 — replace `Hard-deny classes remain hard denies unless an explicitly different trusted policy contract says otherwise. Normal temporary grants do not bypass T6 hard-deny rules.` with:

```markdown
Hard-deny classes remain hard denies unless an explicitly different trusted policy contract says otherwise. Normal temporary grants do not bypass T6 hard-deny rules, and the kernel's built-in T6 floor cannot be removed by project rules.

Grants and YOLO are issued by a human at an interactive terminal. The governed agent cannot issue its own: the hooks hard-deny agent-run `heli grant issue` / `heli yolo on`, and the Heli state that encodes authority is not agent-writable.
```

`.heli-harness/safety/command-tiers.md` — insert before `## T0 - Read-only inspection`:

```markdown
## Built-in hard-deny floor

The kernel ships non-removable rules that apply even when this workspace's `command-rules.json` is empty. A project rule that reuses a built-in id is ignored, so a built-in can be neither removed nor weakened. Every rule is evaluated: any T6 match is a hard deny that scoped grants, YOLO and `HELI_ALLOW_COMMAND` cannot override, and each matched T5 rule needs its own approval.

- `destructive-delete` (T6): `rm` with recursive + force in any spelling (`-rf`, `-fr`, `-r -f`, `-Rf`, `--recursive --force`).
- `git-clean-force` (T6): `git clean` with `-f` plus `-d` and/or `-x` (dry runs excepted).
- `git-reset-hard` (T6): `git reset --hard`.
- `windows-rmdir` / `windows-del` (T6): `rd`/`rmdir` or `del`/`erase` with `/s`.
- `powershell-remove-item-recurse-force` (T6): `Remove-Item` (or an alias) with `-Recurse` and `-Force`, abbreviations included.
- `find-delete` (T6): `find ... -delete` without a name/path filter.
- `heli-privileged-command` / `heli-host-integration-removal` (T6): agent-run approvals, YOLO, takeovers, write transfers or removal of Heli; a human runs these in their own terminal.
- `git-push-force` (T5): `git push --force`, `-f`, `--force-with-lease` or a `+refspec`, on top of the `git.push` approval.

Commands are normalized before matching: quotes and escapes are removed, `git` global options (`-C`, `-c`, `--git-dir`, ...) are skipped, chains (`;`, `&&`, `||`, `|`, newlines) and subshells are split into segments, and `sh -c`, `bash -c`, `cmd /c`, `pwsh`/`powershell -Command` (and `-EncodedCommand`) payloads are evaluated too. A missing or unreadable `command-rules.json` in a Heli workspace denies shell commands until it is restored (`heli update` recreates it in an embedded workspace).

```

Run: `unset HELI_SESSION_ID; for t in validate-doc-currentness validate-release validate-integration-convergence smoke-claude-plugin smoke-codex-plugin verify-adapters smoke-release-npm; do node scripts/$t.mjs > /dev/null 2>&1 && echo "ok $t" || echo "FAIL $t"; done; git diff --check`
Expected: seven `ok ...` lines and no `git diff --check` output.

- [ ] **Step 8: Commit docs and release tooling**

```bash
git add scripts/validate-doc-currentness.mjs .heli-harness/safety/command-tiers.md docs/architecture/acp-governance-proxy.md docs/architecture/evidence-governed-autonomy.md docs/decisions/0002-portable-governance-kernel.md SECURITY.md docs/ENFORCEMENT_MATRIX.md docs/ADAPTER_SUPPORT_MATRIX.md README.md INSTALL.md docs/architecture/governance-model.md
git commit -m "docs: document Phase 0 hardening and check two-digit minor versions" -m "SECURITY, the enforcement and adapter matrices, README/INSTALL and command-tiers describe fail-closed hooks, the built-in T6 floor, self-protection, human-only grants and Claude Windows coverage. validate-doc-currentness now catches stale v0.10.x references, and the stale v0.10.1 mentions are fixed." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git add .github/workflows/release.yml scripts/release.mjs scripts/lib/release-version.mjs scripts/smoke-release-npm.mjs
git commit -m "fix: fail the release workflow when NPM_TOKEN is missing" -m "A missing token is now an error instead of a skipped publication. The release script bumps every current-facing version file (shared list in scripts/lib/release-version.mjs, guarded by a completeness test) and supports --prepare-only for in-PR bumps without check, commit or tag." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git status --short
```

Expected: `git status --short` prints nothing.

- [ ] **Step 9: Add the changelog entry and bump to 0.10.4 with the repo's release script (no tag)**

In `CHANGELOG.md`, insert directly after the first line (`# Changelog`) and its blank line:

```markdown
## Unreleased

### Security

- PreToolUse hooks fail closed: malformed or empty hook input, broken workspace state (for example an invalid `.heli/workspace.json`) and internal errors now produce a deny that points to `heli doctor`, instead of a crash the host treats as "allow". The decision is emitted before audit writes, so a failing audit write can no longer turn a deny into an allow.
- Every command rule is evaluated: any T6 match is a hard deny that scoped grants, YOLO and `HELI_ALLOW_COMMAND` cannot override, and each matched T5 rule needs its own approval. Grants are consumed only when the call is finally allowed.
- A built-in, non-removable T6 floor covers recursive forced deletes in any spelling (`rm -rf`/`-fr`/`-r -f`/`--recursive --force`, `rd /s`, `Remove-Item -Recurse -Force`), `git reset --hard`, `git clean -f` with `-d`/`-x` and unfiltered `find -delete`; `git push --force` needs its own `git-push-force` approval. Commands are normalized (quotes, escapes, `git -C/-c`, chains, `sh -c`/`bash -c`/`cmd /c`/`pwsh -Command` payloads) before matching. A missing or malformed `safety/command-rules.json` now denies shell commands instead of disabling every rule.
- Heli protects itself: agent-run `heli grant issue`, `heli yolo on`, task takeovers, write transfers, YOLO task/session flags and Heli removal are hard-denied; `heli grant issue` and `heli yolo on` require an interactive terminal; Heli authority state (task, session, lock, binding, YOLO and workspace records, `~/.heli`, Heli-installed host hooks) is not agent-writable under any path spelling, including `..`, casing, junction/symlink, alternate-data-stream and `\\?\` forms; settings that disable Claude Code hooks are denied; shell writes to `.env` files and protected paths are checked.
- Claude Code: the PreToolUse matcher covers `PowerShell` (the Windows default shell), `Monitor`, `NotebookEdit` and MCP tools, and the kernel recognizes PowerShell file-mutating cmdlets.
- Cloud sync (experimental): browser activation requires an explicit confirmation and binds the OAuth state to the confirming browser; pulls refuse plaintext when E2E is on, refuse rollbacks and relabeled ciphertext (bundles are bound to workspace id and version), and never apply `safety/`, `policies/` or task YOLO changes without `--accept-policy-changes`; `heli init --clone` rejects unsafe repo paths and remotes.

### Changed

- PreToolUse hook timeouts are 30 seconds for every host; the Codex Windows fallback denies when `node` is missing; the Claude plugin no longer declares the Codex-only `commandWindows` field.
- `current-task.md` `Mode: yolo` no longer enables YOLO; a human runs `heli yolo on` in their own terminal.
- `workspace/target.json` is protected state; use `heli target set <repo>`.
- Atomic state writes retry transient Windows sharing violations instead of deleting the target first.
- Legacy unbound E2E bundles (`aes-256-gcm-scrypt`) are refused; re-push them from an updated client.

### Fixed

- The test suite is hermetic: host lifecycle tests run against fake host CLIs in a temporary home, host CLI calls always receive the caller's environment, and grant lookups no longer create directories under the real `~/.heli`.
- The release workflow fails when `NPM_TOKEN` is missing instead of reporting success without publishing; the release script bumps every current-facing version file and supports `--prepare-only`.
- Documentation currentness checks now cover two-digit minor versions.

```

Run: `node scripts/release.mjs 0.10.4 "Phase 0 security hardening" --prepare-only`
Expected: `release: prepared v0.10.4 in 54 version files + CHANGELOG.md (not checked, committed or tagged)` (the count is the length of `releaseVersionFiles`; 54 at the time of writing). If it prints `unrelated dirty paths: ...`, commit or revert those first.

Run: `head -3 CHANGELOG.md; node -p "require('./package.json').version"; git tag --list v0.10.4`
Expected: `## v0.10.4 - Phase 0 security hardening` as the first heading, `0.10.4`, and no tag listed.

- [ ] **Step 10: Verify the bumped tree**

Run: `node scripts/sync-plugin-shared.mjs --check && node scripts/sync-plugin-skills.mjs --check && node scripts/sync-workspace-cli.mjs --check && node scripts/validate-release.mjs | tail -2 && node scripts/validate-doc-currentness.mjs | tail -1 && node scripts/smoke-release-npm.mjs`
Expected: the three `--check: ok` lines, `✅ Release validation PASSED`, `... scanned against v0.10.4`, `release npm invocation smoke ok`.

Run the full-chain runner from Global Constraints. Expected: `FAILED: ["node scripts/smoke-portable-targets.mjs"]`.

- [ ] **Step 11: Commit the release bump (never tag, never push)**

```bash
git add -u
git status --short
git commit -m "chore(release): v0.10.4" -m "Phase 0 security hardening. Version metadata bumped with scripts/release.mjs --prepare-only; tagging and npm publication are left to the release workflow on main." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git tag --list v0.10.4
```

Expected: `git status --short` shows only modified (`M`) tracked files before the commit; `git tag --list v0.10.4` prints nothing.

---

### Task 8: Integration check

**Files:**
- None created; fixes only if a check fails.

**Interfaces:**
- Consumes: everything from Tasks 1–7.
- Produces: a branch that passes every check except the known local EPERM, with no stray changes.

- [ ] **Step 1: Generated copies are in sync**

Run: `node scripts/sync-plugin-shared.mjs --check && node scripts/sync-plugin-skills.mjs --check && node scripts/sync-workspace-cli.mjs --check`
Expected: `sync-plugin-shared --check: ok`, `sync-plugin-skills --check: ok (30 skills)`, `sync-workspace-cli --check: ok`

- [ ] **Step 2: Full suite (now hermetic)**

Record the real grant-store size first: `ls ~/.heli/grants/workspaces 2>/dev/null | wc -l`

Run the full-chain runner from Global Constraints (600000 ms timeout).
Expected: `FAILED: ["node scripts/smoke-portable-targets.mjs"]` (only the EPERM symlink test; on a machine that can create symlinks, `FAILED: []`), exit 0.

Run again: `ls ~/.heli/grants/workspaces 2>/dev/null | wc -l`
Expected: the same number as before (hook evaluations no longer create grant-store directories). If it grew, a test is still reaching the real grant store: find the newest entry (`ls -t ~/.heli/grants/workspaces | head -3`), identify the test that created it, and give that test its own `HELI_CONFIG_DIR`/`HELI_DATA_DIR` like `smoke-scoped-grants.mjs` does.

- [ ] **Step 3: Review the branch diff for stray changes**

Run: `git status --short; git log --oneline main..HEAD; git diff --stat main...HEAD | tail -5; git diff --check main...HEAD`
Expected: clean status; the commits from Tasks 1–7 on top of the two commits this branch already had before Phase 0 (`af9e701 fix: install Claude host plugin through packaged marketplace`, `a80aff2 docs: add 2026-09-30 full review report`); no `git diff --check` output.

Run: `git diff --name-only main...HEAD | grep -v -E '^(\.heli-harness/|lib/|bin/|cloud/|scripts/|docs/|\.github/workflows/release\.yml$|package\.json$|manifest\.json$|README\.md$|INSTALL\.md$|ROADMAP\.md$|SECURITY\.md$|CHANGELOG\.md$)'`
Expected: no output. Then eyeball `git diff --name-only main...HEAD` for anything unexpected: no `.test-antigravity-plugins/`, no scratch or temp files, no files under `.heli-harness/tasks|sessions|locks|bindings`, no generated `shared/` or `.heli-harness/cli/` file without its canonical source change.

- [ ] **Step 4: Confirm nothing was tagged or pushed**

Run: `git tag --list 'v0.10.4'; git status -sb | head -1`
Expected: no tag; the branch line shows `hardening/phase-0` with no upstream push performed by this plan.
