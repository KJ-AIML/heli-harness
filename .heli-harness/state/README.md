# Harness State

This directory holds shared parent-workspace state.

- `current-task.md`: active task state. Update before non-trivial edits.
- `decisions.md`: durable harness-level decisions. The last 5 sections are surfaced automatically in session-start context across Claude, Codex, and Pi/AXGA.
- `runs/`: generated run logs.
- `reports/`: generated reports.

Do not fill `runs/` or `reports/` with fake data.

