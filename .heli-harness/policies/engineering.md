# Engineering Policy

Scope:

- General implementation and review behavior for this workspace.

## Required

- State the target repo before non-trivial edits.
- In multi-repo workspaces, use workspace index and target state before write workflows.
- Prefer the smallest correct change that fixes the root cause.
- Record validation and remaining risks in the run report.

## Recommended

- Reuse repo-local patterns when they are documented as recommended conventions.
- Keep diffs scoped to the task.
- Favor readable code over clever shortcuts.

## Forbidden

- Do not treat undocumented existing code as automatic policy.
- Do not skip validation silently.
- Do not widen scope for cleanup unless the task requires it.

## Requires approval

- Cross-repo writes.
- Force-push, release, publish, or deploy operations.
- Broad dependency updates outside the task scope.

## Exceptions

- Scope:
- Approval:
- Justification:
- Follow-up:
