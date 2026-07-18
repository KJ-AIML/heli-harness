# Harness State

This directory holds shared parent-workspace state.

## Concurrent mode (default on new installs, v0.5.27+)

New `heli install` seeds `.heli-harness/workspace/schema.json` with `"mode": "concurrent"`.

- **Zero tasks:** single-agent bootstrap — writes are allowed; prefer creating a task before a second agent joins.
- **One or more tasks:** write tools require bound session + write lease (`heli task claim` / `HELI_SESSION_ID`).

When concurrent mode is active:

## Concurrent mode details (v0.5.24+)

When `.heli-harness/workspace/schema.json` has `"mode": "concurrent"` (default install seed, or enabled by `heli task create` / `heli task migrate-legacy`):

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

## Legacy mode (older workspaces)

Workspaces installed before v0.5.27 (or never migrated) may still have `"mode": "legacy"`. Then these files remain authoritative:

- `current-task.md`: active task state (shared — multi-agent races).
- `plan.md`, `decisions.md`, `yolo.json` (workspace-global YOLO in legacy only).
- `runs/` / `reports/`: generated artifacts (prefer unique names).

### Upgrade note

`heli update` does **not** flip legacy → concurrent (preserves in-flight state). New installs default concurrent. Old workspaces: `heli task migrate-legacy --id <id>` or `heli task create` (skill: `concurrent-upgrade`).

Do not fill `runs/` or `reports/` with fake data.
