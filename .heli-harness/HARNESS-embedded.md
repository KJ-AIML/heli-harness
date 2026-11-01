# Heli-Harness: embedded compatibility workspaces

Read this with `HARNESS.md` in a workspace that keeps Heli in `.heli-harness/` (it has no `.heli/workspace.json`). A linked project uses none of it: its tasks, diagnosis and authority live in Heli's execution-local state and are changed through the `heli` CLI.

## Target, profiles and overlays

- In a multi-repo workspace, read `.heli-harness/workspace/index.json` and select a target repo before write workflows begin. `.heli-harness/workspace/target.json` is the active target record when it exists (`heli target set <repo>`; the file itself is protected Heli state).
- Read `.heli-harness/profiles/`, `policies/` and `safety/` overlays when they exist. Before S2/S3 work on a repo with no profile, create one from `.heli-harness/templates/repo-profile.md`, so branch policy, test commands and other project facts become durable instead of verbal-only.
- Repo profiles stay descriptive (team rules belong in policy overlays, command risk in safety overlays). Classify weak existing patterns as tech debt when appropriate, give evidence paths for meaningful claims, and record safer alternatives.
- Advisory lock templates are warnings, not distributed locks.

## Task state

Before non-trivial edits, keep `.heli-harness/state/current-task.md` current (in concurrent mode, the task's own record under `.heli-harness/tasks/<task-id>/`; the shared file is a projection) with: target repo; task; mode; risk tier; plan; step count; files expected to change; dirty files observed; planned verification; relevant skills consulted (or "none applied"); current status; failed attempts count; command friction count (optional); next smallest action; resume card.

A task with 3+ discrete steps records them in `.heli-harness/state/plan.md` (from `.heli-harness/templates/plan.md`) with `Files` and `Verify` per step, before starting. Right after a step's verification passes, fill its `Evidence` (command + result, or commit SHA) and set `Status: complete` before the next step; on a failed verification, increment the step's `Attempts` and record what failed. `current-task.md`'s `Plan:` field points at `plan.md`, or reads `n/a`.

- **Freshness:** record Evidence in the same turn as the verify. Never leave `Next smallest action` or a plan `Status` lagging after a blocking discovery. When strategy shifts, update the plan's `Active strategy` / `Supersedes` so old eras do not look current.
- **Evidence purity:** Evidence holds measured results only. Product-defect hypotheses wait until `verify-premise` confirms them.
- **Resume card:** keep it current after every verify or blocker. For multi-gate S2/S3 operations (smoke, launch, staging), use `.heli-harness/templates/ops-gate-packet.md` and fail closed on typed blockers.
- **Step count** is your honest count of discrete steps (0 if the task is not step-shaped). SessionStart warns when it is 3+ and `Plan` is `n/a`; it is a warning, not a gate.
- **Done** here also means `current-task.md` says `complete` with its failed attempts count. On a failed verification, increment the count and record what failed and why.

## Gates in this layout

- On Claude Code and Codex, PreToolUse refuses Edit/Write/apply_patch (code `TASK_GATE`) when `current-task.md` shows 2+ failed attempts on an incomplete task, a plan step shows 2+ `Attempts`, or the target repo does not match `target.json`. Write the diagnosis, then update the task record or run `heli target set <repo>`.
- Diagnosis state is `.heli-harness/tasks/<task-id>/diagnosis.json` with its append-only `events.jsonl` (concurrent mode), or `.heli-harness/state/diagnosis.json` (legacy mode).
- Use the `concurrent-upgrade` skill when parallel agents share legacy task state, or `heli update` still shows mode legacy.
