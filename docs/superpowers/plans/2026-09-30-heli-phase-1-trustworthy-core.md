# Heli-Harness Phase 1 — Trustworthy Core Implementation Plan

> **For agentic workers:** this is a task-level plan. Before executing a task, expand it into bite-sized TDD steps against the then-current code with superpowers:writing-plans, then execute with superpowers:subagent-driven-development (or superpowers:executing-plans). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every host use one evaluator, close the known parser and authority gaps, make evidence tamper-evident, make host status truthful, and put the test suite on `node --test` — taking Heli from "hardened guardrail" to a core that can be trusted on its own terms.

**Architecture:** All decisions keep flowing through the shared kernel `.heli-harness/adapters/shared/` (`hook-core.mjs#evaluatePreToolUse`, `command-policy.mjs`, `concurrency/*`). Hosts (including Pi and the ACP proxy) become thin translators into that evaluator. Host lifecycle state is read from the hosts themselves, not from Heli's receipts.

**Tech Stack:** Node.js ≥20 ES modules, zero npm dependencies, `node:test` for new tests, GitHub Actions (Ubuntu + Windows).

**Spec:** `docs/reports/2026-09-30-heli-full-review.md` (Improvement plan → Phase 1; findings 7–10, 13–15) plus the deferred items recorded while executing Phase 0 (listed per task below).

## Prerequisite — finish Phase 0 first

Phase 0 (`docs/superpowers/plans/2026-09-30-heli-phase-0-hardening.md`, branch `hardening/phase-0`) stopped with Tasks 1–6 implemented. Before starting Phase 1:

- [ ] Re-review Task 6 fix round 2 (commits `1bbfa04..d857a67`; the review was stopped mid-run).
- [ ] Execute Phase 0 Task 7 (release hygiene, docs truth, patch-release bump via `release.mjs --prepare-only`). Carry these into its docs work, which the Phase 0 plan text predates:
  - the Claude matcher is `^(Bash|PowerShell|Monitor|Edit|MultiEdit|Write|NotebookEdit)$|^mcp__`; the Claude entry in `.heli-harness/adapters/adapters.json` is stale;
  - accepting synced governance changes (`--accept-policy-changes`) is human-only, like `heli grant issue` / `heli yolo on`;
  - on pull, `tasks/*/diagnosis.json`, `tasks/*/events.jsonl`, `workspace/schema.json` and `workspace/index.json` count as governance;
  - Git Bash (mintty) is not a TTY for Node: use Windows Terminal/PowerShell or `winpty` for the human-only commands;
  - document the new deny codes (`COMMAND_TOO_COMPLEX`, `COMMAND_UNPARSEABLE`, `MCP_INPUT_TOO_COMPLEX`, `HELI_STATE_PROTECTED`, `HELI_HOOKS_PROTECTED`).
- [ ] Execute Phase 0 Task 8 (integration check) and the final whole-branch review, pointing the reviewer at the deferred items below.

## Global Constraints

- Zero npm dependencies; `node:` imports only; tabs, double quotes, semicolons.
- Edit canonical sources only (`.heli-harness/adapters/shared/**`, `bin/heli.mjs`, `lib/cli/**`, `lib/protocol/**`, `.heli-harness/skills/**`) and regenerate with `node scripts/sync-plugin-shared.mjs`, `node scripts/sync-workspace-cli.mjs`, `node scripts/sync-plugin-skills.mjs`; every commit passes all three `--check`s.
- Tests are hermetic: host-lifecycle tests use `scripts/lib/hermetic-env.mjs`; nothing touches the real home directory or real host CLIs.
- Every new deny path fails closed and keeps the deny-reason contracts established in Phase 0.
- Heli is a guardrail, not a sandbox: docs claim only what tests prove.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. The same tool call must get the same decision through every host wrapper (Claude/Codex/Kimi, Grok, OpenCode, Pi, ACP) — pinned by the Task 1 parity suite.
2. Legitimate everyday commands stay allowed after parser changes (commit messages, heredoc prose, `find -name … -delete`, `rm -f build.log`, `Remove-Item file.txt`) — every parser task re-runs the Phase 0 false-positive corpus.
3. Two sessions can never both hold write authority for one worktree, in embedded or linked mode, including after a crash.
4. Status output matches what the host would actually load (version and source), never Heli's own receipt alone.
5. Every task keeps the Phase 0 analysis-time guarantee (worst in-budget input well under the 30 s hook timeout).

---

### Task 1: One evaluator for every host

**Files:** `extensions/pi-extension.js`, `extensions/pi-governed.js`, `lib/acp/proxy.mjs`, `bin/heli-acp-proxy.mjs`, new `scripts/smoke-host-parity.mjs`.

