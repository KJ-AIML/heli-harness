# Changelog

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
