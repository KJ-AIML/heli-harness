# Heli-Harness Roadmap

## Current Baseline: v0.5.11

Latest stable release: `v0.5.11`

Release commit: pending tag `v0.5.11`

Release URL: <https://github.com/KJ-AIML/heli-harness/releases/tag/v0.5.11>

Stable behavior in this baseline:

- Parent-workspace harness install using `.heli-harness/`.
- Repo-local profiles, state, templates, and adapter instructions.
- Pi/AXGA package mode with 23 skills and `extensions/pi-extension.js`.
- Safe auto hooks for session status, compact safety injection, tool-call guards, and input shortcuts.
- Hook observability probes:
  - `/heli-hooks probe`
  - one-shot `before_agent_start` canary with `HELI_HOOK_OK`
  - `/heli-hooks test-guard`
  - one-shot `tool_call` guard canary with `HELI_GUARD_OK`
- Status and lint gates:
  - improved `/hh-status`
  - clearer `/heli-hooks` status
  - `/heli-validate lint`
  - profile taxonomy warnings
  - report completeness warnings
- Policy overlays:
  - `.heli-harness/policies/`
  - `.heli-harness/safety/`
  - policy and safety visibility in `/hh-status`
  - policy and safety lint
  - report policy-deviation checks
- Profile taxonomy and tech-debt classification:
  - stronger repo profile template
  - evidence path expectations
  - safer alternative expectations
  - report integration for profile decisions
- Multi-repo targeting and workspace index:
  - `.heli-harness/workspace/`
  - workspace index and target state
  - `/heli-target`
  - workspace and target lint
  - report target-context checks
- CI and state safety polish:
  - GitHub Actions CI workflow
  - local release validation script
  - docs/version consistency checks
  - advisory session and target lock templates
  - lock awareness in `/hh-status` and `/heli-validate`
  - `/heli-lock` command for lock inspection
- Governance benchmark pack:
  - `benchmarks/` directory with repeatable experiment templates
  - scenario templates (docs-change, bugfix-small, feature-small, multi-repo-targeting, unsafe-command, tech-debt-pattern)
  - scoring rubrics (safety, target discipline, report completeness, implementation quality)
  - experiment templates (experiment plan, run log, scorecard, comparison report)
  - example A/B/C/D benchmark (openmesh-style-ab.md)
  - optional local benchmark summary script
- Self-consistency and dogfood cleanup:
  - current install examples and adapter docs aligned to the latest stable tag
  - active `heli-harness` repo profile and self-dogfood workspace target defaults
  - release validation covers adapter docs, internal install docs, extension strings, shipped defaults, profile taxonomy, policy exceptions, and benchmark labeling
  - benchmark examples clearly labeled as illustrative until measured runs exist
- Dogfood lint hotfix:
  - profile lint ignores documentation and example markdown in `.heli-harness/profiles/`
  - active profiles remain linted, including invalid active profiles in smoke fixtures
- Rules-as-Enforcement:
  - Pi/AXGA command guards consume `.heli-harness/safety/command-rules.json`
  - release validation checks command-rule schema
  - invalid or missing command-rule config falls back to conservative built-in defaults
- Safety Classifier Hardening:
  - command normalization handles repeated whitespace, case variants, simple chains, and common shell wrappers
  - classifier facts improve matching for publish/release variants and destructive delete variants
  - shell redirection writes outside `writesAllowedUnder`, sensitive reads, expanded secret paths, and obvious secret-like write content are guarded where host hooks expose inputs
- Adapter verification:
  - adapter manifest and support matrix validate evidence-backed claims
  - Pi remains `enforced`
  - Claude Code is `verified-plugin-wired`: pointer adapter plus native plugin manifest, hook config, skill, and synthetic hook smoke tests are validated
  - Codex is `verified-plugin-wired`: pointer adapter plus native plugin manifest, hook config, skill, plugin AGENTS.md, and synthetic hook smoke tests are validated
  - Cursor remains `wired`
  - runtime enforcement is not claimed without tested hook evidence

## Product Positioning

Heli-Harness is an instructions-as-code governance harness for coding agents.

It gives local coding agents a shared, inspectable operating layer for workspace protocols, repo facts, policies, safety expectations, task state, adapter instructions, observable hooks, and reviewable reports.

It is not an agent runtime. It does not plan or execute work by itself. It helps humans and coding agents agree on what context is authoritative, what behavior is expected, what actions are risky, and what evidence proves the work was done responsibly.

## Core Thesis

Facts describe. Policies decide. Safety enforces. Reports prove.

