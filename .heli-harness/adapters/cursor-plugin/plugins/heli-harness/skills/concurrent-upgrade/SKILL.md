---
name: concurrent-upgrade
description: Use only for an embedded compatibility workspace that still has shared legacy task state and needs migration to the embedded concurrent task/session/lease layout. Linked v0.10 projects use resource-scoped authority instead.
---

# concurrent-upgrade

## Scope

This skill is **embedded compatibility only**.

Do not use it as the authority model for a linked v0.10 project. Linked projects use project binding plus execution-local resource authority.

## Problem

An older embedded workspace may still use one shared `.heli-harness/state/current-task.md`:

- two agents can race on the same shared state;
- session context may report `Workspace mode: legacy`;
- embedded task/session/lease isolation has not been initialized.

## When to migrate

Use this skill when all of the following are true:

- the project is intentionally using the embedded `.heli-harness/` layout;
- `heli status` reports embedded legacy mode;
- multiple agents/sessions may write or durable compatibility task isolation is required.

If `.heli/workspace.json` exists, stop and use linked resource authority instead.

## Upgrade steps

1. Confirm the embedded workspace root.
2. Check mode:
   ```bash
   heli status
   ```
3. Migrate singular compatibility state or create a fresh compatibility task:
   ```bash
   heli task migrate-legacy --id <task-id>
   # or
   heli task create <task-id> --work-item <key> --repo <name>
   ```
4. Claim compatibility write authority and bind the session:
   ```bash
   heli task claim <task-id> --mode write
   # export HELI_SESSION_ID=... from command output
   ```
5. Prefer a separate git worktree per parallel task.
6. Use distinct task/session identity for a second writer or keep it review/observe only.
7. After concurrent mode is active, task-local state under `.heli-harness/tasks/<task-id>/` is authoritative for this embedded compatibility workflow; shared `state/current-task.md` is not.

## Rules

- Do not invent ownership in prose.
- YOLO does not bypass compatibility write ownership.
- Hook/plugin absence means enforcement may be advisory, but state transitions should still use the CLI.
- Future `heli update` preserves embedded compatibility state; it does not convert the workspace into linked v0.10 topology.

## Output after upgrade

```text
Layout: embedded compatibility
Mode: concurrent
Task id:
Session id:
Compatibility write authority: yes|no
Worktree:
Other active tasks:
```
