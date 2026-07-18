# Changelog

## Unreleased

### Added

- README **Start with Heli** guide: parent workspace layout (`repos/`, `docs/`, `resources/`), npx install, Codex plugin, strict YOLO default, target/profile setup, and first-session open prompt.

### Changed

- **New installs default to concurrent mode** (`workspace/schema.json` `"mode": "concurrent"`). Zero tasks = single-agent bootstrap (writes allowed); once any task exists, full session/lease ownership applies. `heli update` still does not flip existing legacy workspaces.

## v0.5.26 - Ops honesty and concurrent hygiene

### Added

- **Ops honesty & concurrent hygiene**
  - Templates: Resume card + Command friction on `current-task.md`; plan Active strategy / Evidence hygiene; `ops-gate-packet.md`; `windows-shell-recipes.md`
  - Skill `concurrent-upgrade` for legacy to concurrent migration after `heli update`
  - SessionStart: governance enforcement honesty, legacy multi-agent race warning, concurrent unbound write denial messaging
  - `heli status` / `heli update`: legacy multi-writer risk + migrate path (update does not flip mode)
  - Skills: `verify-premise` (e2e contract + ACTION_UNSUPPORTED), `impact` (destructive multi-path checklist), `fix-loop` (friction vs implementation failures)

### Changed

- HARNESS.md: plan/task freshness, evidence purity, resume/gate packet, legacy vs concurrent upgrade truth, command-friction vs failed attempts
- Codex adapter: Windows/shell recipes pointer

## v0.5.25 - Codex Git marketplace and update host refresh

### Added

- **Codex Git marketplace (Ponytail parity):** repo-root `.agents/plugins/marketplace.json` indexes `./.heli-harness/adapters/codex-plugin`, so `codex plugin marketplace add KJ-AIML/heli-harness` works and `codex plugin marketplace upgrade heli-harness` can refresh a Git marketplace snapshot (local nested path remains available for workspace dogfood only).

### Changed

- `heli update` / `update.sh` / `update.ps1` now print host plugin refresh commands after a workspace update, including `codex plugin marketplace upgrade heli-harness` for the Git marketplace and a one-time local-to-Git switch sequence.
- INSTALL / INSTALL_MATRIX document workspace update vs Codex marketplace upgrade as separate steps.
- `scripts/smoke-pack-artifact.mjs` asserts the packed version dynamically against `package.json` (no hardcoded version) and requires the root Codex marketplace manifest in the tarball.

### Fixed

- Codex install docs and `heli install` post-install hints no longer recommend bare `.heli-harness/adapters/codex-plugin` as a marketplace source — Codex rejects that form (`invalid marketplace source format`). Use `KJ-AIML/heli-harness` (Git) or `./.heli-harness/adapters/codex-plugin` / an absolute path (local).
- `scripts/live-verify-codex-plugin-install.mjs` now proves repo-root marketplace install, nested dogfood install, and bare-path rejection against the real Codex CLI.

## v0.5.24 - Concurrent Session Foundation

### Added

- **Concurrent Session Foundation** for multi-session local coordination without becoming an agent orchestrator:
  - Durable tasks under `.heli-harness/tasks/<task-id>/` (`task.json`, task-local plan/decisions/reports/evidence/events)
  - Heli-generated sessions under `.heli-harness/sessions/<session-id>.json` with optional `externalHostSessionId`
  - Worktree bindings under `.heli-harness/bindings/worktrees/`
  - Single-writer task leases via exclusive lock directories `locks/tasks/<task-id>.write.lock/`
  - Shared execution resolver used by Claude, Codex, Grok, Kimi, OpenCode, Antigravity hooks and Pi
  - Workspace schema `.heli-harness/workspace/schema.json` with `mode: legacy | concurrent`
  - CLI: `heli task`, `heli session`, `heli conflicts`
  - Task-scoped YOLO (global `yolo.json` does not bleed across tasks in concurrent mode)
  - Task-authoritative targets in concurrent mode
  - Duplicate work-item detection on task create
  - Advisory path-claim conflict detection
  - `heli task migrate-legacy` one-way import from singular state files
  - Regression suite: `node scripts/smoke-concurrency-foundation.mjs` (included in `npm run check`)
  - Canonical clean-install seed: `lib/cli/seed-workspace.mjs` (distribution assets only + explicit idle operational seed)
  - Pollution-proof install smokes: `scripts/smoke-clean-install.mjs`
  - Status worktree projection smokes: `scripts/smoke-status-worktree.mjs`
  - Live concurrent host proofs (not in `npm run check`): `scripts/live-verify-codex-concurrency.mjs`, `scripts/live-verify-claude-concurrency.mjs`
  - Plugin-local `shared/` copies for host cache installs + `scripts/sync-plugin-shared.mjs`
  - **Full host-native skill library packaging:** canonical `.heli-harness/skills/` (including `using-heli-skills` meta-skill + governance trio) is mirrored into Codex, Claude, Grok, Antigravity, and Cursor plugin `skills/` trees
  - `scripts/sync-plugin-skills.mjs` + `npm run sync:plugin-skills` / `--check` for frontmatter validation and plugin parity
  - Compact SessionStart **skill-usage bootstrap** (distinct from task/session/lease governance context)
  - `scripts/smoke-plugin-skills.mjs` packaging/discovery smoke (in `npm run check`)

### Changed

- `heli status` reports concurrent multi-task summaries when schema mode is concurrent, projecting **live** worktree from write lease â†’ writer session â†’ binding â†’ task metadata (with conflict warnings).
- `heli status` reports skill packaging counts and **host activation not verifiable** (file presence â‰  live activation).
- `heli install` / `install.sh` / `install.ps1` / Pi `/heli-install` all use one clean seed path â€” never copy package checkout dogfood (tasks, sessions, live current-task, YOLO, selected target).
- `heli install` stdout clearly separates workspace governance install from host plugin activation commands for native skills.
- `heli update` updates distribution assets only; preserves user tasks/sessions/bindings/locks/state/targets/YOLO; `--reset-state` reseeds idle operational state without importing package dogfood.
- Plugin hooks import embedded `../shared/` so Codex marketplace cache and Claude `--plugin-dir` copies are self-contained.
- Skill frontmatter standardized to unique hyphenated names and â€œUse whenâ€¦â€ trigger descriptions for host semantic discovery.
- `HARNESS.md` Skill Routing updated for full plugin skill inventory + `using-heli-skills` protocol.

### Fixed