- Facts describe: repo profiles record what exists, where it lives, and how the repo currently behaves.
- Policies decide: policy overlays state what teams require, recommend, forbid, or allow only with approval.
- Safety enforces: hooks, guards, command tiers, and approval rules block or surface risky actions where the host tool supports enforcement.
- Reports prove: run reports, validation notes, and audit artifacts show what changed, what commands ran, what risks remain, and where the agent deviated.

## Design Principles

- Keep Heli lightweight, local, markdown-first, and inspectable.
- Separate repo facts from engineering policy.
- Prefer explicit files over hidden state.
- Prefer adapter-friendly conventions over one host-specific runtime.
- Treat instruction files as context, not enforcement.
- Put enforcement into hooks, guards, approvals, and validation where available.
- Make hook behavior observable.
- Require evidence for claims of safety, validation, and completion.
- Avoid turning existing weak patterns into recommended conventions.
- Use machine-readable sidecars only where markdown cannot carry the contract safely.
- Keep release milestones version-based, not calendar-based.

## What Heli Is

- A parent-workspace governance harness for coding agents.
- A repository of durable instructions, profiles, policies, templates, and reports.
- A lightweight package for agent hosts that can load skills and hooks.
- A way to make workspace identity, target repo, safety posture, and validation expectations visible.
- A review artifact generator through repeatable workflows and reports.
- A bridge between human policy and agent execution behavior.

## What Heli Is Not

- Not a full agent runtime.
- Not a planner.
- Not a task execution engine.
- Not a multi-agent orchestrator.
- Not a vector memory platform.
- Not a central database.
- Not a hosted telemetry product.
- Not a plugin marketplace before schemas are stable.
- Not a replacement for linters, tests, code owners, branch protection, or human review.

## Roadmap Overview

| Milestone | Theme | Primary Outcome |
| --- | --- | --- |
| v0.3.x | Trust and observability | Make users confident that Heli is loaded, active, and inspectable. |
| v0.3.3 | Status, profile lint, and report gates | Make active state and missing documentation/report sections visible. |
| v0.4.0 | Policy overlays | Separate descriptive repo facts from prescriptive engineering rules. |
| v0.4.1 | Profile taxonomy and tech-debt classification | Stop agents from copying weak existing patterns blindly. |
| v0.4.2 | Multi-repo targeting and workspace index | Prevent wrong-repo and wrong-directory edits in parent workspaces. |
| v0.4.3 | CI and state safety polish | Self-validate on GitHub, check docs/version consistency, advisory lock warnings for parallel agents. |
| v0.5.0 | Governance benchmark pack | Measure Heli as a governance layer with repeatable experiments. |
| v0.5.1 | Self-consistency and dogfood cleanup | Make current claims, shipped defaults, and release validation align before adapter/benchmark expansion. |
| v0.5.2 | Dogfood lint hotfix | Remove Pi/AXGA profile lint noise from profile docs while preserving active-profile checks. |
| v0.5.3 | Rules-as-Enforcement | Make safety command rules executable in Pi/AXGA command guards. |
| v0.5.4 | Safety Classifier Hardening | Harden command classification beyond simple pattern matching. |
| v0.5.5 | Update Preservation & Tool Coverage | Preserve local overlays during update, broaden tool and path guard coverage. |
| v0.5.6 | Classifier Git Global Flags Hotfix | Normalize git global flags (-C, -c) before rule matching. |
| v0.5.7 | Adapter Wiring Coverage | Verify adapter file presence, update support matrix, add adapter validation. |
| v0.5.8 | Claude Code Adapter Verification | Smoke-test Claude adapter files, settings JSON, installer pointer, and update preservation without claiming runtime enforcement. |
| v0.5.9 | Codex Governance Workflow | Smoke-test Codex adapter files, installer pointer, and update preservation without claiming runtime enforcement. |
| v0.5.10 | Native Plugin Parity | Add Ponytail parity audit, Claude/Codex native plugin artifacts, plugin smoke tests, and verified-plugin-wired taxonomy without claiming live runtime enforcement. |
| v0.5.11 | Live Runtime Verification | Prove plugin hooks fire in a real Claude Code session, add the missing Codex marketplace manifest, and live-verify Codex install/trust; promote Claude Code to `enforced`. |
| Post-v0.5 | Stabilization before expansion | Defer runtime, orchestration, storage, marketplace, and hosted features. |

## v0.3.x - Trust and Observability

Goal:
Make Heli visibly loaded, inspectable, and testable in supported agent hosts.

Rationale:
Users need to know whether Heli is merely installed, whether the extension loaded, whether workspace harness state was detected, and whether hooks actually ran. The v0.3.2 hook probes showed that trust improves when users can prove hook activity directly instead of inferring it from quiet behavior.

