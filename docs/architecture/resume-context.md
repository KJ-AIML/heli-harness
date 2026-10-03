# Heli Resume Context

Status: implementation design for `heli resume`.

## Purpose

`heli resume` turns Heli's durable governance and coordination state into a compact continuation packet for a newly started agent or host.

The command supports the product promise:

> Switch tools. Keep the thread.

It is intentionally read-only. Heli does not become an agent runtime or orchestrator.

## Core semantics

`heli resume` MAY read and summarize:

- workspace identity and execution/worktree context
- workspace-shared task records
- task lifecycle status
- task coordination state, dependencies, and `blocked_on`
- published handoff metadata and Git refs/paths
- execution-local session and writer/resource authority
- already-recorded durable observations/evidence
- Git branch, HEAD, and dirty-tree summary

`heli resume` MUST NOT:

- spawn or schedule an agent
- select and execute downstream work automatically
- acquire, release, transfer, or take over writer authority
- mutate tasks, handoffs, sessions, grants, Git, or project files
- store or reconstruct conversation transcripts
- claim that a new agent owns the previous agent's session

A new host still enters through the normal SessionStart/PreToolUse lifecycle before it may write.

## Source-of-truth boundaries

- Heli workspace task/dependency/handoff state: durable coordination truth
- Git: code and artifact snapshot truth
- execution-local session/resource authority: current write-authority truth
- host conversation/context: not owned by Heli

## CLI

```bash
heli resume
heli resume --json
```

The default command resolves the current linked or embedded workspace and produces a continuation packet.

### Human output

The human view should be compact and optimized for an operator or agent opening a fresh session. It should include:

1. workspace / execution / worktree
2. Git branch, HEAD, and dirty summary
3. current or relevant active task(s)
4. lifecycle status and coordination state as separate fields
5. dependencies, blockers, and satisfied artifact refs
6. current writer/resource holder when present
7. recent durable observations/evidence when available
8. continuation guidance that is descriptive, not executable automation

### JSON output

The JSON shape should be stable enough for host/plugin consumption and contain structured fields rather than preformatted prose.

A representative shape:

```json
{
  "workspace": {
    "workspaceId": "heli-ws-...",
    "executionId": "heli-exec-...",
    "worktreePath": "/repo"
  },
  "git": {
    "branch": "feat/billing",
    "head": "abc1234",
    "dirty": true,
    "changes": []
  },
  "tasks": [
    {
      "taskId": "epic-billing",
      "status": "active",
      "coordinationState": "ready",
      "blockedOn": [],
      "dependencies": []
    }
  ],
  "authority": {
    "resourceId": "worktree-...",
    "writerSessionId": "heli-ses-..."
  },
  "observations": [],
  "guidance": []
}
```

Exact field names may follow existing Heli CLI conventions, but lifecycle status and coordination readiness must remain distinct.

## Task selection

Layer 1 should not invent an automatic scheduler.

The packet may order or annotate active tasks for readability, but it must expose the underlying candidate tasks rather than silently deciding which one the new agent must execute.

If no active task exists, the packet still reports Git/workspace/authority context and says that no durable active task is recorded.

## Authority behavior during tool switching

Example:

1. Codex is working and owns the worktree writer authority.
2. Codex reaches its usage limit.
3. Grok starts in the same linked worktree.
4. `heli resume` can describe the task/Git/dependency state and report that Codex still holds writer authority.
5. Grok does not inherit that writer authority.
6. Normal Heli session/authority rules decide whether the old authority is still live, expired, released, or requires explicit takeover.

This keeps continuity separate from permission.

## Acceptance

Source smoke should cover at minimum:

- no active task
- one active ready task
- blocked task with `blocked_on`
- satisfied handoff ref/path
- multiple active tasks without automatic scheduling
- clean and dirty Git state
- writer held and writer absent
- human and JSON output
- command is read-only

Live acceptance should switch between two supported hosts/worktrees and prove that the new session can read the same durable packet without inheriting the previous session's authority.

## Non-goals

- transcript storage
- semantic memory/vector search
- model routing
- agent spawning
- DAG execution
- automatic task assignment
- automatic lease takeover
- automatic merge/cherry-pick