- Clean installs no longer inherit operational state from a dogfooded source package tree.
- **Published tarball is free of operational dogfood:** package seeds ship idle `current-task.md`, empty `target.json`/`index.json`, no `plan.md`/`yolo.json`, and `.npmignore` excludes `sessions/`/`tasks/`/`bindings/`/`locks/`. Plugin SessionStart smokes no longer mint sessions into the package checkout (fixture cwd). Guard: `scripts/smoke-pack-artifact.mjs` in `npm run check`.
- Codex/Claude plugin packages no longer fail hook module resolution when hosts cache only the plugin directory (missing sibling `adapters/shared`).
- UTF-8 BOM stripped from packaged skill frontmatter so Codex can parse `SKILL.md`.
- Host plugins no longer ship only the three wrapper skills; the complete intended Heli skill library is packaged for native discovery when the host plugin is activated.

### Notes

- Local workspace coordination only â€” not a distributed lock service, scheduler, agent runtime, or merge orchestrator.
- YOLO never bypasses ownership, lease, or wrong-task gates.
- Legacy singular `state/current-task.md` workspaces continue to work until concurrent mode is initialized.
- Workspace install and host plugin activation remain separate: `heli install` alone does not register host-native skills.
- Live v0.5.24 plugin runtime proof (this release): **Codex** isolated `CODEX_HOME` + real `codex exec` â€” marketplace install, SessionStart Completed, PreToolUse denials for `git push` and `.env` honored. Claude Code SessionStart + concurrent context proven via `--plugin-dir`; full Claude PreToolUse enforcement requires a working host API key on the verification machine.
- After editing `adapters/shared`, run `npm run sync:plugin-shared` before commit.
- After editing `.heli-harness/skills/`, run `npm run sync:plugin-skills` before commit.

## v0.5.23 - Cursor Marketplace and OpenCode Discovery


### Added

- Installable Cursor marketplace layout with `.cursor-plugin/marketplace.json` and a nested Heli-Harness plugin package.
- Cursor marketplace smoke validation covering the marketplace manifest, plugin manifest, rule, and skills.

### Fixed

- OpenCode installation guidance now uses automatic project/global plugin discovery from `.opencode/plugins/` and `~/.config/opencode/plugins/`.
- Cursor and OpenCode adapter documentation and support metadata now match their host layouts.

## v0.5.22 - YOLO / unguarded mode (opt-in)

### Added

- **YOLO / unguarded mode** (opt-in only): skip Heli PreToolUse blocks for remote git write, `.env`-style secrets, and stuck-task gates when the user explicitly enables it.
  - `heli yolo on|off|status [path] [--hours N]`
  - Env: `HELI_YOLO=1` or `HELI_GUARDS=off`
  - File: `.heli-harness/state/yolo.json` `{ "enabled": true }`
  - Task: `Mode: yolo` (or `unguarded` / `dangerous`)
  - Granular: `HELI_ALLOW_GIT_PUSH=1`, `HELI_ALLOW_ENV_WRITE=1`
  - Wired across Claude/Codex/Grok/Kimi/OpenCode hooks + Pi `tool_call` guard
  - Docs: `.heli-harness/safety/yolo-mode.md`
  - Smoke: `node scripts/smoke-yolo-mode.mjs`
- Default remains **strict**. YOLO never turns on by itself.

### Notes

- YOLO is not a host sandbox bypass. It only disables Heli's own guard denials.
- Use for large autonomous workflows that intentionally need remote push or secret-file writes; turn off when finished.

## v0.5.21 - Multi-Host Adapters (Grok / OpenCode / Kimi / Antigravity)

### Added

- First-class adapters for **Grok Build**, **OpenCode**, **Kimi Code CLI**, and **Antigravity CLI**:
  - Pointer + plugin/hooks packs under `.heli-harness/adapters/{grok,opencode,kimi,antigravity}(-plugin)/`
  - One-command installers: `grok-plugin/install-user-hooks.mjs`, `kimi-plugin/install-user-hooks.mjs`
  - Synthetic smokes + live-verify scripts for Grok/OpenCode/Kimi
  - Adversarial strictness suite: `node scripts/quality-guard-strictness.mjs`
- **Grok (`enforced`)**: live `grok -p` PreToolUse deny of `git push` via user hooks (`~/.grok/hooks/heli-harness.json`). Valid `grok plugin validate/install` for skills. Important: Grok 0.2.x does not execute plugin-inventory hooks at runtime â€” user hooks are required.
- **OpenCode (`enforced`)**: self-contained `heli-harness.mjs`; live `opencode run` loads plugin and blocks git push. Register in `opencode.json` `plugin` array.
- **Kimi (`enforced`)**: live `kimi -p` prints Heli git-push denial after `install-user-hooks.mjs` + valid `kimi doctor config`.
- **Antigravity (`verified-plugin-wired`)**: artifacts + synthetic smokes only (no live `agy` on verification host).

### Fixed

- Grok `plugin.json` now uses Claude/Grok-compatible `author` object + `.claude-plugin` / `.grok-plugin` layouts (previous root manifest failed `grok plugin validate`).
- Kimi TOML hook examples use single-quoted command strings (Windows path-safe).
- Docs: INSTALL.md / INSTALL_MATRIX / ADAPTER_SUPPORT_MATRIX / README aligned with proven status (Claude/Codex rows no longer stuck on stale `verified-plugin-wired` in INSTALL_MATRIX).

### Notes

- Live-verify scripts require the host CLI + credentials and are **not** part of `npm run check`.
- Guards are pattern-based PreToolUse/plugin hooks, not a sandbox: install hooks correctly, and know obfuscation gaps remain.


## v0.5.20 - `heli target` Path Argument Fix

### Fixed

- `heli target list|show|set|clear` previously always operated on `process.cwd()` and silently ignored any path argument, unlike `heli status`'s existing `args[0] || process.cwd()` support for the same kind of override. Pointing the CLI at a different workspace (e.g. `heli target list /some/other/workspace`) silently returned the caller's own current-directory data instead of erroring, warning, or reading the given path â€” a silent-wrong-answer footgun, not just an inconsistency. Found via real `npx`-distributed dogfooding against a workspace other than the shell's cwd.
- `runTarget()` now threads an optional trailing path argument through all four subcommands (`list [path]`, `show [path]`, `set <repo> [--confirm] [path]`, `clear [path]`), matching `status.mjs`'s pattern exactly. No-path invocations (the overwhelmingly common case) are byte-for-byte unchanged.

### Notes

- The underlying pure functions (`listRepos`/`showTarget`/`setTarget`/`clearTarget`) were never the problem â€” they already took `cwd` as an explicit parameter and never read `process.cwd()` themselves, per the CLI's Global Constraint. Only the CLI-facing `runTarget` wrapper had never threaded a path through to begin with.
- New regression coverage spawns the real `bin/heli.mjs` as a subprocess from one temp directory while passing a second, differently-seeded temp directory as the explicit path argument â€” proving the path argument, not `process.cwd()`, is honored, for all four subcommands. This is currently the only test in the suite that exercises a `run*()` wrapper's argv/path handling end-to-end; `smoke-cli-{install,update,uninstall,status}.mjs` still only test their underlying pure functions directly, and `smoke-cli-entry.mjs`'s subprocess test only checks generic label presence, not path-correctness. Same root-cause class as the `bin/heli.mjs` coverage gap fixed in v0.5.19 â€” noted as a follow-up, not fixed here.