Scope:

- Keep improving status messages, hook inspection, and smoke validation.
- Keep `/heli-hooks` as the user-facing inspection surface.
- Preserve `/heli-hooks probe` and `/heli-hooks test-guard` as opt-in, one-shot observability probes.
- Keep package-only behavior separate from workspace-installed behavior.
- Keep validation scripts small and local.

Non-goals:

- No new agent runtime.
- No hosted dashboard.
- No database.
- No new dependency.
- No change to normal hook behavior.

Deliverables:

- Clear startup signal for package and workspace state.
- `/hh-status` and `/heli-hooks` outputs that explain active state.
- Smoke tests that prove event registration, command registration, prompt canary behavior, and guard canary behavior.
- Documentation that explains what each observable signal proves and what it does not prove.

Acceptance criteria:

- A user can distinguish extension-loaded, session-start-ran, workspace-active, prompt-injection-active, and tool-guard-active states.
- Probe canaries are opt-in and one-shot.
- Normal prompts do not contain probe canaries.
- Dangerous guard test commands are intercepted before execution.
- AXGA and Pi package smoke tests continue to load cleanly.

Risks:

- More status text could become noisy.
- Host APIs may differ in how command arguments are passed.
- Hook behavior can be hard to verify in non-interactive test environments.

## v0.3.3 - Status, Profile Lint, and Report Gates

Goal:
Make Heli easier to inspect and harder to use ambiguously.

Rationale:
Heli is most useful when the user can prove what is active before work starts and when reports fail visibly if they omit important evidence. Status and linting are the smallest next step before introducing policy overlays.

Scope:

- Improve `/hh-status`.
- Show Heli version.
- Show workspace detection.
- Show target repo if known.
- Show active profile.
- Show active policies if any.
- Show active hooks.
- Show recent hook activity.
- Show skill count.
- Show guard/probe state.
- Add profile and report lint behavior through `/heli-validate` or an internal validation procedure.
- Validate required profile and report sections.
- Warn when a profile mixes repo facts with prescriptive policy.
- Warn when a report omits files changed, commands run, validation, deviations, risks, or next steps.

Non-goals:

- No policy overlay engine yet.
- No multi-repo target enforcement yet.
- No database.
- No dashboard.

Deliverables:

- `/hh-status` output contract.
- Profile lint checklist.
- Report lint checklist.
- Updated templates for profiles and reports if needed.
- Smoke coverage for status output and lint entry points where practical.

Acceptance criteria:

- User can screenshot `/hh-status` and prove what is active.
- Missing report sections are detected.
- Missing profile taxonomy sections are detected.
- Profile lint warns when facts and policy are mixed.
- Normal runtime behavior remains unchanged.

Risks:

- Linting can become noisy if early templates are too strict.
- Older installed workspaces may lack new sections.
- Adapters may expose different amounts of runtime state.

## v0.4.0 - Policy Overlays

Goal:
Separate repo facts from team engineering rules.

Rationale:
Experiments showed that descriptive profiles improve awareness but do not reliably stop agents from copying weak existing patterns. Prescriptive engineering directives and policy overlays produce stronger implementation quality because they tell the agent what to do, what not to do, and when approval is required.

Scope:

- Add `.heli-harness/policies/`.
- Suggested policy files:
  - `engineering.md`
  - `security.md`
  - `release.md`
  - `testing.md`
- Add `.heli-harness/safety/`.
- Suggested safety files:
  - `command-tiers.md`
  - `command-rules.json`
  - `secrets.md`
- Define statement classes:
  - Required
  - Recommended
  - Forbidden
  - Requires approval
  - Exception
- Update docs and templates so repo profiles stay descriptive and policies become prescriptive.
- Update status and report requirements to show loaded policy overlays and policy deviations.

Non-goals:

- Do not compile policies into every external tool yet.
- Do not build a full rule engine beyond lightweight markdown and JSON validation.
- Do not add central storage.

Deliverables:

- Policy directory template.
- Safety directory template.
- Policy statement class format.
- Report section for policy deviations.
- Status output showing loaded policy overlays.
- Validation that flags profiles treating observed tech debt as recommended convention.

Acceptance criteria:

- A repo profile can say "this exists."
- A policy file can say "do this" or "do not do this."
- Reports must declare policy deviations with justification.
- Heli does not silently treat existing tech debt as recommended convention.

Risks:

- Policy language can become too vague to validate.
- JSON sidecars can drift from markdown policy if ownership is unclear.
- Teams may overuse policies for preferences that should remain local conventions.

