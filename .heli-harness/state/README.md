# Harness State

This directory holds shared parent-workspace state.

- `current-task.md`: active task state. Update before non-trivial edits. Its `Step count` field is self-reported (0 if the task isn't naturally step-shaped) — when it's 3+ but `Plan:` is still `n/a`, session-start context warns across all three adapters, since that's the exact case where a task obviously needed `plan.md` and never got one.
- `plan.md`: optional step-by-step plan ledger for tasks with 3+ discrete steps (see `.heli-harness/templates/plan.md`). Each step's `Status`/`Evidence`/`Attempts` carries across CLI switches — a compact rollup of the current step is surfaced automatically in session-start context across Claude, Codex, and Pi/AXGA, and 2+ failed attempts on that step blocks further edits until it's updated, mirroring `current-task.md`'s own stuck-task gate.
- `decisions.md`: durable harness-level decisions. The last 5 sections are surfaced automatically in session-start context across Claude, Codex, and Pi/AXGA.
- `runs/`: generated run logs.
- `reports/`: generated reports.

Do not fill `runs/` or `reports/` with fake data.

When the same verification facts (test counts, version numbers, coverage figures) would otherwise get hand-retyped into more than one of `current-task.md`, `plan.md`, and `decisions.md`, reference one canonical location (e.g. "see current-task.md's Planned verification output for the full count") instead of restating the numbers again. Retyping the same facts by hand in multiple places is a real, undetectable drift risk, not just redundant text — nothing catches it if one copy silently goes stale or gets a digit wrong while the others don't.