## v0.5.19 - Standalone `heli` CLI

### Added

- New standalone `heli` CLI (`bin/heli.mjs` + `lib/cli/{install,update,uninstall,target,status}.mjs`), distributed via `npx github:KJ-AIML/heli-harness <command> <path>` â€” no npm registry publish, no new dependencies, hand-rolled argv dispatch. Covers `install`, `update` (with `--reset-state`), `uninstall`, `target list|show|set|clear` (`set` gates on `--confirm` when switching an already-selected target, replacing the skill's conversational confirmation step), and a new read-only `status` command with no prior equivalent.
- This is the one real, tested implementation each surface now points at, replacing what were previously N independently drifting copies of the same install/update logic: Pi/AXGA's extension (which had install but, until now, no update command at all), Claude/Codex's prose skills (manual steps for an agent to replicate by hand), and the raw `.ps1`/`.sh` scripts.
- `extensions/pi-extension.js`'s `/heli-install` now calls the CLI's `install()` directly instead of shelling out to `install.ps1`/`.sh`; a new `/heli-update` command (`/hh-update` alias) calls `update()` the same way, closing the "Pi has no update command" gap.
- Both `heli-install`/`heli-target` skill pairs (Claude, Codex plugins), `README.md`, and `INSTALL.md` document the CLI as the preferred method, keeping the existing manual/script-based instructions as the documented fallback for Node-less environments.
- Subprocess-level smoke test (`scripts/smoke-cli-entry.mjs`) spawns the real `bin/heli.mjs` binary to prove its argv dispatch and self-location (`fileURLToPath(import.meta.url)`) work end-to-end, distinct from the 5 module-level smoke tests which exercise `lib/cli/*.mjs` directly; `bin/heli.mjs` is now covered by `node --check` in the `check` script.

### Fixed

- `install()`/`update()` now guard against a self-collision case (the package root and the install target resolving to the same directory â€” e.g. running the CLI from inside a local heli-harness checkout as its own target) with a clear, specific error instead of letting Node's raw `fs.cpSync` `ERR_FS_CP_EINVAL` surface.

### Notes

- Distribution is git-URL/npx only, deliberately not published to the npm registry, to avoid the ongoing maintenance cost of npm publishing (account, 2FA, a publish step every release).
- Every low-level `lib/cli/*.mjs` function takes explicit paths and never reads `process.cwd()` internally â€” only the `run*(packageRoot, args)`/`run*(args)` CLI-facing wrappers touch argv/cwd defaults. `extensions/pi-extension.js` importing directly from `../lib/cli/*.mjs` is a deliberate exception to this codebase's usual small-duplicated-pure-function convention, since both live in the same repo checkout Pi loads directly.
- Existing `.ps1`/`.sh` scripts are completely untouched and remain the documented fallback; this release is purely additive.
- A pre-existing, out-of-scope gap found during this work: Pi's `/heli-target set` handler still overwrites `target.json` unconditionally with no mismatch confirmation, unlike this new CLI's `--confirm` gate and the documented Claude/Codex skill behavior â€” tracked as a separate future follow-up, not fixed here.

## v0.5.18 - Skill Discipline & Step-Count Warning

### Added

- `current-task.md` gains a self-reported `Step count: N` field, mirroring `Failed attempts count`. Session-start context (Claude-plugin, Codex-plugin, Pi/AXGA) now warns â€” not a blocking gate â€” when `Step count` is 3+ but `Plan:` is still `n/a`: the exact case where a task obviously needed a `plan.md` and never got one, previously invisible everywhere in the system.
- `claude/CLAUDE.md` and `codex/AGENTS.md`'s enforcement self-check now also states the inference that `PreToolUse` is equally wired whenever the `SessionStart` marker fired, since a plugin's hooks load atomically from the same manifest â€” never having triggered a deny condition isn't evidence the blocking side is inactive.

### Changed

- `HARNESS.md`'s Skill Routing section rewritten with mandatory-invocation framing and a Red Flags rationalization table (borrowed from superpowers' `using-superpowers` skill), and now states explicitly that reading a `.heli-harness/skills/*/SKILL.md` file directly is the correct mechanism on Claude/Codex plugin installs â€” not a fallback â€” since those adapters never expose the shared skills directory as native Skill-tool entries.
- `state/README.md` gains a dedup nudge: cross-reference one canonical location for repeated verification facts (test counts, version numbers) instead of hand-retyping them across `current-task.md`/`plan.md`/`decisions.md`.

### Notes