## v0.4.1 - Profile Taxonomy and Tech-Debt Classification

Goal:
Improve auto-generated profiles so agents do not copy weak existing patterns blindly.

Rationale:
Existing repo patterns are not always recommended patterns. Auto-generated profiles must distinguish observed implementation facts from recommended conventions, known tech debt, forbidden patterns, required policy, and justified exceptions.

Scope:

- Require profile taxonomy sections:
  - Observed stack
  - Existing patterns
  - Recommended conventions
  - Known tech debt
  - Forbidden patterns
  - Command tiers
  - Repo risks
  - Exceptions
- Profile generation should classify:
  - observed pattern
  - recommended convention
  - tech debt
  - forbidden pattern
  - safer alternative
  - evidence path
- Update lint rules to warn when all observed patterns are treated as conventions.
- Update templates with examples for risky existing patterns.

Non-goals:

- No automatic architecture rewrite.
- No attempt to prove every pattern is good or bad.
- No broad static analyzer.
- No migration support.

Deliverables:

- Updated repo profile template.
- Profile lint expectations for taxonomy.
- Example classifications for observed patterns and known tech debt.
- Guidance for evidence paths.

Acceptance criteria:

- Existing risky code patterns are labeled as tech debt when appropriate.
- New work receives explicit guidance not to copy tech debt.
- Profile entries include evidence paths.
- Profile lint fails or warns if all observed patterns are treated as conventions.

Risks:

- Classification can be subjective.
- Generated profiles may over-label unfamiliar patterns as tech debt.
- Evidence paths can become stale after refactors.

Example:
If a repo has `useGemini.ts` using raw frontend fetch and hardcoded API keys, classify it as an existing pattern and known tech debt. State that new provider integrations must not copy it blindly. Suggest safer alternatives, such as a native HTTP boundary or a backend boundary where applicable, and include the evidence path.

## v0.4.2 - Multi-Repo Targeting and Workspace Index

Goal:
Prevent wrong-repo and wrong-directory edits in parent workspaces.

Rationale:
Heli is designed for parent workspaces that may contain many repos. The harness must make target identity explicit so agents do not silently inspect or write to the wrong git root.

Scope:

- Add `.heli-harness/workspace/index.json`.
- Add workspace docs for:
  - known repos
  - git roots
  - profile mappings
  - default target repo if any
- Add target state:
  - target repo
  - target git root
  - writes allowed under
  - active profile
- Add `/heli-target` concept if supported by tool adapters:
  - list
  - set
  - show
- Require target repo selection when multiple repos are present and write workflows are requested.
- Warn or block writes outside the selected target root where hooks support it.

Non-goals:

- No multi-agent orchestration.
- No cross-repo dependency graph solver.
- No monorepo build planner.

Deliverables:

- Workspace index schema.
- Target state template.
- Status output for target repo and git root.
- Report fields for target repo and git root.
- Adapter notes for write guard support.

Acceptance criteria:

- `/hh-status` shows target repo.
- Reports record target repo and git root.
- Write tasks in a multi-repo workspace cannot proceed silently without target resolution.
- Out-of-target writes are flagged or blocked where hooks support it.

Risks:

- Some tools may not expose file-write hooks.
- Symlinks and generated paths can complicate write-root checks.
- Parent workspaces may intentionally contain nested repos.

## v0.5.0 - Governance Benchmark Pack (Implemented)

Goal:
Measure Heli as a governance layer, not just a prompt template.

Rationale:
Heli should be evaluated by whether it improves workflow discipline, traceability, policy compliance, and safety behavior. Implementation success alone is not enough because an agent can ship working code while still editing the wrong repo, skipping approval, omitting validation, or copying known tech debt.

Scope:

- Add benchmark docs and task templates.
- Capture:
  - first-attempt acceptance
  - human interventions
  - unexpected file edits
  - wrong-repo edits
  - unsafe command attempts prevented
  - report completeness
  - policy-deviation rate
  - validation coverage
  - architecture decision quality
  - token/time overhead
- Include OpenMesh-style A/B experiment template:
  - no harness
  - Heli descriptive profile
  - Heli policy overlay
  - same task and model where possible
- Add scoring rubrics.

Non-goals:

- No automatic benchmark dashboard.
- No hosted telemetry.
- No vendor-specific benchmark lock-in.

Deliverables:

- Benchmark task template.
- Experiment setup guide.
- Report scoring rubric.
- Implementation quality rubric.
- Governance behavior rubric.
- Example result table.

Acceptance criteria:

- Benchmark can be rerun.
- Results are comparable across conditions.
- Report quality is scored separately from implementation quality.
- Governance behavior is measurable.

Risks:

- Model behavior changes can make comparisons noisy.
- Human reviewers may score reports inconsistently.
- Token and time overhead may vary by host tool.

## v0.5.1 - Self-Consistency and Dogfood Cleanup (Implemented)

Goal:
Make the current Heli-Harness repo self-consistent, lint-clean, and dogfood-ready before expanding adapter implementation or running the benchmark matrix.

Scope:

- Align current install docs, adapter docs, and user-facing extension strings with the latest stable version.
- Add a valid active `heli-harness` repo profile.
- Make shipped workspace defaults point at the repo itself for dogfood validation.
- Move unrelated active profiles to example filenames.
- Make policy exception sections explicit.
- Label benchmark examples as illustrative unless backed by measured run logs.
- Extend release validation for shipped defaults and current-doc coverage.

Non-goals:

- No Claude/Codex/OpenCode adapter implementation.
- No benchmark matrix runs.
- No roadmap reduction.

Acceptance criteria:

- `npm run check` passes.
- `node scripts/validate-release.mjs` catches stale current install examples, stale adapter docs, stale internal install docs, stale extension support strings, invalid active profiles, invalid policy exception blocks, and unlabeled hypothetical benchmark examples.
- Current baseline and latest stable references point to v0.5.1.

## v0.5.2 - Dogfood Lint Hotfix (Implemented)

Goal:
Fix a real Pi/AXGA dogfood lint issue found after v0.5.1: profile documentation files under `.heli-harness/profiles/` were being linted as active repo profiles.

Scope:

- Share active-profile file discovery between status/profile selection and profile lint.
- Ignore `README.md` and `*.example.md` in profile lint.
- Keep real active profiles such as `heli-harness.md` linted.
- Keep invalid active profiles warning in smoke coverage.

Non-goals:

- No tag movement for v0.5.1.
- No Rules-as-Enforcement implementation.
- No change to report-lint absence warnings.

Acceptance criteria:

- `npm run check` passes.
- Pi/AXGA `/heli-validate lint` profile lint checks one active shipped profile and reports no profile warnings for `profiles/README.md`.
- Report absence warnings may remain non-blocking until report semantics are revisited.

## v0.5.3 - Rules-as-Enforcement (Implemented)

Goal:
Make `.heli-harness/safety/command-rules.json` the source of truth for Pi/AXGA command guard behavior without expanding Heli into a full runtime.

Scope:

- Load command rules from workspace or package safety configuration.
- Validate rule schema before runtime use.
- Compile configured `match` strings into runtime matchers.
- Preserve conservative fallback rules when configuration is missing or invalid.
- Add smoke coverage for default rules, custom rules, invalid configs, and fallback blocking.

Non-goals:

- No full command classifier.
- No sandbox.
- No Claude/Codex/OpenCode adapter implementation.
- No benchmark matrix runs.

Acceptance criteria:

- Existing default dangerous commands remain guarded.
- Adding a custom command rule changes runtime guard behavior.
- Invalid `command-rules.json` is detected by smoke/release validation.
- Missing or invalid command-rule config does not silently disable safety.

## v0.5.4 - Safety Classifier Hardening (Implemented)

Goal:
Harden command classification beyond simple configured pattern matching.

Scope:

- Normalize commands before rule matching.
- Preserve `.heli-harness/safety/command-rules.json` as the policy source of truth.
- Detect common publish/release variants, destructive delete variants, shell wrappers, simple chains, shell redirection writes outside the selected target, secret-path writes, secret-like write content, and obvious sensitive reads.
- Keep the classifier local, dependency-free, and best-effort.

Non-goals:

- No sandbox.
- No full shell parser.
- No Claude/Codex/OpenCode adapter implementation.
- No benchmark runner or benchmark matrix runs.

Acceptance criteria:

- `npm run check` passes.
- Smoke tests cover normalized command bypass forms and secret/redirection guards.
- Docs state enforcement depends on host-compatible `tool_call` hooks.

## v0.5.5 - Update Preservation & Tool Coverage (Implemented)

Goal:
Port non-overlapping fixes from PR #1 hard-review findings without breaking v0.5.3 command-rules.json source-of-truth or v0.5.4 classifier architecture.

Scope:

- Preserve local overlays (`profiles/`, `workspace/`, `policies/`, `safety/`) during update alongside existing `state/` preservation.
- Broaden tool guard coverage to command-bearing tools beyond `bash` and file-write tools beyond `write`/`edit`.
- Add backup suffix secret path detection.
- Fix `validate-release.mjs` per-pattern `rg` error handling.
- Make CI whitespace check enforcing.
- Add `smoke:update` coverage.

