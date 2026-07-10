# Task 4 Report — Safe, Neutral, Scoreable Benchmarks

## Scope

Updated only the eleven Task 4 benchmark documents and this required task report. Product code and unrelated documentation were not changed. Pre-existing edits to `.heli-harness/state/current-task.md` and `.heli-harness/state/plan.md` were left untouched.

## Changes

- Replaced the retired four-tier labels with T0–T6 terminology tied to the command-tier document.
- Made the unsafe-action scenario hermetic: it requires a fake remote, blocked wrapper, or stated simulation and forbids real remote publication, remote push, and destructive removal.
- Added per-metric Applicable / Not applicable / Not observed outcomes, excludes Not applicable from aggregates, and makes a category fail only for an applicable required-metric failure.
- Added an identical-full-prompt gate before cross-mode report-completeness scoring.
- Replaced assumed-benefit comparison prompts with observed-evidence fields.
- Corrected the bug scenario to the undefined-element access failure, clarified that a named target needs no clarification, and requires a server-side secret boundary.
- Added the local-methodology/no-measured-results statement and required comparison metadata: host, model, Heli version, prompt, clean baseline, reset method, and applicable metrics.

## Validation

- `git diff --check` completed without whitespace errors.
- Focused benchmark searches found no retired four-tier labels or literal unqualified real release, remote-push, or destructive-removal instructions in the updated Task 4 documents.
- Focused searches confirmed T0–T6, outcome labels, identical-prompt gates, the undefined-array-element description, and server-side secret-boundary guidance.
- Reviewed all updated Markdown for heading/table structure and neutral, evidence-based conclusion fields.

## Safety

No release, publication, remote-push, or destructive action was run. Only documentation edits and read-only validation/search commands were used.

## Concern

The repository contains pre-existing state-file modifications outside this task; they are intentionally excluded from the Task 4 commit.

## Review Follow-up

- Added the two planned benchmark documents omitted from the original Task 4 change: the OpenMesh illustrative example and the scoring rubric.
- Rewrote the OpenMesh example as an unscored hypothesis and evidence-recording template. It now uses a server-side secret boundary and makes no predicted outcome, pre-baked score, or mode-based recommendation.
- Added the executable metric-to-category contract, including required-when-applicable status. The scoring rubric now excludes Not applicable categories and metrics from aggregation and does not require them for PASS.

## Review Follow-up Validation

- `git diff --check` completed without whitespace errors.
- Focused searches confirmed the example has no frontend environment-variable or backend-proxy secret guidance, pre-baked score/outcome sections, or production-mode recommendation.
- Focused searches confirmed the metric-to-category/required map and Not applicable aggregation rules, while the existing T0–T6, simulation-only, server-side-boundary, and identical-prompt safeguards remain present.
