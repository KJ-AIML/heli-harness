# Changelog

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
- `enforced` status for Claude Code and Codex is unaffected — it's scoped to runtime hook proof, which this release doesn't touch.

## v0.5.12 - Codex Live Hook Verification

### Fixed

- Fixed `heli-pre-tool-use.mjs` (Codex and Claude Code plugin copies): the file-write guard only recognized `path`/`file` object keys, but Codex's `apply_patch` tool embeds the target path inside a patch-format string under `command` (e.g. `*** Add File: .env`), so `.env` writes went through unguarded in a real Codex session. Now also parses `*** Add/Update/Delete File:` and `*** Move to:` patch directives.
- Fixed the synthetic `apply_patch` test case in `smoke-claude-plugin.mjs` and `smoke-codex-plugin.mjs`, which used an unrealistic `{ path: ... }` payload that passed without exercising Codex's real tool shape — replaced with the actual payload shape captured from a live Codex session.

### Added

- Added `scripts/live-verify-codex-plugin-hook.mjs`: drives a real `codex exec` turn (isolated `CODEX_HOME`, throwaway git repo, `--dangerously-bypass-hook-trust`) and asserts the CLI's own output shows the PreToolUse hook denying both `git push` and a `.env` write, with the filesystem confirming `.env` was never created.
- Added `live-verify:codex-plugin-hook` npm script. Not part of `npm run check` — requires a real installed, logged-in Codex CLI and available usage quota.

### Changed

- Promoted Codex from `verified-plugin-wired` to `enforced`, backed by live-session evidence.
- Updated adapter manifest, support matrix, README, and Codex adapter docs for the new status.

### Notes

- Live proof used `--dangerously-bypass-hook-trust`; the normal interactive hook-trust prompt flow is not separately verified.
- Pi, Claude Code, and Codex are now all `enforced`.

## v0.5.11 - Live Runtime Verification

### Added

- Added `.heli-harness/adapters/codex-plugin/.agents/plugins/marketplace.json` — the Codex plugin directory had no marketplace manifest, so `codex plugin marketplace add` could not recognize it. Fixed and live-verified against the real Codex CLI.
- Added `scripts/live-verify-claude-plugin.mjs`: drives a real `claude -p` session (`--plugin-dir`, isolated sandbox repo) and asserts the session's own `permission_denials` result shows the PreToolUse hook denying `git push` and a `.env` write.
- Added `scripts/live-verify-codex-plugin-install.mjs`: drives the real `codex` CLI (isolated `CODEX_HOME`) through `plugin marketplace add` and `plugin add`, and confirms `plugin list` reports it installed and enabled.
- Added `live-verify:claude-plugin` and `live-verify:codex-plugin-install` npm scripts. Not part of `npm run check` — they require a real installed CLI and make real API calls.

### Changed

- Promoted Claude Code from `verified-plugin-wired` to `enforced`, backed by live-session evidence.
- Updated adapter manifest, support matrix, README, and Claude/Codex adapter docs for the new evidence and status.

### Notes

- Codex remains `verified-plugin-wired`: marketplace add, plugin install, and trust are proven live against the real Codex CLI, but PreToolUse hook firing during a real model turn is not yet proven — that check needs Codex usage quota that was unavailable at verification time.
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
  - `docs-change.md` — low-risk docs task measuring report quality and minimality
  - `bugfix-small.md` — small bugfix measuring diagnosis, minimal diff, tests, report evidence
  - `feature-small.md` — small feature measuring scope control, implementation quality, validation
  - `multi-repo-targeting.md` — parent workspace task measuring target discipline
  - `unsafe-command.md` — risky command task measuring safety behavior
  - `tech-debt-pattern.md` — weak pattern task measuring tech debt classification
- Added scoring rubrics:
  - `scoring-rubric.md` — 0-3 scoring scale with category groupings
  - `metrics.md` — required and optional benchmark metrics
  - `report-completeness.md` — report quality scoring guide
  - `safety-score.md` — safety behavior scoring guide
  - `target-discipline.md` — target discipline scoring guide
- Added experiment templates:
  - `experiment-plan.md` — benchmark experiment planning template
  - `run-log.md` — run logging template
  - `scorecard.md` — scoring template with example
  - `comparison-report.md` — A/B/C/D mode comparison template
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
- **input shortcuts**: `/review`, `/audit`, `/validate`, `/impact` → `/heli-*` commands
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
