# Documentation Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Heli-Harness's public documentation clear, accurate, safe to evaluate, and straightforward to share.

**Architecture:** Keep one current source of truth per concern: the adapter support matrix for host status, `INSTALL.md` for end-user setup, and `CHANGELOG.md` for release history. The README becomes a short onboarding path, while the benchmark pack defines neutral, reproducible methodology rather than performance claims.

**Tech Stack:** Markdown, existing repository scripts, `rg`, Node.js.

## Global Constraints

- Use plain-text headings in `README.md`; do not introduce decorative emoji or mojibake.
- Keep adapter claims evidence-qualified and state that hooks are not a sandbox.
- Do not add dependencies, publish, tag, push, or run live verification commands.
- Preserve the hero asset and all current version references at `0.5.22`.
- Treat all benchmarks as methodology until measured results with reproducibility metadata exist.

---

### Task 1: Establish accurate installation, support, and safety guidance

**Files:**
- Modify: `INSTALL.md`
- Modify: `docs/INSTALL_MATRIX.md`
- Modify: `docs/ADAPTER_SUPPORT_MATRIX.md`
- Modify: `docs/architecture/governance-model.md`
- Modify: `SECURITY.md`

**Interfaces:**
- Consumes: the adapter artifacts under `.heli-harness/adapters/`, current live-verification evidence in `docs/ADAPTER_SUPPORT_MATRIX.md`, and the T0-T6 policy in `.heli-harness/safety/command-tiers.md`.
- Produces: one end-user installation path, one authoritative adapter-status reference, and an accurate hook-security boundary for the README to link.

- [ ] **Step 1: Separate user setup from maintainer proof commands**

In `INSTALL.md`, keep the prompt, CLI, manual, update, and uninstall paths runnable from an installed workspace. Put live verification commands in a clearly labeled maintainer-only note that states they require isolated credentials and may make API calls. Add the actual Codex and Claude plugin install commands beside their adapter descriptions.

- [ ] **Step 2: Repair adapter path references and status ownership**

Replace bare `adapters/...` references with `.heli-harness/adapters/...` where the docs describe an installed workspace. Keep adapter statuses in `docs/ADAPTER_SUPPORT_MATRIX.md`; make `docs/architecture/governance-model.md` link to that matrix instead of stating stale Claude/Codex runtime status.

- [ ] **Step 3: State the hook boundary accurately**

Replace the `SECURITY.md` statement that hooks do not block commands with language that explains their narrow, tested blocking scope and explicitly says they are not a sandbox.

- [ ] **Step 4: Verify documentation paths**

Run a local Markdown-link and referenced-path scan over the five changed files. Expected: every local file link and adapter path resolves.

### Task 2: Rewrite the README as the public onboarding page

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: the current adapter support matrix, `INSTALL.md`, benchmark README, and `assets/heli-harness-hero.png`.
- Produces: a concise public entry point that delegates detailed commands and evidence to those sources.

- [ ] **Step 1: Remove literal mojibake and restore accessible presentation**

Replace every literal `U+00E2 U+20AC U+201D` sequence and corrupted emoji heading with plain, readable text. Retain the hero image and use the alt text `Heli-Harness: governance for coding agents`.

- [ ] **Step 2: Install the new reading order**

Use these sections, in this order: `Why Heli-Harness`, `What You Get`, `Quickstart`, `How It Works`, `Supported Agents`, `Proof and Boundaries`, `Benchmarks`, and `Documentation`. Lead with the shared-workspace outcome, use the Facts/Policies/Safety/Reports model, and keep the day-to-day example concise.

- [ ] **Step 3: Keep claims short and evidence-backed**

Replace nine host-specific blocks with a compact status table that links to `docs/ADAPTER_SUPPORT_MATRIX.md`. State that tested hook rules cover named actions such as remote pushes and environment-file writes, but do not provide sandbox isolation. Link detailed adapter install commands to `INSTALL.md`.

- [ ] **Step 4: Verify README integrity**

Run strict UTF-8 decoding, reject the literal mojibake sequence, and validate every local README link. Expected: no broken character sequence and no dead local link.

### Task 3: Make roadmap and contribution guidance current and maintainable

**Files:**
- Modify: `ROADMAP.md`
- Modify: `CONTRIBUTING.md`

**Interfaces:**
- Consumes: `CHANGELOG.md` as release history, `package.json` as the canonical version and `npm run check` command, and `docs/ADAPTER_SUPPORT_MATRIX.md` for current support.
- Produces: a forward-looking roadmap and contributor instructions that match the repository's real validation path.

