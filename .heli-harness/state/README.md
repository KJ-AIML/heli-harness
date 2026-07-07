# Harness State

This directory holds shared parent-workspace state.

- `current-task.md`: active task state. Update before non-trivial edits.
- `plan.md`: optional step-by-step plan ledger for tasks with 3+ discrete steps (see `.heli-harness/templates/plan.md`). Each step's `Status`/`Evidence`/`Attempts` carries across CLI switches — a compact rollup of the current step is surfaced automatically in session-start context across Claude, Codex, and Pi/AXGA, and 2+ failed attempts on that step blocks further edits until it's updated, mirroring `current-task.md`'s own stuck-task gate.
- `decisions.md`: durable harness-level decisions. The last 5 sections are surfaced automatically in session-start context across Claude, Codex, and Pi/AXGA.
- `runs/`: generated run logs.
- `reports/`: generated reports.

Do not fill `runs/` or `reports/` with fake data.

