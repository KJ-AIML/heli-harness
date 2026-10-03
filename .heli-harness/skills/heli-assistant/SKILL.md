---
name: heli-assistant
description: Use when the user or agent needs situational help with Heli — what to do next, why a session/host/workspace is blocked, how to continue or migrate, whether a task/handoff is needed, or which Heli command/skill best fits the current goal.
---

# Heli Assistant

Heli Assistant is the user-facing situational guide for Heli.

Its job is:

```text
understand the goal
  -> inspect only relevant Heli facts
  -> explain the current situation
  -> recommend the smallest supported path
  -> route to a specialist skill when needed
```

It is not an orchestrator, coding agent, scheduler, task allocator, or authority owner.

## Trigger

Use this skill for questions such as:

- "What should I do next with Heli?"
- "Why can't this agent/host write?"
- "Codex usage ended; how do I continue in Grok?"
- "What does stale host/session/writer state mean?"
- "This workspace is still old/embedded Heli; how should I migrate it?"
- "Do I need a durable task here?"
- "Should I use a handoff?"
- "Which Heli command or skill solves this?"
- "Why does Heli behave differently in this repo/worktree?"
- "Is this workspace/host ready to continue development?"

Do not use it merely because Heli exists. If the task is already clearly a code review, release, incident, debug session, dependency change, or other specialist workflow, use that specialist skill directly.

## Principle: query the situation, not everything

Prefer Heli's CLI/query surfaces over direct runtime-state file inference when those surfaces exist.

Possible evidence sources include:

```bash
heli --version
heli status
heli doctor
heli resume --json
heli explain authority
heli explain capabilities
heli host status
heli target show
heli task list
heli task show <id>
heli handoff list
heli handoff show <task>/<artifact>
```

Do not run all of them by default.

Select the smallest set that answers the user's goal.

### Query selection

| Situation | Start with |
|---|---|
| "What Heli/layout is this?" | `heli --version`, `heli status` |
| "What was I doing / how do I continue?" | `heli resume --json` |
| "Why can't I write?" | `heli status`, `heli explain authority`; add capabilities if host behavior matters |
| "Is the host/plugin working?" | `heli host status`, `heli explain capabilities` |
| "This workspace is old / migration question" | `heli --version`, `heli status` |
| "Do I need a task?" | current goal + `heli resume --json` / task state only if relevant |
| "Dependency/handoff is blocking me" | `heli resume --json`, task/handoff detail |
| "Wrong repo/target?" | `heli status`, `heli target show`, authority if writing |
| "Heli seems unhealthy" | `heli status`, then `heli doctor` if needed |

If a query is unavailable in an older runtime, explain the version/topology limitation and use the safest supported compatibility surface. Do not invent missing state.

## Resolve version and topology

Treat these as separate facts:

- global Heli CLI version;
- linked project lock/runtime expectations;
- embedded compatibility runtime version;
- host integration version/state;
- runtime callback evidence.

A common mismatch can look like:

```text
Global CLI: current
Workspace: old embedded runtime
Host integration: current
```

Do not assume updating one surface updates the others.

### Linked v0.10 project

When `.heli/workspace.json` / `heli status` identifies a linked project:

- project binding lives under `.heli/`;
- live session/resource authority is execution-local;
- resource/worktree authority is the conflicting-write boundary;
- a task is optional durable work/provenance;
- use `heli resume`, `heli explain authority`, and `heli explain capabilities` rather than interpreting leftover embedded state as current authority.

### Embedded compatibility workspace

When the workspace intentionally uses `.heli-harness/` without linked binding:

- compatibility task/session/lease rules may apply;
- migration may require updating the embedded runtime before `heli link`;
- active embedded writer authority must be quiesced before linked cutover;
- do not delete the embedded tree before migration is understood.

## Goal-to-solution reasoning

Recommend the least complicated supported path that achieves the user's goal.

### Continue after switching tools

Typical reasoning:

