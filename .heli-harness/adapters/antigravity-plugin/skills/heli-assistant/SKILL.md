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
- "How do I let the agent work through a plan while I'm away?"
- "Why was a push refused during an approved run, or why didn't the agent keep going?"

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
heli run status
heli grant list
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
| "Can the agent work unattended? Is a run on?" | `heli run status` |
| "Why was a push or merge refused?" | the deny's own reason and `Heli recovery:` line, then `heli run status`, `heli grant list` |

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

### Linked project

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

In a linked project, ordinary reversible work does not need a named task merely for permission.

Recommend a durable task when the work:

- spans sessions or coding tools;
- needs handoff/dependency coordination;
- carries significant diagnosis/evidence history;
- needs durable provenance or completion tracking.

If none apply, resource authority plus normal verification may be enough.

### Decide whether a handoff is needed

A handoff is useful when another task/actor/worktree needs a named artifact snapshot or dependency readiness signal.

Do not use a handoff as writer-authority transfer. Git remains artifact snapshot authority; Heli stores coordination metadata.

### Work through a plan while the user is away (approved runs)

When the user wants an agent to work a plan through without stopping to ask (overnight, while away), the supported path is an approved run, not YOLO:

1. the agent writes the plan with a fenced `heli-run` block: `branch:` the plan's own branch, `push: yes` if it must push, `hours:` 1 to 24 (default 8);
2. the user reads the plan and runs `heli run approve <plan>` in their own terminal; it shows what the run allows and what stays blocked, then asks (human-only, like grants and YOLO);
3. while the run is on, pushes to that branch of that remote are allowed, unforced, for as long as the plan file is unchanged; on Claude Code a Stop hook keeps the bound session working until it runs `heli run done`, or `heli run blocked "<what it needs>"` when every remaining step needs the user;
4. `heli run status` shows the run; `heli run stop` ends it at once.

A run never covers `main`, `master` or the remote's default branch, other branches, force pushes, tags, deletions, merging a pull request (`gh pr merge` needs the user's own `git.push` grant; `--scope once` is enough), publish/deploy approvals, `.env` writes or T6 commands. YOLO lifts much more, and expires after 8 hours by default. Prefer a run for plan-shaped work, and a scoped grant for one action.

Diagnosing a run:

- `keep going: off` at approval: no agent session was active near the plan around or since the time it was written. The user can name one with `--session <heli-session-id>` (the agent's SessionStart context shows its id). Pushes are allowed either way.
- A push refused during a run: compare the branch and remote with `heli run status`, then look for a force flag or a tag. Also check whether the plan file changed after approval: any edit voids it, so keep progress notes elsewhere. A push written with both quotes and an output redirection (`"x" 2>&1`) is read conservatively and not covered; push without the redirection.
- Keep-going exists on Claude Code only. Other hosts get the run's push approval without it.

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

### Governance block / repeated denial

Treat a governance denial as a state transition problem, not an invitation to try nearby commands until one works.

When the guard exposes recovery metadata, obey it:

- `AUTO_RECOVERABLE`: Heli repaired the safe authority gap and the original operation may continue.
- `SELF_RECOVERABLE`: run the single documented recovery action, then retry once only if authority state changed, and continue; no need to ask the user.
- `HUMAN_REQUIRED`: stop tool retries and ask the user once for the decision/approval; keep working on the parts of the task that do not need it.
- `HARD_DENY`: do not retry or work around it; change the requested operation, or ask the user to repair invalid state.

If `retryable=false`, do not retry the blocked action or alternate write commands against the same blocker.

Use `blockerFingerprint` to recognize the same unchanged blocker. Same fingerprint + unchanged authority state means no progress is possible by retrying.

For writer/lease problems, start with:

```bash
heli status
heli explain authority
```

Add `heli resume --json` when continuation context matters.

A missing compatibility lease for an already-bound write session may be auto-established when the worktree is free. Do not ask the user to enable YOLO merely to recover that state.

A live writer conflict is different: do not take over silently. Ask the user to continue with the current writer, close/release it, use another worktree, or explicitly approve takeover. A conflict with a lease that lapses within a minute is `SELF_RECOVERABLE` with `retryAfterSeconds`: wait, retry once, and ask only if the same blocker is back.

Writes to the project's governance files (`.heli/safety/**`, `.heli/policies/**`, `.heli/workspace.json`, `.heli/heli.lock`) are refused with `HELI_POLICY_PROTECTED`, under YOLO too: an agent cannot change the rules it runs under. The user edits them, or `heli update` merges newly shipped rules.

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
- approve a run (`heli run approve`) or change the governance profile (`heli governance set`);
- push Git;
- upload/sync workspace data;
- publish or deploy;
- rotate credentials;
- delete migration/compatibility state;
- rewrite dirty user work.

If the user explicitly requests one of those actions, route to the appropriate supported workflow and apply the existing policy/approval boundary. The assistant role itself is not extra authority.

## Truth rules

- Prefer authoritative Heli query surfaces to stale file inference.
- A task name is not write authority in a linked project.
- A handoff is not authority transfer.
- Installed host/plugin files are not runtime callback proof.
- A publish command being accepted is not the same as external registry visibility.
- Evidence may move across workspaces/devices; live authorization does not.
- Same blocker + unchanged authority state is not progress; do not spend tool/model budget retrying it.
- Normal safe development should not require YOLO merely to obtain missing free writer authority.
- An approved run covers pushes to the plan's branch only, while the plan file is unchanged; it is not a general push grant and never covers a merge.
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
