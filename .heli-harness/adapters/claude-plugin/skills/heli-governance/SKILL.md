---
description: Use when working in a Heli-Harness parent workspace.
---

# Heli Governance

Read `.heli-harness/HARNESS.md`, identify the target repo, preserve dirty user work, and run evidence-backed validation before claiming completion. If the repo the user describes differs from `.heli-harness/workspace/target.json`'s `targetRepo`, warn about the mismatch and confirm before proceeding — see the `heli-target` skill for the set/confirm workflow — rather than silently overriding or silently proceeding against the wrong repo.

Do not claim enforcement unless a runtime hook or local smoke proves it. Pointer adapters are context. Plugin hooks are guardrails, not a sandbox.

After marking a task `complete` at risk tier S2/S3 in `current-task.md`, append a dated entry to `.heli-harness/state/decisions.md` if the task involved a durable architectural call (not for routine fixes) — this is how the next session, in any CLI, learns why a prior decision was made.