- [ ] Replace Pi's own guard (`pi-extension.js` ~:1584-1713, duplicate rule table ~:220-239, YOLO checked before hard-deny ~:1619) with calls to `evaluatePreToolUse`, passing Pi's own session id (`pi-governed.js` ~:69-72 currently ignores it). Keep Pi's confirmation prompt only for T5 approvals; T6 is never click-through.
- [ ] ACP proxy: govern `fs/write_text_file` and `terminal/create` as well as `session/request_permission`; map only `execute` to a shell tool, other kinds to structured file tools (deferred: non-execute kinds currently skip command analysis); expose `heli-acp-proxy` in `package.json` `bin` or document it as experimental-only.
- [ ] Parity suite: one table of payloads (T6 command, T5 push with/without grant, protected-state write, `.env` write, healthy edit, PowerShell push, MCP write) run through every wrapper; decisions and deny codes must match.
- Acceptance: parity suite green on Windows and Ubuntu; Pi YOLO no longer allows `rm -rf src`.

### Task 2: Close the recorded parser gaps

**Files:** `.heli-harness/adapters/shared/command-policy.mjs`, `shell-comments.mjs`, `hook-core.mjs`, `scripts/smoke-command-rules.mjs`, `scripts/smoke-command-comments.mjs`.

Absorbs Phase 0 deferrals:
- [ ] `$(...)` inside double quotes; PowerShell parentheses and script blocks splitting flags into another segment; `find -delete` before a name filter.
- [ ] Interpreters (`python -c`, `node -e`, `perl -e`, `ruby -e`, `php -r`, `pwsh -EncodedCommand`) and `echo … | sh`: classify as opaque → require approval (T5-style ask) instead of silently allowing.
- [ ] Quoted command lines whose command is not the first word (`ssh host 'cd x && rm -rf y'`), `sudo` with value options (`sudo -u root rm …`), capitalized first word, heredoc prose lines quoting a rule phrase.
- [ ] `description` fallback: analyze `description` only for shell tools that lack `command`; never for other tools.
- [ ] A patch applied through a shell tool (heredoc into `apply_patch`) is not analyzed as a command.
- [ ] Comments: strip inside `$(...)` and heredoc bodies where the shell ignores them; decide unknown-shell behavior; verify zsh.
- [ ] `cd` into a missing directory is a no-op for the tracked base (closes `cd nope; cd .heli-harness/state; echo x > yolo.json`).
- [ ] Wildcards, `curl -O`, `patch`, PowerShell .NET file APIs (`[IO.File]::WriteAllText`), `Invoke-Expression`, `Start-Process`, variable-built paths: document or treat as opaque writes.
- [ ] `isLikelyShellMutation` must not match cmdlet names in arguments (`Get-Help Tee-Object`).
- [ ] Rule self-tests: every rule in the built-in floor and `command-rules.json` carries `match` / `notMatch` examples validated in CI (Codex-style).
- Acceptance: all new cases pinned; the Phase 0 differential checks against real bash/PowerShell still report 0 misses; the Phase 0 false-positive corpus shows no new flags.

### Task 3: Authority correctness

**Files:** `concurrency/lease.mjs`, `concurrency/resolve.mjs`, `concurrency/resource-authority.mjs`, `concurrency/fs-atomic.mjs`, `concurrency/session.mjs`, `lib/cli/task.mjs`, `lib/cli/session-cmd.mjs`.

- [ ] Embedded mode: lock per worktree, not per task (`lease.mjs:194` checks, `:214` locks a task folder → 29/30 double leases in race tests).
- [ ] Linked mode: apply session mode and delegation checks (`resolve.mjs:298-318` returns before `:339-370`).
- [ ] Stale lock recovery for `claimDirExclusive` (`fs-atomic.mjs:90`): owner pid + age, safe takeover, test with a killed holder.
- [ ] Session index by host session id and pruning of idle sessions (`resolve.mjs:140` reads every session file: 8.7 s at 2k sessions).
- [ ] `--session <other-id>` impersonation in `task release`/`task complete`/`session close`.
- Acceptance: two-process race tests (embedded and linked, 100 trials) show 0 double writers; killed-holder recovery test; 20k-session resolve under 200 ms.

### Task 4: Tamper-evident evidence

**Files:** `concurrency/governance-decision.mjs`, `concurrency/events.mjs`, `lib/cli/explain.mjs`, `lib/cli/trace.mjs`, new export module.

