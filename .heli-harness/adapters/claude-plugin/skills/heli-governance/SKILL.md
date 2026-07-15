---
description: Use when working in a Heli-Harness parent workspace.
---

# Heli Governance

Read `.heli-harness/HARNESS.md`, identify the target repo, preserve dirty user work, and run evidence-backed validation before claiming completion. If the repo the user describes differs from `.heli-harness/workspace/target.json`'s `targetRepo`, warn about the mismatch and confirm before proceeding — see the `heli-target` skill for the set/confirm workflow — rather than silently overriding or silently proceeding against the wrong repo.

Do not claim enforcement unless a runtime hook or local smoke proves it. Pointer adapters are context. Plugin hooks are guardrails, not a sandbox.

## Concurrent sessions (v0.5.24+)

When workspace schema mode is `concurrent` (or multiple tasks exist under `.heli-harness/tasks/`):

- Use durable **task** ids (`heli task create|list|show|claim|release`).
- Bind this agent run with a **Heli session** (`heli session start|attach|status`); export `HELI_SESSION_ID` so hooks resolve the same session.
- Write mode requires an active **write lease** on that task. A second writer is denied; use review/observe or explicit `heli task takeover --confirm`.
- Prefer a **separate git worktree** per parallel task. Do not invent lease ownership in prose.
- Task-local YOLO/target apply only to the bound task. Global `yolo.json` does not authorize cross-task bleed in concurrent mode.
- If the user says "continue the work" and multiple tasks are active without a binding, ask which task id — do not silently attach to an arbitrary task.
- Duplicate work-item keys are rejected unless explicitly confirmed.

Legacy singular `state/current-task.md` remains valid when concurrent mode is not initialized.

After marking a task `complete` at risk tier S2/S3 in the bound task's `current-task.md` (or legacy state file), append a dated entry to the appropriate `decisions.md` if the task involved a durable architectural call (not for routine fixes).
