---
name: heli-governance
description: Use when working in a Heli v0.11 linked project or embedded compatibility workspace to resolve layout, target/resource authority, policy, grants, host coverage, and evidence-backed completion.
---

# Heli Governance

Run `heli status` first and determine the active layout.

## Linked v0.11 project

When `.heli/workspace.json` exists:

- project identity/config lives under `.heli/`;
- live grants, sessions, resource authority, capability observations, credentials, and runtime identity are execution-local;
- use `heli explain authority` / `heli explain capabilities` rather than inferring authority from committed state;
- resource/worktree authority is the conflicting-write boundary;
- a task is optional durable work/provenance, not the root authorization key;
- use scoped grants for temporary approval;
- for plan-shaped unattended work, an approved run (`heli run approve <plan>`, human-only) allows pushes to the plan's own branch while the plan file is unchanged, and on Claude Code keeps the agent working until `heli run done` or `heli run blocked "<what it needs>"`;
- every deny names its recovery class: clear a `SELF_RECOVERABLE` block yourself and continue, ask once for a `HUMAN_REQUIRED` one and keep working on what does not need it, never work around a `HARD_DENY`;
- the project's governance files (`.heli/safety/**`, `.heli/policies/**`, `.heli/workspace.json`, `.heli/heli.lock`) are not agent-writable (`HELI_POLICY_PROTECTED`, under YOLO too);
- T6 hard-deny behavior remains non-grantable by normal temporary approval;
- preserve dirty user work and keep changes within the resolved target/resource scope;
- use a durable work record when work spans sessions, needs handoff/coordination, or carries significant verification/diagnosis obligations.

Do not treat an old embedded `.heli-harness/state/current-task.md`, task lease, or advisory lock as linked authority merely because compatibility files remain after migration.

## Embedded compatibility workspace

When no linked project binding exists and the workspace intentionally uses `.heli-harness/`:

- read `.heli-harness/HARNESS.md`;
- use `heli target` / embedded workspace metadata for target discipline;
- concurrent task/session/lease commands remain available;
- write mode requires the compatibility writer claim/lease where that mode is active;
- prefer a separate git worktree per parallel task;
- do not invent lease ownership in prose.

The `concurrent-upgrade` skill applies only to embedded workspaces that still use legacy shared task state.

## Evidence and enforcement

Do not claim enforcement unless a runtime hook or local/live proof supports the exact host surface.

Pointer files are context. Plugin hooks are guardrails. Neither is a sandbox.

After significant S2/S3 work, retain decision/verifier evidence in the appropriate durable work record when one exists.