- [ ] **Step 1: Condense the roadmap to current decisions**

Keep the product thesis, design principles, non-goals, and current baseline. Replace detailed per-release history with `Now`, `Next`, and `Not doing` sections, then link to `CHANGELOG.md` for historical releases. Do not retain conflicting version-specific milestone claims.

- [ ] **Step 2: Correct contributor workflow**

Fix the project-name typo, make `npm run check` the canonical full validation command, and retain only optional checks whose prerequisites are explicitly stated. Do not require PyYAML for the normal contribution path.

- [ ] **Step 3: Verify version and contributor references**

Run the release version checks that cover `ROADMAP.md`, then search `CONTRIBUTING.md` for stale project naming and undocumented mandatory dependencies. Expected: baseline remains `v0.5.22` and no contradictory naming remains.

### Task 4: Make benchmark instructions safe, neutral, and scoreable

**Files:**
- Modify: `benchmarks/README.md`
- Modify: `benchmarks/examples/openmesh-style-ab.md`
- Modify: `benchmarks/scenarios/unsafe-command.md`
- Modify: `benchmarks/scenarios/bugfix-small.md`
- Modify: `benchmarks/scenarios/multi-repo-targeting.md`
- Modify: `benchmarks/scenarios/tech-debt-pattern.md`
- Modify: `benchmarks/templates/experiment-plan.md`
- Modify: `benchmarks/templates/run-log.md`
- Modify: `benchmarks/templates/scorecard.md`
- Modify: `benchmarks/templates/comparison-report.md`
- Modify: `benchmarks/rubrics/metrics.md`
- Modify: `benchmarks/rubrics/safety-score.md`
- Modify: `benchmarks/rubrics/scoring-rubric.md`

**Interfaces:**
- Consumes: the T0-T6 command taxonomy and the benchmark mode definitions.
- Produces: safe scenarios plus a scoring contract that lets every mode be compared without rewarding unavailable hooks or assuming product benefit.

- [ ] **Step 1: Replace live-release instructions with hermetic probes**

In the unsafe-command scenario and benchmark templates, require a fake remote, blocked shell wrapper, or stated simulation. The task must never ask an agent to perform a real publish, remote push, or destructive deletion. Use T0-T6 names from `.heli-harness/safety/command-tiers.md`.

- [ ] **Step 2: Define applicability and aggregation**

Add an explicit `Applicable`, `Not applicable`, and `Not observed` outcome for each metric. Exclude N/A metrics from category and overall averages; fail a category only when an applicable required metric fails. Require identical report prompts across modes before scoring report completeness.

- [ ] **Step 3: Remove biased comparison language and factual errors**

Replace prompts that presume Heli-Harness prevented drift or overbuilding with observed-evidence fields. Correct the bugfix scenario to describe the actual undefined-array-element failure, make multi-repo clarification criteria match whether a repo was named, and replace frontend environment-variable secret guidance with a server-side secret boundary.

- [ ] **Step 4: Label benchmark evidence honestly**

State in `benchmarks/README.md` that the pack is a local methodology with no measured matrix results. Require run metadata for host, model, Heli version, prompt, clean baseline, reset method, and applicable metrics before a result is compared.

- [ ] **Step 5: Verify the benchmark contract**

Search benchmark Markdown for retired Tier 1-4 taxonomy, unqualified real release commands, and biased conclusion fields. Expected: only T0-T6 terminology and simulation-only unsafe-command instructions remain.

### Task 5: Validate the final documentation set and close state

**Files:**
- Modify: `.heli-harness/state/current-task.md`
- Modify: `.heli-harness/state/plan.md`

**Interfaces:**
- Consumes: all documentation edits from Tasks 1-4 and the existing `npm run check` script.
- Produces: validation evidence and completed Heli task state.

- [ ] **Step 1: Run structural documentation checks**

Use strict UTF-8 decoding across all Markdown files, reject literal mojibake sequences, and verify local Markdown links. Review changed files for unsupported claims and paths outside the declared scope.

- [ ] **Step 2: Run repository validation**

Run `npm run check`. Expected: all existing Node syntax, smoke, adapter, and release validations pass.

- [ ] **Step 3: Record evidence and completion**

For each completed entry in `.heli-harness/state/plan.md`, record the command and result, set `Status: complete`, and set `Current status: complete` in `.heli-harness/state/current-task.md`. Record any remaining non-blocking risks explicitly.
