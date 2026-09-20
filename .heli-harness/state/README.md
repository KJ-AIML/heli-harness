# Harness State

**Current release:** `v0.10.1`

## Linked projects

For a linked project, live operational state is execution-local and resolved by Heli from the project binding. It is not committed as project authority.

Current linked semantics:

- resource/worktree authority is the conflicting-write boundary;
- a task is an optional durable work record/provenance object;
- grants, sessions, live authority, capability observations, credentials, YOLO, and process/runtime identity are machine/execution local;
- cloning a project does not clone authorization.

Use `heli status`, `heli explain authority`, and machine-readable Heli surfaces instead of assuming a committed state file is authoritative.

## Embedded compatibility mode

A deliberately embedded `.heli-harness/` workspace still supports the older state layout:

- `tasks/<task-id>/`
- `sessions/`
- `bindings/`
- `locks/`
- `state/current-task.md`
- `workspace/index.json`
- `workspace/target.json`

Embedded compatibility installs default to concurrent state. Older embedded workspaces may still be legacy until explicitly migrated.

In embedded concurrent mode, task-local state is authoritative for the compatibility task/session workflow; shared `state/current-task.md` may be only a projection.

The `concurrent-upgrade` skill applies to this embedded compatibility path. It is not the authority model for linked v0.10 projects.

## Durable records

Use durable work/task records when work spans sessions, needs handoff, coordinates multiple actors, or carries significant verification/diagnosis obligations.

Do not create fake runs/reports/evidence merely to satisfy ceremony.