- [ ] Record allow decisions (including grant- and YOLO-based allows), not just denials.
- [ ] Hash-chain receipts (each record carries the previous record's hash); `heli explain`/`trace` verify the chain and report breaks. Document that a chain detects edits but an agent with file access can still truncate — pair with the Phase 2 sandbox work.
- [ ] Optional OpenTelemetry export (`execute_tool` spans mirroring Claude's `tool_decision`).
- Acceptance: editing or deleting any past receipt is reported by `heli trace verify`.

### Task 5: Truthful host status and lifecycle

**Files:** `lib/cli/host.mjs`, `.heli-harness/adapters/kimi-plugin/install-user-hooks.mjs`, `grok-plugin/install-user-hooks.mjs`, `lib/cli/install.mjs`, docs.

- [ ] Read state from the hosts: `codex plugin list --json` (version, source, hook trust), `pi list` (user scope only), `grok plugin details heli-harness`, Kimi config parse; judge install/remove success by before/after state, not output regexes (`/already|…installed/` also matches "not installed").
- [ ] Codex: pin the marketplace to `--ref v<version>`, run `codex plugin marketplace upgrade` on update, show "installed but untrusted".
- [ ] Kimi: TOML-escape paths (an `'` corrupts `config.toml`), refresh the block when the marker exists (old 10 s timeouts persist), handle a missing end marker safely.
- [ ] Fix `heli host remove pi` (Pi treats `heli-harness` as a path); verify AXGA.
- [ ] Distinct names for embedded vs global marketplaces (PR #29 follow-up: both are called `heli-harness`).
- [ ] Windows: spawn without `shell: true` (a folder named `x&calc&` runs calc), add timeouts to host CLI calls.
- [ ] UX: `host install` defaults to detected hosts and exits 0 when hosts are simply absent; `host remove` requires an explicit host; usage errors exit 2, `--help` exits 0; one JSON envelope shape.
- [ ] Host drift from the Phase 0 research: Grok compat double-firing (`[compat.*] hooks=false`), Kimi SessionStart output ignored, OpenCode v2 plugin API, Antigravity real payload field names.
- Acceptance: status for every host matches a fixture of the host's own `--json`/list output; the review machine scenario (Grok running an old plugin from another project) reports `stale`.

### Task 6: Tests on `node --test` with coverage

**Files:** `package.json`, `scripts/**`, `.github/workflows/ci.yml`, `scripts/lib/hermetic-env.mjs`, `scripts/lib/fake-host-cli.mjs`.

- [ ] Migrate the `&&` chain to `node --test` (parallel, isolated failures); keep `npm run check` as the entry point.
- [ ] Coverage floor on `resolve.mjs`, `lease.mjs`, `resource-authority.mjs`, `grant.mjs`, `command-policy.mjs`, `protected-paths.mjs`.
- [ ] Hermetic-helper follow-ups: make `smoke-claude-plugin.mjs:201` hermetic (temp `CLAUDE_CONFIG_DIR`; note `.cmd` shims need `shell: true`), derive `FAKE_HOST_NAMES` from an exported `HOSTS`, `cleanup()` with retries, full restore in `applyToProcess()`, `smoke-convergence-authority` via `createHermeticEnv().applyToProcess()`, fake CLI flush-before-exit, tests for `setResponse`/stderr responses.
- [ ] Split `smoke-self-protection.mjs` (~1,300 lines) by concern.
- [ ] CI: add Node 24, `engines` field, pin Actions by commit SHA; record live-verify runs as artifacts.
- Acceptance: suite runs in parallel under 3 minutes locally; coverage floor enforced in CI.

### Task 7: Fail-closed residuals

**Files:** `.heli-harness/adapters/shared/claude-style-pre-tool-use.mjs`, `grok-style-pre-tool-use.mjs`, host hook configs.

- [ ] Deny when `node` is missing on POSIX (Claude/Codex command wrapper), stdin read timeout → deny, falsy evaluator result → deny, write the deny before stderr.
- [ ] Consolidate the ~60 duplicated wrapper lines without breaking plugin-cache self-containment.
- [ ] Test gaps from Phase 0: Grok `decision`/`reason` in assertions, `observeRuntimeCapability` throwing, direct wrapper import guard, spawn timeouts in tests.

### Task 8: Cloud residuals

**Files:** `lib/cli/cloud.mjs`, `lib/cli/cloud-bundle.mjs`, `docs/architecture/cloud-sync.md`.

- [ ] Compare only behavior fields of `workspace/schema.json` (ignore `updatedAt`) so a first pull onto a fresh install doesn't need `--accept-policy-changes`.
- [ ] Baseline for a fresh `heli init` (E2E and version).
- [ ] Document that a flag built at runtime passes the hook and is stopped by the CLI human gate.
