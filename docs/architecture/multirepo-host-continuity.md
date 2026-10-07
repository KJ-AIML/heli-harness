# Multi-Repo Host Continuity

Status: implementation contract for issue #43.

## Product model

One Heli workspace may govern multiple nested Git repositories and worktrees.

A parent workspace such as:

```text
workspace/
  .heli/
  docs/
  repos/
    api/.git/
    web/.git/
```

is ONE Heli workspace. The nested repositories are repository resources/targets/profiles inside the parent workspace. They do not require independent Heli workspace identities.

Host switching must preserve unfinished work across Codex, Pi, Claude, OpenCode, and other supported hosts without transferring live writer authority.

## Invariants

1. The nearest Git repository is not automatically a Heli workspace.
2. A linked Heli ancestor governs nested repositories unless the user explicitly created an independent nested Heli workspace.
3. Running `heli link` inside a nested repository under a linked ancestor must never silently create a second workspace.
4. Existing nested linked workspaces are never deleted or merged implicitly.
5. Repository inventory is workspace-scoped and portable; local sessions/authority remain execution-scoped.
6. SessionStart is runtime identity evidence, not durable work continuity by itself.
7. Meaningful unfinished work must have workspace-scoped continuation metadata even when no explicit user task exists.
8. A new host may read continuation state but never inherits the old session's writer authority.
9. First safe write by the new host may establish free resource authority conflict-safely.
10. Live writer conflicts remain human-required.
11. Heli stores continuation metadata/evidence, not chat transcripts.
12. YOLO is not part of normal continuation.

## Parent workspace resolution

When a command or host starts below a linked workspace root:

- walk upward for linked workspace bindings;
- preserve the nested Git top-level as the repository/worktree resource;
- use the parent workspace identity and workspace-scoped task store;
- use the nested worktree path for resource authority.

If `heli link` is invoked from a nested Git repository while an ancestor linked workspace already governs that path, Heli registers/refreshes the repository in the parent workspace instead of creating a nested `.heli`.

If a nested `.heli` already exists with a different workspace id, Heli reports an explicit nested-workspace conflict and does not mutate either workspace.

## Repository inventory

A linked workspace has an explicit repository inventory with at least:

- stable repository id/name;
- relative path from workspace root;
- relative git root;
- optional profile;
- optional default target flag.

Commands:

```text
heli repo list
heli repo add [path] [--name <id>] [--profile <profile>]
heli repo remove <id-or-path>
heli repo discover [path]
```

Repository registration must not create tasks, sessions, or writer authority.

## Continuation work record

A host session may begin unbound. Heli creates a durable continuation record only when there is meaningful work evidence, for example:

- a guarded mutation is allowed/performed;
- Git dirty state changes from the SessionStart baseline;
- a plan/evidence path is explicitly associated;
- a host records a meaningful work event.

The record is workspace-scoped and includes:

- repository id;
- worktree path/portable repo path;
- branch and HEAD where available;
- host/session provenance;
- dirty path summary;
- created/updated timestamps;
- lifecycle `active|complete|abandoned`;
- optional plan/evidence references.

It is not a conversation transcript and does not imply writer authority.

An explicit task may adopt/supersede a continuation record rather than duplicating work.

## Resume behavior

`heli resume` includes unfinished continuation records in addition to explicit tasks.

When there is no explicit active task but there is one recent unfinished continuation record for the current repository/worktree, the packet should clearly say:

```text
Continuation available from <host>
Repository: <repo>
Branch/HEAD: ...
Dirty paths: ...
Last activity: ...
Writer authority: not inherited
```

A new host uses this context to continue safely.

## Runtime activation proof

Installation status and live runtime evidence remain separate.

Runtime status must make these states obvious:

- installed + active SessionStart + active PreToolUse;
- installed + SessionStart only;
- installed but inactive in the current session;
- not installed/unavailable.

The source of truth for active enforcement is current runtime observation freshness, never files alone.

## Acceptance matrix

Synthetic tests are necessary but insufficient.

For every locally available host whose adapter claims `enforced`:

1. open from a nested repo under one parent workspace;
2. verify SessionStart resolves the parent workspace and nested repo resource;
3. make a harmless real edit without YOLO;
4. verify runtime observation and continuation record;
5. close/stop host without explicit handoff;
6. open the next host;
7. verify `heli resume` exposes the unfinished previous-host work;
8. continue with new free writer authority;
9. separately prove second live writer is denied;
10. prove installed-but-inactive never reports live enforcement.

The primary real-world fixture is the IC-Center topology that exposed the regression.

## Migration

Existing nested linked workspaces require explicit migration.

Before consolidation, Heli must inspect:

- workspace ids;
- tasks/work records;
- sessions;
- live/stale resource authority;
- dirty Git state.

Any active authority or conflicting durable records blocks automatic consolidation.
