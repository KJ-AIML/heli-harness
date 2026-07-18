---
name: concurrent-upgrade
description: Use when an old Heli workspace still uses shared state/current-task.md, multiple agents may write, heli update left mode legacy, or you need to migrate to concurrent tasks/sessions/leases without a full workspace clone.
---

# concurrent-upgrade

## Problem

**New installs (v0.5.27+) default to concurrent.** Older workspaces may still be legacy after `heli update` (update never flips mode):

- One shared `.heli-harness/state/current-task.md`
- Two agents edit it → race / last-writer swap
- SessionStart says `Workspace mode: legacy`

## When to migrate

- Two or more agents/sessions may write in the same parent workspace
- You were about to clone a whole workspace only for isolation
- `heli status` shows `Workspace mode: legacy` and incomplete shared task state

## Upgrade steps

1. Confirm parent workspace root (directory that contains `.heli-harness/`).
2. Check mode:
   ```bash
   heli status
   # Workspace mode: legacy | concurrent
   ```
3. Migrate existing singular state **or** create a fresh task:
   ```bash
   heli task migrate-legacy --id <task-id>
   # or
   heli task create <task-id> --work-item <key> --repo <name>
   ```
4. Claim write lease and bind session:
   ```bash
   heli task claim <task-id> --mode write
   # export HELI_SESSION_ID=... from the command output
   ```
5. Prefer a **separate git worktree** per parallel task.
6. Second agent: different task id + claim + own `HELI_SESSION_ID` (or review/observe mode without write).
7. Authoritative state is `.heli-harness/tasks/<task-id>/` — do not treat shared `state/current-task.md` as source of truth after concurrent mode is on.

## Rules

- Do not invent lease ownership in prose; use CLI claim/release/takeover.
- YOLO never bypasses write ownership in concurrent mode.
- If plugin SessionStart is absent, concurrent **file layout** may exist but hooks may be advisory only — still use claim + session id so the next enforced host works.
- `heli update` again later will preserve concurrent mode and task stores; it will not create them for you.

## Output after upgrade

```text
Mode: concurrent
Task id:
Session id:
Write lease: yes|no
Worktree:
Other active tasks:
```
