# Heli-Harness Phase 3 — Simplify Implementation Plan

> **For agentic workers:** this is a task-level plan. Before executing a task, expand it into bite-sized TDD steps against the then-current code with superpowers:writing-plans, then execute with superpowers:subagent-driven-development (or superpowers:executing-plans). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the repository and the concept count down to what the governance kernel needs: stop committing generated copies, move optional features out of the core, consolidate skills, keep one version source, and make docs and the support matrix evidence-driven.

**Architecture:** Canonical sources stay where they are; generated plugin bundles are produced at pack/release time. Optional features (cloud sync, ACP proxy, benchmarks, learning) move behind an `experimental` boundary or into separate packages. Docs derive facts (version, support levels) from single sources instead of hand-stamped copies.

**Tech Stack:** Node.js ≥20 ES modules, zero npm dependencies, `node:test`, GitHub Actions release workflow.

**Spec:** `docs/reports/2026-09-30-heli-full-review.md` (Improvement plan → Phase 3; scorecard rows "Architecture & simplicity" and "Docs & onboarding").

**Prerequisite:** Phases 1 and 2 merged (so the kernel shape being simplified is final).

## Global Constraints

- Everything from Phase 1's Global Constraints.
- No behavior change to enforcement: the Phase 1 parity suite and all command/protected-path tests must pass unchanged before and after each task.
- Distribution must keep working for every host channel: npm/GitHub global install, the Codex Git marketplace, the Claude directory marketplace, embedded `heli install`.

## Review Focus

1. Every host install path still finds a complete plugin after generated copies stop being committed.
2. Removing or relocating optional features leaves no dangling imports, CLI commands, or docs.
3. Merged skills keep every trigger phrase and command reference of the skills they replace.
4. The release flow produces the same artifacts from one version number.
5. Docs never claim a support level without a recorded evidence entry.

---

### Task 1: Build plugin bundles at pack/release time

**Files:** `scripts/sync-plugin-shared.mjs`, `scripts/sync-plugin-skills.mjs`, `scripts/sync-workspace-cli.mjs`, `package.json` (`prepack`), `.github/workflows/release.yml`, `.gitignore`.

- [ ] Decide the Codex Git-marketplace source (it installs straight from the repo): publish generated plugins to a release branch/tag or keep only the Codex plugin committed; record the decision in an ADR.
- [ ] Generate every other plugin's `shared/` and `skills/` copies and `.heli-harness/cli|protocol|heli.mjs` in `prepack` and in CI; stop committing them (~410 files).
- Acceptance: `npm pack` contents are unchanged in behavior; clean-checkout installs for each host pass their smokes.

### Task 2: Move optional features out of the core

**Files:** `cloud/`, `lib/cli/cloud*.mjs`, `lib/acp/`, `bin/heli-acp-proxy.mjs`, `benchmarks/`, `lib/benchmark/`, `lib/learning/`, `package.json` `files`.

- [ ] Put cloud sync, ACP proxy, benchmarks and learning behind an `experimental` namespace (`heli experimental cloud …`) or separate packages; drop `assets/` and `scripts/` from the published `files`.
- [ ] Merge `repairHost` into `updateHost`; remove the 13 unused exports found in the review; replace the `lib/concurrency/*.mjs` one-line shims with package.json `"imports"` aliases.
- Acceptance: core package size and file count reported before/after; no dangling references (grep + `node --check`).

### Task 3: Consolidate skills (30 → about 12)

**Files:** `.heli-harness/skills/**`, `scripts/sync-plugin-skills.mjs`, skill smokes.

- [ ] Merge overlapping groups (`audit`/`heli-review`/`heli-audit`, `impact`/`heli-impact`, `flow`/`using-heli-skills`, …).
- [ ] Remove references to `.heli-harness/HARNESS.md` from skills used in linked projects; reconcile `flow` (requires `current-task.md`) with the optional-task model.
- Acceptance: a trigger-phrase table shows every old trigger mapped to a remaining skill; skill smokes pass.

### Task 4: One version source

**Files:** `scripts/release.mjs`, `scripts/lib/release-version.mjs`, `scripts/validate-doc-currentness.mjs`, docs with version stamps.

- [ ] Read the version only from `package.json` at runtime and in validators; drop hand-stamped "Current release" lines or generate them.
- Acceptance: a release bump touches one file (plus CHANGELOG); the doc-currency validator derives the current series itself.

### Task 5: Evidence-driven docs

**Files:** `README.md`, `docs/ADAPTER_SUPPORT_MATRIX.md`, new `docs/evidence/*.json`, a generator/validator script.

- [ ] Commit recorded live-verify results as evidence entries; generate or validate matrix cells from them.
- [ ] README: a short "what gets blocked" demo and a plain-language quick start; move jargon into the architecture docs.
- Acceptance: CI fails if a matrix cell claims "Yes"/"Live-host proof" without an evidence entry.

### Task 6: Split the largest modules

**Files:** `concurrency/resolve.mjs` (`resolveExecutionContext`, ~225 lines), `concurrency/diagnosis.mjs` (~900 lines), `extensions/pi-extension.js` (~1,800 lines, after Phase 1 Task 1), `command-policy.mjs`, `protected-paths.mjs`.

- [ ] Split by responsibility with no behavior change, keeping the parity and policy suites green.
- Acceptance: no module over ~600 lines without a recorded reason; coverage unchanged or higher.