- All four changes came from evidence-based feedback on two independent real projects using Heli-Harness. The skill-routing gap was found twice, independently, by two unrelated sessions â€” strong enough signal to fix immediately rather than continue deferring it.
- The `Step count`/`Plan` warning is deliberately a warning, not a `PreToolUse` deny: it's a new, self-reported field with no track record yet, and a false-positive block would cost more than the gap it closes. `readPlanGate()`'s existing `if (!existsSync(planPath)) return null` (matching `decisions.md`'s own nothing-if-missing precedent) is unchanged â€” this is additive context, not a new gate.
- Implemented directly rather than through the worktree/subagent-driven-development pipeline used for v0.5.17: no new state file, no `PreToolUse` changes, just an addition to the existing session-start injection â€” meaningfully lower-stakes than the plan-ledger feature itself.

## v0.5.17 - Cross-CLI Plan Ledger

### Added

- New optional state file `.heli-harness/state/plan.md` (template at `.heli-harness/templates/plan.md`): a self-contained, step-by-step plan ledger using `## Step N: <title>` sections with `Files:`/`Verify:`/`Status:`/`Evidence:`/`Attempts:` fields, so a multi-step task can be handed off between CLIs (e.g. a quota-driven Codex-to-Claude switch mid-plan) with each step carrying verifiable evidence and a failed-attempts count, not just a bare checkbox.
- All three adapters (Claude Code plugin, Codex plugin, Pi/AXGA extension) now surface a compact rollup of `plan.md` (title, "N/M steps complete", current step's title/status/attempts) in session-start context when the file is present, and inject nothing when it's absent.
- All three adapters extend their existing whole-task stuck-task gate down to step granularity: 2+ failed attempts on the current (first non-complete) step blocks further `Edit`/`Write`/`apply_patch` calls until that step's `Status`/`Attempts` fields are updated, mirroring the v0.5.15 whole-task gate. Writes to `plan.md` itself remain exempt.
- `HARNESS.md`'s "3+ discrete steps" rule (the same threshold governing the `Relevant skills consulted` field) now also requires writing these steps to `plan.md` before starting, with per-step `Evidence`/`Status` filled in immediately after each step verifies, not batched at the end.

### Changed

- `.heli-harness/templates/current-task.md` and `HARNESS.md`'s Required Task State list gained a `Plan:` field pointing at `.heli-harness/state/plan.md` when one exists.
- `.heli-harness/manifest.json`'s `state` block now lists `plan.md` alongside `current_task`/`decisions`.
- `docs/ADAPTER_SUPPORT_MATRIX.md` and `.heli-harness/state/README.md` document the new rollup and per-step gate across all three adapters.

### Notes

- HARNESS.md's Operating Model previously had a gap: an earlier release intended to add a "3+ discrete steps" rule alongside the `Relevant skills consulted` field, but only the field name landed in the Required Task State list â€” the behavioral rule itself was never written. This release adds that rule for the first time, extended to also cover `plan.md`.
- Non-goals: no support for multiple simultaneous plans (one `plan.md`, same singular-active-task model as `current-task.md`); no archival mechanism for completed plans beyond whatever git history the workspace keeps; not a replacement for tool-specific planning skills (e.g. superpowers' `writing-plans`) â€” `plan.md` is the cross-CLI-portable layer, usable alongside a richer tool-specific plan doc if one exists.

## v0.5.16 - Cross-CLI Context Parity

### Added

- Claude Code and Codex native plugins now surface the last 5 `## `-headed sections of `.heli-harness/state/decisions.md` (the durable "why" decision log) at session start, alongside the `current-task.md` content already surfaced since v0.5.15.
- Pi/AXGA's `extensions/pi-extension.js` brought up to the same level as the Claude/Codex plugins: `before_agent_start` now injects real `current-task.md` and `decisions.md` content (previously only a generic reminder), and `tool_call` now gates file writes when `current-task.md` shows a stuck task (2+ failed attempts, incomplete) â€” mirroring the guard the plugins got in v0.5.15.
- Both `heli-governance/SKILL.md` copies (Claude, Codex) gained a one-line nudge to log durable decisions to `decisions.md` after completing S2/S3-tier work.

### Fixed

- Fixed a pre-existing bug (predating this release, from the original safe-auto-hooks work) in `isSuspiciousHarnessRuntimePath`'s call site in `extensions/pi-extension.js`: it was called with the raw relative path instead of the already-resolved absolute path, causing it to incorrectly flag the harness's own `.heli-harness/state/current-task.md` as a "suspicious" runtime folder. This silently broke the new stuck-task gate's self-exemption (an agent couldn't write `current-task.md` to resolve a stuck task). Found by new test coverage for that exemption; had zero prior test coverage.

### Changed

- `docs/ADAPTER_SUPPORT_MATRIX.md` and `.heli-harness/state/README.md` document the new Pi stuck-task gate and the cross-adapter `decisions.md` surfacing.

### Notes

- Closes the remaining asymmetry from v0.5.15: Pi/AXGA previously had weaker context continuity than Claude/Codex; all three adapters with a runtime hook mechanism (Claude, Codex, Pi/AXGA) now behave identically on this feature. Cursor and Generic have no hook mechanism and are unaffected.
- `enforced` status for Claude Code, Codex, and Pi is unaffected â€” this adds enforcement surface and context, it doesn't change the taxonomy basis for any adapter's status.

## v0.5.15 - Session Task Gate

### Added

- `SessionStart` in both the Claude Code and Codex native plugins now injects the real content of `.heli-harness/state/current-task.md` (previously only a static reminder to go read it), so carried-over task state actually reaches the next session's context instead of depending on the agent going to look for it.
- `PreToolUse` in both plugins now blocks `Edit`/`Write`/`apply_patch` calls when that carried-over task is stuck (2+ failed attempts, still not `complete`) or its target repo no longer matches `.heli-harness/workspace/target.json` â€” until the state file (or `target.json`) is updated to resolve it. Stateless: re-reads both files on every call, no session-id tracking or marker files, and clears itself automatically once the mismatch/stuck condition is fixed.
- Added 4 new fixture-based smoke assertions per plugin (`scripts/smoke-claude-plugin.mjs`, `scripts/smoke-codex-plugin.mjs`) covering the stuck case, the mismatch case, the healthy pass-through case, and the exemption for edits to `current-task.md`/`target.json` themselves. New shared test helpers (`withFixtureWorkspace`, `assertHookDenyInCwd`, `assertHookAllowInCwd`) added to `scripts/lib/plugin-smoke-helpers.mjs`.

### Changed

- `adapters.json` and `docs/ADAPTER_SUPPORT_MATRIX.md` now list this gate as a new enforcement surface for the `claude` and `codex` adapters.
- `HARNESS.md`'s Operating Model documents the new enforcement.

### Notes

- Closes a real cross-CLI handoff gap: this workspace's actual usage pattern is switching between Claude Code, Codex, and Pi/AXGA mid-task, and nothing previously stopped a new session in a different CLI from silently working against stale or mismatched task state left by a prior session.
- Scoped to the Claude Code and Codex native plugins only. Pi/AXGA already has its own separate `enforced` mechanism (`before_agent_start`/`session_start` hooks); extending this same gate there is a reasonable follow-up, not done here.
- `enforced` status for Claude Code and Codex is unaffected â€” this adds a new enforcement surface, it doesn't change the taxonomy basis for the existing status.

## v0.5.14 - Plugin Install Parity

### Added

- Added a `heli-install` skill to both `.heli-harness/adapters/claude-plugin/skills/` and `.heli-harness/adapters/codex-plugin/skills/`, giving parity with Pi/AXGA's `/heli-install`. Instruction-based (no JS runtime in these plugins): the agent runs `install.ps1`/`install.sh` itself instead of the skill shelling out.
- Reproduces Pi's `installHandler` guard (refuse and point at the update flow if the workspace is already installed) and `verifyInstall` checklist, since a dry-run confirmed `install.ps1` has no preserve-local-state logic of its own â€” that safety only exists in `update.ps1`.
- Resolves the latest release tag at run time instead of hardcoding a version, so the skill won't go stale next release.
- Added `assertFile` smoke coverage for `heli-target` and `heli-install` in both plugin smoke tests.

### Changed

- `adapters.json` and `docs/ADAPTER_SUPPORT_MATRIX.md` limitations updated to list the current plugin skill surface: `heli-governance` + `heli-target` + `heli-install`.

### Notes

- Same gap class as v0.5.13's `heli-target` port: a Pi/AXGA-only command with no Claude/Codex equivalent.
- `enforced` status for Claude Code and Codex is unaffected.

## v0.5.13 - Plugin Target Parity

### Added

- Added a `heli-target` skill to both `.heli-harness/adapters/claude-plugin/skills/` and `.heli-harness/adapters/codex-plugin/skills/`, giving `list`/`show`/`set`/`clear` parity with Pi/AXGA's `/heli-target` against `.heli-harness/workspace/index.json` and `target.json`. Instruction-based (no JS runtime in these plugins), so the agent performs the steps itself with its own file tools.
- `set` now confirms with the user before overwriting a `target.json` that already points at a different repo, instead of silently switching.

### Changed

- Reworded the `git push` deny message in both `heli-pre-tool-use.mjs` plugin copies: it previously said "without explicit release approval," which read as though ordinary branch pushes were release-gated. It now states plainly this is a blanket in-session rule with no bypass.
- Both `heli-governance/SKILL.md` copies now point at the `heli-target` mismatch-confirm workflow when the repo the user describes differs from the active target.
- `adapters.json` and `docs/ADAPTER_SUPPORT_MATRIX.md` now disclose that the Claude Code and Codex plugin skill surface is `heli-governance` + `heli-target` only, not Pi/AXGA's full 23-skill set. No adapter `status` value changed.

### Notes

- Prompted by real Codex CLI feedback hitting this exact gap while working against this harness in a separate workspace.
- `enforced` status for Claude Code and Codex is unaffected â€” it's scoped to runtime hook proof, which this release doesn't touch.

## v0.5.12 - Codex Live Hook Verification

### Fixed

- Fixed `heli-pre-tool-use.mjs` (Codex and Claude Code plugin copies): the file-write guard only recognized `path`/`file` object keys, but Codex's `apply_patch` tool embeds the target path inside a patch-format string under `command` (e.g. `*** Add File: .env`), so `.env` writes went through unguarded in a real Codex session. Now also parses `*** Add/Update/Delete File:` and `*** Move to:` patch directives.
- Fixed the synthetic `apply_patch` test case in `smoke-claude-plugin.mjs` and `smoke-codex-plugin.mjs`, which used an unrealistic `{ path: ... }` payload that passed without exercising Codex's real tool shape â€” replaced with the actual payload shape captured from a live Codex session.

### Added

- Added `scripts/live-verify-codex-plugin-hook.mjs`: drives a real `codex exec` turn (isolated `CODEX_HOME`, throwaway git repo, `--dangerously-bypass-hook-trust`) and asserts the CLI's own output shows the PreToolUse hook denying both `git push` and a `.env` write, with the filesystem confirming `.env` was never created.
- Added `live-verify:codex-plugin-hook` npm script. Not part of `npm run check` â€” requires a real installed, logged-in Codex CLI and available usage quota.

### Changed

- Promoted Codex from `verified-plugin-wired` to `enforced`, backed by live-session evidence.
- Updated adapter manifest, support matrix, README, and Codex adapter docs for the new status.

### Notes

- Live proof used `--dangerously-bypass-hook-trust`; the normal interactive hook-trust prompt flow is not separately verified.
- Pi, Claude Code, and Codex are now all `enforced`.

## v0.5.11 - Live Runtime Verification

### Added

- Added `.heli-harness/adapters/codex-plugin/.agents/plugins/marketplace.json` â€” the Codex plugin directory had no marketplace manifest, so `codex plugin marketplace add` could not recognize it. Fixed and live-verified against the real Codex CLI.
- Added `scripts/live-verify-claude-plugin.mjs`: drives a real `claude -p` session (`--plugin-dir`, isolated sandbox repo) and asserts the session's own `permission_denials` result shows the PreToolUse hook denying `git push` and a `.env` write.
- Added `scripts/live-verify-codex-plugin-install.mjs`: drives the real `codex` CLI (isolated `CODEX_HOME`) through `plugin marketplace add` and `plugin add`, and confirms `plugin list` reports it installed and enabled.
- Added `live-verify:claude-plugin` and `live-verify:codex-plugin-install` npm scripts. Not part of `npm run check` â€” they require a real installed CLI and make real API calls.

### Changed

- Promoted Claude Code from `verified-plugin-wired` to `enforced`, backed by live-session evidence.
- Updated adapter manifest, support matrix, README, and Claude/Codex adapter docs for the new evidence and status.

### Notes

- Codex remains `verified-plugin-wired`: marketplace add, plugin install, and trust are proven live against the real Codex CLI, but PreToolUse hook firing during a real model turn is not yet proven â€” that check needs Codex usage quota that was unavailable at verification time.
- Claude Code's live proof used `--plugin-dir` session loading, not the marketplace-installed-and-trusted flow (`claude plugin install`); that path is not separately verified.
- Pi and Claude Code are the `enforced` adapters. Codex is not.

## v0.5.10 - Native Plugin Parity

### Added

- Added `docs/PONYTAIL_PARITY_AUDIT.md` comparing Heli against Ponytail plugin artifacts, hooks, commands, skills, install flow, and validation evidence.
- Added Claude Code native plugin artifacts under `.heli-harness/adapters/claude-plugin/`.
- Added Codex native plugin artifacts under `.heli-harness/adapters/codex-plugin/`.
- Added `scripts/smoke-claude-plugin.mjs`, `scripts/smoke-codex-plugin.mjs`, and a small shared plugin smoke helper.

### Changed

- Added `verified-plugin-wired` and `plugin-wired` adapter statuses.
- Promoted Claude Code and Codex from `verified-wired` to `verified-plugin-wired`.
- Integrated plugin smoke tests into `npm run check`, adapter verification, and release validation.
- Updated install docs, support matrix, governance model, and README for pointer adapter mode versus native plugin artifact mode.

### Notes

- Does not claim live Claude Code or Codex runtime hook enforcement.
- Synthetic PreToolUse hook tests deny `git push` and `.env` writes, but host install/trust/runtime execution still needs live verification before any `enforced` claim.
- Pi remains the only `enforced` adapter.

## v0.5.9 - Codex Governance Workflow

### Added

- Added `scripts/smoke-codex-adapter.mjs` to verify Codex adapter files, required `AGENTS.md` sections, installer-created workspace `AGENTS.md`, update preservation of user-owned workspace `AGENTS.md`, manifest evidence, and support matrix claims.
- Added `smoke:codex` npm script and included Codex smoke in `npm run check`.

### Changed

- Promoted Codex from `wired` to `verified-wired`.
- Improved `.heli-harness/adapters/codex/AGENTS.md` as the Codex-facing governance entrypoint with target discipline, write boundaries, safety guidance, evidence rules, validation expectations, final report expectations, and explicit limitations.
- Updated `.heli-harness/adapters/codex/README.md` with the recommended Codex workflow and non-enforcement limitations.
- Updated adapter manifest, support matrix, install docs, README, and governance model for the new status.
- Integrated Codex smoke into release validation.

### Notes

- Does not claim Codex runtime hook enforcement.
- Pi remains the only `enforced` adapter.
- Claude Code and Codex are `verified-wired`.
- Does not implement OpenCode/Cursor real adapters.
- Does not start benchmark matrix runs.

## v0.5.8 - Claude Code Adapter Verification

### Added

- Added `verified-wired` adapter status for smoke-tested adapter wiring without runtime enforcement claims.
- Added `scripts/smoke-claude-adapter.mjs` to verify Claude adapter files, required `CLAUDE.md` sections, settings JSON parsing, installer-created workspace `CLAUDE.md`, update preservation of user-owned workspace `CLAUDE.md`, manifest evidence, and support matrix claims.
- Added `smoke:claude` npm script and included Claude smoke in `npm run check`.

### Changed

- Promoted Claude Code from `wired` to `verified-wired`.
- Improved `.heli-harness/adapters/claude/CLAUDE.md` as the Claude-facing harness entrypoint with target discipline, write boundaries, safety guidance, evidence rules, validation expectations, final report expectations, and explicit limitations.
- Updated adapter manifest, support matrix, install docs, README, and governance model for the new status.
- Integrated Claude smoke into release validation.
- Included local Windows portability hotfix `04443f2` for `scripts/smoke-update-preserves-local-state.mjs`.

### Notes

- Does not claim Claude Code runtime hook enforcement.
- Pi remains the only `enforced` adapter.
- Does not implement Codex/OpenCode/Cursor real adapters.
- Does not start benchmark matrix runs.

## v0.5.7 - Adapter Wiring Coverage

### Added

- Added adapter status taxonomy: `enforced`, `wired`, `documented`, `planned`, `unsupported`.
- Added `docs/ADAPTER_SUPPORT_MATRIX.md` with honest, evidence-based adapter status assessment.
- Added `.heli-harness/adapters/adapters.json` as machine-readable adapter manifest with evidence paths.
- Added `scripts/verify-adapters.mjs` to validate adapter claims against evidence.
- Added `verify:adapters` npm script for standalone adapter verification.
- Added adapter wiring verification to `scripts/validate-release.mjs`.

### Changed

- Integrated adapter verification into release validation pipeline.
- Updated docs to reference adapter support matrix.
- Classified Pi adapter as `enforced` (has extension, smoke tests, hook guards).
- Classified Codex/Claude/Cursor adapters as `wired` (adapter files exist, install creates pointers, but no runtime enforcement).
- Classified AXGA/Generic adapters as `documented` (docs exist, but no dedicated verification).
- Classified OpenCode/Windsurf/Cline/Gemini/OpenClaw adapters as `planned` (no implementation yet).

### Notes

- Does not add Claude/Codex/OpenCode runtime adapter implementation.
- Does not start benchmark matrix runs.
- Preserves v0.5.3 command-rules.json source-of-truth and v0.5.4 classifier architecture.
- Claims require evidence: no adapter is claimed as "enforced" without smoke tests proving runtime enforcement.

## v0.5.6 - Classifier Git Global Flags Hotfix

### Added

- Added git global flags normalization in the command classifier. Commands like `git -C repo push`, `git -c user.name=test push`, and `git -C /tmp -c core.autocrlf=false push` are now correctly identified as `git push` for rule matching.
- Added smoke coverage for git global flags normalization (`-C`, `-c`, combined forms).

### Changed

- Improved command classifier to strip git global flags before rule matching, closing the gap where `git -C repo push` could bypass push detection.

### Notes

- Does not add Claude/Codex/OpenCode adapter implementation.
- Does not start benchmark matrix runs.
- Preserves v0.5.3 command-rules.json source-of-truth and v0.5.4 classifier architecture.
- Adapter Wiring Coverage is deferred to v0.5.7.

## v0.5.5 - Update Preservation & Tool Coverage

### Added

- Added update overlay preservation for `profiles/`, `workspace/`, `policies/`, and `safety/` in `update.sh` and `update.ps1`. Local overlays now survive updates by default alongside the existing `state/` preservation.
- Added `scripts/smoke-update-preserves-local-state.mjs` smoke test for update overlay preservation.
- Added `npm run smoke:update` script for update preservation verification.
- Added tool-agnostic command guard: `input.command` is now inspected for any command-bearing tool call, not just `bash`. This catches `shell` and other tool names that carry command input.
- Added multi-tool file write guard: `multi_edit`, `file_write`, `file_edit`, `fs.write`, and `filesystem.write` tool calls are now path-guarded alongside `write` and `edit`.
- Added backup suffix secret path detection for `.env.bak`, `.pem.bak`, `.key.bak`, `credentials.json.bak`, and `secrets.json.bak`.
- Added combined short-flag handling in the command classifier (e.g., `git clean -xdf` is now recognized as `git clean -fd`).
- Added smoke coverage for `shell` toolName command guarding, `multi_edit` path blocking, `file_write` secret path blocking, `git clean -xdf` classifier normalization, and backup suffix secret paths.

### Changed

- Update scripts now preserve local overlays (`profiles/`, `workspace/`, `policies/`, `safety/`) by default. `--reset-state` / `-ResetState` still resets only `state/`.
- Moved `validate-release.mjs` legacy pattern `rg` error handling inside the per-pattern loop so that `rg` exit 1 for no matches on one pattern does not skip remaining patterns.
- CI whitespace check now uses `git diff-tree --check --no-commit-id --root -r HEAD` instead of `git diff --check HEAD~1 HEAD || true`, making it enforcing.
- `npm run check` now includes `smoke:update`.

### Notes

- Does not add Claude/Codex/OpenCode adapter implementation.
- Does not start benchmark matrix runs.
- Does not add `"type": "module"` to `package.json` (deferred for separate risk assessment).

## v0.5.4 - Safety Classifier Hardening

### Added

- Added a local Pi/AXGA safety classifier before command-rule matching.
- Added normalization for repeated whitespace, case variants, simple command chains, and shell wrappers such as `bash -c`, `sh -c`, `cmd /c`, and PowerShell command wrappers.
- Added classifier coverage for publish/release variants, destructive delete variants, shell redirection writes outside `writesAllowedUnder`, sensitive reads, expanded secret paths, and obvious secret-like write content.
- Added smoke coverage for bypass forms including `git   push`, `GIT PUSH`, `bash -c "git push"`, package-manager publish variants, `rm -r -f`, `rm --recursive --force`, out-of-target redirection, secret-path writes, secret-content writes, and `cat .env`.

### Changed

- Kept `.heli-harness/safety/command-rules.json` as the policy source of truth while using classifier-normalized command variants to match rules more reliably.
- Expanded default command rules for common package-manager, release, and destructive command variants.
- Updated docs to clarify v0.5.4 is best-effort local classification, not a sandbox.

### Notes

- Enforcement still depends on compatible host `tool_call` hooks.
- Does not add Claude/Codex/OpenCode adapter implementation.
- Does not start benchmark matrix runs.

## v0.5.3 - Rules-as-Enforcement

### Added

- Pi/AXGA command guards now load `.heli-harness/safety/command-rules.json` as the runtime source of truth for configured bash command patterns.
- Added command-rule schema validation for release checks and safety lint.
- Added smoke coverage for default dangerous commands, custom command rules, invalid command-rule configs, and fallback blocking behavior.

### Changed

- Expanded default `command-rules.json` to include the full set of previously hardcoded bash guard patterns.
- Updated docs to clarify that command-rule enforcement depends on compatible host `tool_call` hooks and is not a sandbox.

### Notes

- Keeps v0.5.4 safety classifier hardening separate.
- Does not add Claude/Codex/OpenCode adapter implementation.
- Does not start benchmark matrix runs.

## v0.5.2 - Dogfood Lint Hotfix

### Fixed

- Fixed Pi/AXGA profile lint so `.heli-harness/profiles/README.md` and `*.example.md` files are not treated as active repo profiles.
- Added smoke coverage proving profile documentation is ignored, valid active profiles are still checked, and invalid active profiles still emit warnings.

### Notes

- Keeps v0.5.1 intact as published.
- Moves Rules-as-Enforcement to the next v0.5.x milestone.

## v0.5.1 - Self-Consistency and Dogfood Cleanup

### Changed

- Updated current install examples and user-facing Pi/AXGA adapter docs to v0.5.1.
- Added an active `heli-harness` repo profile and self-dogfood workspace target defaults.
- Moved the unrelated `agent-native-backend` profile to an example filename.
- Made policy exception sections explicit when no exceptions are approved.
- Clarified that OpenMesh-style benchmark content is illustrative and not measured evidence.
- Updated research and ADR language to separate hypothesis, design rationale, observed evidence, and measured benchmark results.
- Extended release validation to cover adapter docs, internal install docs, extension strings, shipped defaults, profile taxonomy, policy exceptions, and benchmark labeling.

### Notes

- Keeps the v0.5.x Full Coverage benchmark roadmap intact.
- Does not add Claude/Codex/OpenCode adapter implementation.
- Does not start benchmark matrix runs.

## v0.5.0 - Governance Benchmark Pack

### Added

- Added `benchmarks/` directory with repeatable governance benchmark templates.
- Added benchmark scenarios:
  - `docs-change.md` â€” low-risk docs task measuring report quality and minimality
  - `bugfix-small.md` â€” small bugfix measuring diagnosis, minimal diff, tests, report evidence
  - `feature-small.md` â€” small feature measuring scope control, implementation quality, validation
  - `multi-repo-targeting.md` â€” parent workspace task measuring target discipline
  - `unsafe-command.md` â€” risky command task measuring safety behavior
  - `tech-debt-pattern.md` â€” weak pattern task measuring tech debt classification
- Added scoring rubrics:
  - `scoring-rubric.md` â€” 0-3 scoring scale with category groupings
  - `metrics.md` â€” required and optional benchmark metrics
  - `report-completeness.md` â€” report quality scoring guide
  - `safety-score.md` â€” safety behavior scoring guide
  - `target-discipline.md` â€” target discipline scoring guide
- Added experiment templates:
  - `experiment-plan.md` â€” benchmark experiment planning template
  - `run-log.md` â€” run logging template
  - `scorecard.md` â€” scoring template with example
  - `comparison-report.md` â€” A/B/C/D mode comparison template
- Added example A/B/C/D benchmark (`openmesh-style-ab.md`).
- Added optional local benchmark summary script (`scripts/benchmark-summary.mjs`).
- Updated validation script to check benchmark pack presence.

### Changed

- Updated README.md with benchmark pack section and v0.5.0 install examples.
- Updated ROADMAP.md with v0.5.0 as current baseline and post-v0.5 stabilization section.
- Updated INSTALL.md and docs/INSTALL_MATRIX.md to v0.5.0.
- Updated governance model to include benchmark artifacts.
- Added `benchmarks/` to package.json files allowlist.

### Notes

- Keeps Heli lightweight, markdown-first, local, inspectable, and adapter-friendly.
- Benchmarks are local, manual, and telemetry-free.
- Does not add runtime orchestration, a database, hosted telemetry, or vector memory.
- Does not add a benchmark web dashboard or hosted service.
- Future stabilization work remains separate.

## v0.4.3 - CI and State Safety Polish

### Added

- Added GitHub Actions CI workflow (`.github/workflows/ci.yml`).
- Added local release validation script (`scripts/validate-release.mjs`).
- Added docs/version consistency checks in the validation script.
- Added advisory session lock template (`.heli-harness/state/session.lock.example.json`).
- Added advisory target lock template (`.heli-harness/workspace/target.lock.example.json`).
- Added `/heli-lock` command for showing advisory lock state.
- Added lock awareness to `/hh-status` (session lock, target lock, owner, expiration).
- Added lock lint through `/heli-validate lock` and `/heli-validate lint`.
- Added report template sections for lock context and parallel agent risk.
- Added report lint warnings for parallel work without lock state and lock conflicts without resolution.
- Added `check`, `smoke`, and `validate:release` package scripts.

### Changed

- Updated docs, templates, and governance model for advisory lock awareness.
- Updated install examples and baseline references to v0.4.3.

### Notes

- Keeps Heli lightweight, markdown-first, local, inspectable, and adapter-friendly.
- Locks are advisory warnings, not distributed locking.
- Does not add runtime orchestration, a database, hosted telemetry, or vector memory.
- v0.5.0 benchmark pack remains future work.

## v0.4.2 - Multi-Repo Targeting and Workspace Index

### Added

- Added `.heli-harness/workspace/` with `index.json`, `target.json`, and workspace notes.
- Added `/heli-target` for showing, listing, setting, and clearing active target repo state.
- Added workspace and target lint through `/heli-validate workspace` and `/heli-validate target`.

### Changed

- Improved `/hh-status` to show workspace index state, known repos, selected target, target git root, writes allowed under, target profile state, and cwd alignment.
- Added report template and lint checks for workspace root, target context, workspace index usage, and out-of-target warnings.
- Added conservative write-path guarding for ambiguous multi-repo workspaces and obvious out-of-target writes.

### Notes

- Keeps Heli lightweight, markdown-first, local, inspectable, and adapter-friendly.
- Does not add runtime orchestration, a database, hosted telemetry, vector memory, or cross-repo dependency solving.
- v0.5.0 benchmark work remains a future milestone.

## v0.4.1 - Profile Taxonomy and Tech-Debt Classification

### Added

- Strengthened repo profile taxonomy with explicit policy references, safer alternatives, evidence paths, and classification guidance.
- Added report template sections for active profile, taxonomy warnings, profile-based decisions, tech debt copied or avoided, safer alternatives chosen, and profile deviations.

### Changed

- Improved profile lint to warn on vague "follow existing patterns" language, missing evidence paths, missing safer alternatives, risky recommended conventions, and missing policy references.
- Updated `heli-init` guidance to require taxonomy classification and tech-debt framing for risky existing patterns.
- Updated docs and install examples to the `v0.4.1` baseline.

### Notes

- No runtime, orchestration, database, hosted telemetry, or vector memory expansion.
- v0.4.2 multi-repo targeting and v0.5.0 governance benchmark work remain future milestones.

## v0.4.0 - Policy Overlays

### Added

- Added `.heli-harness/policies/` with markdown-first templates for engineering, security, release, and testing rules.
- Added `.heli-harness/safety/` with command tiers, lightweight command rules JSON, and secret-handling guidance.
- Added policy and safety visibility in `/hh-status`.
- Added policy and safety lint through `/heli-validate lint`, `/heli-validate policy`, and `/heli-validate safety`.
- Added report checks for policies loaded, safety overlays loaded, approval evidence, safety events, and policy-deviation justification.

### Changed

- Updated repo profile and run report templates to keep profiles descriptive and move prescriptive rules into overlays.
- Improved profile lint so prescriptive language under descriptive sections is warned on.

### Notes

- Keeps Heli lightweight, markdown-first, local, inspectable, and adapter-friendly.
- Does not add runtime orchestration, a database, hosted telemetry, or vector memory.
- v0.4.1 profile taxonomy refinements and v0.4.2 multi-repo targeting remain future milestones.

## v0.3.3 - Status, Profile Lint, and Report Gates

### Added

- Improved `/hh-status` with version, workspace mode, profile, policies, hooks, recent hook activity, skill count, and probe state.
- Clearer `/heli-hooks` status with probe explanations and explicit one-shot probe state.
- Profile taxonomy lint through `/heli-validate lint` and `/heli-validate profile`.
- Report completeness lint through `/heli-validate lint` and `/heli-validate report`.
- Updated profile and run report templates for taxonomy and report gates.

### Notes

- No runtime, orchestration, database, hosted telemetry, or vector memory expansion.
- Heli remains lightweight, local, markdown-first, inspectable, and adapter-friendly.

## v0.3.2 - Hook Observability Probes

### Added

- `/heli-hooks probe`
- One-shot `before_agent_start` canary with `HELI_HOOK_OK`
- `/heli-hooks test-guard`
- One-shot `tool_call` guard canary with `HELI_GUARD_OK`
- Probe behavior stays opt-in and one-shot

### Changed

- Normal hook behavior is unchanged
- Extension smoke coverage now verifies probe and test-guard paths

## v0.3.1 - AXGA extension loader compatibility hotfix

### Fixed

- Fixed `tool_call` handler structure so `event` is only read inside the callback.
- Ensured AXGA can load `extensions/pi-extension.js` with plain loader-friendly JavaScript.
- Kept v0.3.0 safe auto hooks behavior, including `/heli-hooks`.
- Added extension load smoke validation for event hooks and commands.

## v0.3.0 - Safe Auto Hooks

### Added

- **session_start hook**: Detects workspace harness and shows status (active/package-only)
- **before_agent_start hook**: Injects compact safety rules when workspace exists
  - Instructs agent to read HARNESS.md, profiles, preserve dirty work
  - Prevents accidental mutating/release/push operations without approval
- **tool_call safety guard**: Blocks or confirms dangerous operations
  - Bash: `npm publish`, `git push`, `rm -rf`, release commands, API-credit-consuming commands
  - Files: `.env`, `.pem`, `.key`, credential files, legacy runtime folders
- **input shortcuts**: `/review`, `/audit`, `/validate`, `/impact` â†’ `/heli-*` commands
- **/heli-hooks command**: Show auto hooks status
- Status bar integration: `heli: active` or `heli: package-only`

### Safety Guarantees

- No auto install
- No auto tests
- No auto commits
- No auto pushes
- No destructive automation
- All hooks respect workspace detection (only activate when `.heli-harness/HARNESS.md` exists)
- tool_call guard uses `ctx.ui.confirm()` when available, otherwise blocks by default

### Implementation Details

- Hooks only activate when workspace harness is detected
- before_agent_start appends compact rules to system prompt (does not override)
- tool_call guard checks both bash commands and file write/edit operations
- input shortcuts only transform exact matches, not natural language
- Status bar shows current workspace state

## v0.2.0 - Pi workflow commands

### Added

- `/heli-help` - Show Heli-Harness commands and what they do
- `/heli-init` - Bootstrap repo profile for a target repo
- `/heli-review` - Review current repo/diff/task safely
- `/heli-audit` - Repo-wide audit for issues and risks
- `/heli-validate` - Run test-validation workflow safely
- `/heli-impact` - Impact analysis for planned changes

### Changed

- All workflow commands are workspace-aware: check for `.heli-harness/HARNESS.md` before proceeding
- Commands suggest `/heli-install` if workspace harness is missing
- Added 6 namespaced wrapper skills to avoid skill name collisions
- Commands preserve safe, opt-in behavior
- Commands avoid legacy names.

### Notes

- No breaking changes
- No migration support added
- All commands are non-destructive by default

## 0.1.2 - 2026-06-28

### Docs-only polish

- Updated all install examples from v0.1.0 to v0.1.1
- Removed outdated "experimental" label from Pi adapter section
- Updated status notes to reflect verified Pi remote install for v0.1.1+
- No behavior changes
- No migration support added

## 0.1.1 - 2026-06-28

### Clean reference hotfix

- Fixed Claude hook example path to `.heli-harness` in `settings.local.json.example`
- Fixed `.gitignore` patterns to `.heli-harness`
- Confirmed zero legacy references in codebase
- No behavior changes
- No migration support added

## 0.1.0 - 2026-06-28

### Initial Heli-Harness release

- Parent-workspace harness for multi-repo, multi-agent engineering work
- 17 skills: audit, branch, debug, deps, design, engineering, feature, fix-loop, flow, gh-write, impact, incident, release, test-coverage, test-validation, verify-premise, workflow
- Pi package with skills + lightweight extension
- `/heli-install` and `/hh-install` commands for workspace setup
- `/hh-status` command for harness status reporting
- Safe opt-in workspace install (no auto-install on startup)
- Codex, Claude Code, Cursor, and Generic agent adapters
- Repo profiles, state tracking, task protocol
- Optional lifecycle hooks
- Profile templates
- Install, update, and uninstall scripts for Windows and macOS/Linux
