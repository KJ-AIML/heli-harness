---
name: heli-governance
description: Use in a Heli v0.10 linked project or embedded compatibility workspace to resolve layout, target/resource authority, policy, grants, host coverage, and evidence-backed completion.
---

# Heli Governance

Run `heli status` first and determine the active layout.

## Linked v0.10 project

When `.heli/workspace.json` exists:

- project identity/config lives under `.heli/`;
- live grants, sessions, resource authority, capability observations, credentials, and runtime identity are execution-local;
- use `heli explain authority` / `heli explain capabilities` rather than inferring authority from committed state;
- resource/worktree authority is the conflicting-write boundary;
- a task is optional durable work/provenance, not the root authorization key;
- use scoped grants for temporary approval;
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