Non-goals:

- No PR #1 inline command regex patterns (v0.5.4 classifier is superior).
- No `"type": "module"` change (deferred).
- No Claude/Codex/OpenCode adapter implementation.
- No benchmark matrix runs.

Acceptance criteria:

- `npm run check` passes.
- `npm run smoke:update` passes.
- Smoke tests cover tool-agnostic command guard, multi-tool file guard, backup suffix paths, and update preservation.
- Docs explain update overlay preservation behavior.

## v0.5.6 - Classifier Git Global Flags Hotfix (Implemented)

Goal:
Normalize git global flags in the command classifier before rule matching, without breaking v0.5.3 command-rules.json source-of-truth or v0.5.4 classifier architecture.

Scope:

- Add git global flags normalization (`-C`, `-c`) in the command classifier.
- Ensure commands like `git -C repo push` are correctly identified as `git push` for rule matching.
- Add smoke coverage for git global flags normalization.

Non-goals:

- No Claude/Codex/OpenCode adapter implementation.
- No benchmark matrix runs.
- No changes to command-rules.json source-of-truth.
- No adapter wiring verification.

Acceptance criteria:

- `npm run check` passes.
- Smoke tests cover git global flags normalization (`-C`, `-c`, combined forms).
- Commands with git global flags are correctly matched against command rules.

## v0.5.7 - Adapter Wiring Coverage (Implemented)

Goal:
Create verifiable adapter support infrastructure. Answer which adapters exist, which are wired, which are enforced, and which are planned. Ensure claims require evidence.

Scope:

- Add adapter status taxonomy (enforced, wired, documented, planned, unsupported).
- Create `docs/ADAPTER_SUPPORT_MATRIX.md` with honest, evidence-based adapter status.
- Create `.heli-harness/adapters/adapters.json` as machine-readable adapter manifest.
- Add `scripts/verify-adapters.mjs` to validate adapter claims against evidence.
- Integrate adapter verification into `scripts/validate-release.mjs`.
- Add `verify:adapters` npm script.
- Update docs to reference adapter support matrix.
- Classify Pi as `enforced` (has extension, smoke tests, hook guards).
- Classify Codex/Claude/Cursor as `wired` (adapter files exist, install creates pointers, but no runtime enforcement).
- Classify AXGA/Generic as `documented` (docs exist, but no dedicated verification).
- Classify OpenCode/Windsurf/Cline/Gemini/OpenClaw as `planned` (no implementation yet).

Non-goals:

- No Claude/Codex/OpenCode runtime implementation.
- No benchmark matrix runs.
- No changes to command-rules.json source-of-truth.
- No adapter runtime hook implementation.

Acceptance criteria:

- `npm run check` includes adapter wiring validation.
- `npm run verify:adapters` passes.
- Adapter support matrix has evidence for each claimed support level.
- `verify-adapters.mjs` validates adapter manifest schema, evidence file presence, and docs consistency.
- Docs distinguish supported vs. documented vs. planned adapters.
- No overclaims (e.g., claiming "enforced" without smoke tests).

## v0.5.8 - Claude Code Adapter Verification (Implemented)

Goal:
Promote Claude Code from basic `wired` documentation to `verified-wired` adapter support with local smoke evidence, without claiming runtime enforcement.

Rationale:
Claude Code had adapter files and installer pointers, but no dedicated smoke test proving the generated workspace `CLAUDE.md`, settings example, or update-preservation behavior. Claims require evidence, so the adapter status needed a middle tier between file presence and runtime enforcement.

Scope:

- Add `verified-wired` adapter status.
- Improve `.heli-harness/adapters/claude/CLAUDE.md` as the Claude-facing harness entrypoint.
- Validate `.heli-harness/adapters/claude/settings.local.json.example` as JSON.
- Add `scripts/smoke-claude-adapter.mjs`.
- Verify install creates workspace `CLAUDE.md` when absent.
- Verify update preserves user-owned workspace `CLAUDE.md`.
- Add Claude smoke to `npm run check` and release validation.
- Update adapter manifest and support matrix with Claude evidence.
- Include the local Windows smoke portability hotfix commit in this release.

Non-goals:

- No Claude runtime hook enforcement claim.
- No Codex/OpenCode/Cursor real adapter implementation.
- No benchmark matrix runs.
- No roadmap scope reduction.

Acceptance criteria:

- `npm run check` passes.
- `node scripts/smoke-claude-adapter.mjs` passes.
- Claude status is `verified-wired`, not `enforced`.
- Pi remains the only `enforced` adapter.
- Support matrix and manifest explain that Claude runtime enforcement is not proven.