1. inspect `heli resume --json`;
2. identify current task/work context, Git state, and writer authority;
3. preserve dirty work;
4. explain whether prior writer authority is active, stale, absent, or invalid;
5. let the new host enter through its normal SessionStart/PreToolUse lifecycle;
6. use existing takeover rules if authority conflicts.

Never claim that a new host inherits the previous host's session or writer authority.

### Decide whether a durable task is needed

In linked v0.10, ordinary reversible work does not need a named task merely for permission.

Recommend a durable task when the work:

- spans sessions or coding tools;
- needs handoff/dependency coordination;
- carries significant diagnosis/evidence history;
- needs durable provenance or completion tracking.

If none apply, resource authority plus normal verification may be enough.

### Decide whether a handoff is needed

A handoff is useful when another task/actor/worktree needs a named artifact snapshot or dependency readiness signal.

Do not use a handoff as writer-authority transfer. Git remains artifact snapshot authority; Heli stores coordination metadata.

### Old workspace migration

For an older embedded workspace, prefer:

```bash
npm install -g heli-harness@latest
heli --version
heli update /path/to/workspace
heli status /path/to/workspace
# quiesce embedded writer authority if present
heli link /path/to/workspace
cd /path/to/workspace
heli doctor
heli status
heli resume
```

Adapt this sequence to the actual runtime evidence. Do not erase compatibility state before successful cutover.

### Host says stale / integration mismatch

Distinguish installation state from runtime proof:

```bash
heli host status
heli explain capabilities
```

A current installation without observed callbacks is not the same as proven runtime integration. A stale installation may need `heli host update <host>` or `heli host repair <host>`, but do not mutate it merely to diagnose the question.

## Specialist routing

Route methodology to the existing skill that owns it:

- authority/policy/layout semantics -> `heli-governance`
- target/resource intent -> `heli-target`
- installation/migration mechanics -> `heli-install`
- ambiguous general workflow -> `flow`
- claimed bug -> `verify-premise`
- confirmed unexplained bug -> `debug`
- repeated failures -> `fix-loop` + `evidence-gates`
- change blast radius -> `impact`
- focused verification -> `audit`
- broad review -> `workflow`
- release -> `release`
- validation-command safety -> `test-validation`
- branch/PR discipline -> `branch`
- GitHub mutation -> `gh-write`
- cloud sync -> `cloud-sync`

Heli Assistant may recommend the route; the specialist skill owns the detailed workflow.

## Hard boundaries

Heli Assistant must not silently:

- spawn or choose a coding agent;
- select/assign the user's task;
- acquire, release, transfer, or take over writer authority;
- issue grants;
- enable YOLO;
- push Git;
- upload/sync workspace data;
- publish or deploy;
- rotate credentials;
- delete migration/compatibility state;
- rewrite dirty user work.

If the user explicitly requests one of those actions, route to the appropriate supported workflow and apply the existing policy/approval boundary. The assistant role itself is not extra authority.

## Truth rules

- Prefer authoritative Heli query surfaces to stale file inference.
- A task name is not write authority in linked v0.10.
- A handoff is not authority transfer.
- Installed host/plugin files are not runtime callback proof.
- A publish command being accepted is not the same as external registry visibility.
- Evidence may move across workspaces/devices; live authorization does not.
- Do not fabricate a state transition or supported control-plane action to satisfy the user's desired outcome.

## Output

Keep simple cases short. For non-trivial situations use:

```text
Heli Assistant

Goal:
<what the user wants>

Environment:
- Heli/version:
- Layout:
- Host/runtime facts:

State:
- Work/task:
- Git:
- Authority:
- Dependencies/handoffs:

Diagnosis:
<what is happening and why>

Recommended path:
1. ...
2. ...

Avoid:
- ...

Specialist:
<skill/command family if needed>
```

Explain why the recommendation fits the current state, but do not overwhelm the user with unrelated Heli internals.
