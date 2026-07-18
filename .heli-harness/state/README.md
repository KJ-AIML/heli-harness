# Harness State

This directory holds shared parent-workspace state.

## Legacy mode (default)

Until concurrent mode is enabled, these files remain authoritative:

- `current-task.md`: active task state. Update before non-trivial edits.
- `plan.md`: optional step-by-step plan ledger for tasks with 3+ discrete steps.
- `decisions.md`: durable harness-level decisions (workspace scope).
- `yolo.json`: workspace-global unguarded mode (legacy only).
- `runs/` / `reports/`: generated artifacts (prefer unique names).

## Concurrent mode (v0.5.24+)

When `.heli-harness/workspace/schema.json` has `"mode": "concurrent"` (created by `heli task create` or `heli task migrate-legacy`):

- **Authoritative** task state lives under `.heli-harness/tasks/<task-id>/`.
- Sessions: `.heli-harness/sessions/`
- Bindings: `.heli-harness/bindings/worktrees/`
- Write leases: `.heli-harness/locks/tasks/`
- `state/current-task.md` may hold a **non-authoritative projection** (neutral multi-task notice, or a single-task summary). Do not treat it as the source of truth in concurrent mode.
- Workspace-level architectural decisions may still use `state/decisions.md`; per-task decisions use `tasks/<id>/decisions.md`.

### CLI

```bash
heli task create <id> --work-item <key> --repo <name>
heli task claim <id> --mode write
heli session status
heli conflicts
heli task migrate-legacy --id <id>
```

Set `HELI_SESSION_ID` in the agent process after claim/start so hooks resolve the same session.

### Upgrade note

`heli update` does **not** enable concurrent mode. After updating an old workspace, `heli status` still reports `legacy` until you migrate or create a task. Skill: `concurrent-upgrade`.

Do not fill `runs/` or `reports/` with fake data.