Risks:

- Claude Code hook support may change; runtime blocking must be validated in a later milestone before any enforcement claim.
- Instruction/pointer wiring still relies on Claude Code loading and following workspace instructions.

## v0.5.10 - Native Plugin Parity (Implemented)

Goal:
Move beyond pointer-only Claude/Codex adapters by shipping native plugin artifacts where official/reference evidence supports them.

Implemented:

- Ponytail parity audit in `docs/PONYTAIL_PARITY_AUDIT.md`.
- Claude Code plugin artifacts in `.heli-harness/adapters/claude-plugin/`.
- Codex plugin artifacts in `.heli-harness/adapters/codex-plugin/`.
- Plugin smoke tests for manifests, hook configs, hook script parsing, synthetic SessionStart context, and synthetic PreToolUse deny decisions.
- Adapter taxonomy statuses `verified-plugin-wired` and `plugin-wired`.

Status result:

- Claude Code: `verified-plugin-wired`, not `enforced`.
- Codex: `verified-plugin-wired`, not `enforced`.
- Pi: still the only `enforced` adapter.

Known limitation:
No live Claude Code or Codex runtime hook execution/trust flow was completed in this release, so runtime enforcement remains unclaimed.

## v0.5.9 - Codex Governance Workflow (Implemented)

Goal:
Promote Codex from basic `wired` documentation to `verified-wired` adapter support with local smoke evidence, without claiming runtime enforcement.

Rationale:
Codex had adapter files and installer pointers, but no dedicated smoke test proving the generated workspace `AGENTS.md`, Codex governance instructions, manifest evidence, support matrix claims, or update-preservation behavior. Claims require evidence, so Codex needed the same verified middle tier as Claude Code.

Scope:

- Reuse the `verified-wired` adapter status from v0.5.8.
- Improve `.heli-harness/adapters/codex/AGENTS.md` as the Codex-facing governance entrypoint.
- Improve `.heli-harness/adapters/codex/README.md` with workflow and limitation guidance.
- Add `scripts/smoke-codex-adapter.mjs`.
- Verify install creates workspace `AGENTS.md` when absent.
- Verify update preserves user-owned workspace `AGENTS.md`.
- Add Codex smoke to `npm run check` and release validation.
- Update adapter manifest and support matrix with Codex evidence.

Non-goals:

- No Codex runtime hook enforcement claim.
- No OpenCode/Cursor real adapter implementation.
- No benchmark matrix runs.
- No roadmap scope reduction.

Acceptance criteria:

- `npm run check` passes.
- `node scripts/smoke-codex-adapter.mjs` passes.
- Codex status is `verified-wired`, not `enforced`.
- Pi remains the only `enforced` adapter.
- Support matrix and manifest explain that Codex runtime enforcement is not proven.

Risks:

- Codex host enforcement capabilities may change; runtime blocking must be validated in a later milestone before any enforcement claim.
- Instruction/pointer wiring still relies on Codex loading and following workspace `AGENTS.md`.

## v0.5.11 - Live Runtime Verification (Implemented)

Goal:
Close the v0.5.10 gap by proving plugin hooks fire in a real host session, instead of only synthetic/local smoke coverage.

Rationale:
v0.5.10 shipped native plugin artifacts and local smoke tests but explicitly could not claim live runtime enforcement for Claude Code or Codex. Reviewing that gap surfaced a real defect: Heli shipped no Codex plugin marketplace manifest, so `codex plugin marketplace add` could not recognize the codex-plugin directory at all. Claims require evidence, so this milestone gets real evidence instead of closing the gap on paper.

Scope:

- Add `.heli-harness/adapters/codex-plugin/.agents/plugins/marketplace.json` so the shipped Codex plugin directory is a valid, installable marketplace.
- Add `scripts/live-verify-claude-plugin.mjs`: copies the Claude plugin into an isolated temp directory and drives a real `claude -p` session (`--plugin-dir`, throwaway git repo, `--dangerously-skip-permissions`) that attempts `git push` and a `.env` write, then asserts the session's own `permission_denials` result contains both denials.
- Add `scripts/live-verify-codex-plugin-install.mjs`: drives the real `codex` CLI (isolated `CODEX_HOME`) through `plugin marketplace add` and `plugin add`, then confirms `plugin list` reports the plugin installed and enabled.
- Promote Claude Code from `verified-plugin-wired` to `enforced`, backed by the live-verify script.
- Keep Codex at `verified-plugin-wired`: install/trust is live-verified, but PreToolUse hook firing during a real model turn is not yet proven (blocked on Codex account usage quota at verification time).
- Add both live-verify scripts as opt-in npm scripts (`live-verify:claude-plugin`, `live-verify:codex-plugin-install`), not part of `npm run check`, since they require a real installed CLI and make real API calls.

