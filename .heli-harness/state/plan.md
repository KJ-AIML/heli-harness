# Plan: Documentation overhaul

Target repo: heli-harness
Started: 2026-07-10

## Step 1: Align install, support, and safety sources

Files:
- INSTALL.md
- docs/INSTALL_MATRIX.md
- docs/ADAPTER_SUPPORT_MATRIX.md
- docs/architecture/governance-model.md
- SECURITY.md

Verify: local Markdown link/path scan

Status: complete

Evidence: `ed91d2b` and `099a5a1`; Markdown link/path scan passed; `node scripts/smoke-claude-adapter.mjs`, `node scripts/smoke-claude-plugin.mjs`, `node scripts/smoke-codex-adapter.mjs`, and `node scripts/smoke-codex-plugin.mjs` passed; task review approved.

Attempts: 0

## Step 2: Rewrite the public README

Files:
- README.md

Verify: strict UTF-8/mojibake scan and local Markdown link/path scan

Status: complete

Evidence: `2115bce`; strict UTF-8/mojibake scan, 21 local README links, section-order check, and `git diff --check` passed; task review approved.

Attempts: 0

## Step 3: Refresh roadmap and contribution guidance

Files:
- ROADMAP.md
- CONTRIBUTING.md

Verify: release-version check and Markdown review

Status: complete

Evidence: `cb859ae`; `git diff --check` and `node scripts/validate-release.mjs` passed; contributor stale-reference search passed; task review approved.

Attempts: 0

## Step 4: Make benchmark guidance safe and neutral

Files:
- benchmarks/README.md
- benchmarks/examples/openmesh-style-ab.md
- benchmarks/scenarios/*.md
- benchmarks/templates/*.md
- benchmarks/rubrics/*.md

Verify: safety taxonomy search and Markdown review

Status: complete

Evidence: `f4ac3b6` and `d9810aa`; focused safety, neutral-language, taxonomy, metric-map, and N/A aggregation checks passed; task review approved.

Attempts: 1

## Step 5: Validate and close the documentation change

Files:
- .heli-harness/state/current-task.md
- .heli-harness/state/plan.md

Verify: strict UTF-8/mojibake scan, local Markdown link/path scan, npm run check

Status: complete

Evidence: strict UTF-8 decode across all Markdown files passed with no U+FFFD or literal U+00E2 U+20AC U+201D sequence; local Markdown link/path scan passed for 25 changed Markdown files; `git diff --check e11a7bc..HEAD` and working-tree scope review passed; `npm run check` passed. First `npm run check` attempt failed only because the benchmark example label had malformed mojibake and did not match the existing release validator; the label was corrected to the validator-required neutral wording and focused `node scripts/validate-release.mjs` plus the full check passed.

Attempts: 1