Non-goals:

- No live Codex PreToolUse hook-fire proof yet (tracked as follow-up once quota is available).
- No OpenCode/Cursor/Windsurf/Cline/Gemini/OpenClaw plugin implementation.
- No plugin marketplace publication.
- No change to command-rules.json source-of-truth or the classifier architecture.

Deliverables:

- `.heli-harness/adapters/codex-plugin/.agents/plugins/marketplace.json`.
- `scripts/live-verify-claude-plugin.mjs`, `scripts/live-verify-codex-plugin-install.mjs`.
- Updated adapter manifest, support matrix, and README reflecting Claude Code `enforced` status and Codex's live install/trust evidence.

Acceptance criteria:

- `npm run check` passes.
- `node scripts/live-verify-claude-plugin.mjs` passes against a real, locally installed Claude Code CLI.
- `node scripts/live-verify-codex-plugin-install.mjs` passes against a real, locally installed Codex CLI.
- Claude Code status is `enforced` with live-session evidence; Codex remains `verified-plugin-wired` with an honest, quota-blocked limitation recorded.
- Pi and Claude Code are the `enforced` adapters; no adapter claims enforcement without runtime evidence.

Risks:

- Live-verify scripts depend on real CLI behavior (flag names, output shape) that may change between Claude Code / Codex releases.
- The Claude Code live proof used `--plugin-dir` session loading, not the marketplace-installed-and-trusted flow (`claude plugin install`); that path still needs separate verification.
- The Codex PreToolUse hook-fire proof remains open until Codex usage quota is available; status must not be silently upgraded without it.

## Post-v0.5 Stabilization

Goal:
Stabilize schemas, governance contracts, and benchmark formats before considering expansion.

Rationale:
Heli should not become heavy before its local governance contracts are clear. Deferring runtime, marketplace, central storage, and orchestration work protects the lightweight, inspectable model.

Scope:

- Revisit plugin packaging only after policy and profile schemas stabilize.
- Revisit optional memory integrations only after policy authority is separated from remembered context.
- Revisit dashboards only after report formats and benchmark metrics are stable.
- Revisit deeper adapter integrations only after target-state and safety contracts are clear.

Non-goals:

- No central hosted service.
- No vector memory platform.
- No multi-agent orchestrator.
- No marketplace before schemas are stable.

Deliverables:

- Parking-lot issues or docs for deferred ideas.
- Decision records before starting any heavy architecture shift.
- Explicit acceptance criteria for moving an item out of "later."

Acceptance criteria:

- Later work does not block v0.3.x through v0.5.0 governance milestones.
- Any proposed expansion explains why markdown-first local files are no longer enough.
- Any proposed expansion preserves inspectability and adapter portability.

Risks:

- Users may ask for heavier features before the core model is stable.
- Integrations can introduce hidden state that weakens trust.
- A marketplace can freeze unstable schemas too early.

## Non-Goals

- Do not turn Heli into an agent runtime.
- Do not make Heli a planner or task execution engine.
- Do not add a central database.
- Do not make memory the source of required policy.
- Do not require hosted telemetry.
- Do not replace host-specific sandboxing, approval, or permission systems.
- Do not treat auto-generated descriptive profiles as authoritative policy.
- Do not add dependencies unless a small local file format cannot satisfy the requirement.

## Evaluation Metrics

- Status clarity: can users prove what Heli loaded and which hooks are active?
- Profile quality: are facts, recommendations, policy, risks, and tech debt separated?
- Policy compliance: are deviations explicit and justified?
- Safety effectiveness: are risky commands surfaced, blocked, or approved according to tier?
- Report completeness: do reports list files changed, commands run, validation, deviations, risks, and next steps?
- Target accuracy: did the agent work in the intended repo and git root?
- Human intervention rate: how often did the user have to correct process failures?
- First-attempt acceptance: did the first implementation meet policy and quality expectations?
- Validation coverage: were appropriate checks run and recorded?
- Overhead: how much time and token cost did governance add?

## Contribution Guidance for Roadmap Items

Each roadmap proposal must include:

- Goal
- Rationale
- Scope
- Non-goals
- Deliverables
- Acceptance criteria
- Risks
- Validation plan
- Rollback or removal plan if the feature adds runtime behavior

Documentation-only proposals should still explain how future contributors can verify that the docs remain true. Runtime proposals must include smoke tests or self-checks that prove the behavior without requiring a live hosted service.
