# Heli-Harness Governance Model

## Summary

Heli-Harness is a lightweight governance layer for coding agents. It stores durable workspace instructions, repo facts, policies, safety rules, task state, adapter guidance, observable hooks, and reviewable reports in local files.

The model is deliberately split into layers. Repo facts should not become policy. Policy should not depend on memory. Safety should be enforced by hooks and host permissions where possible. Reports should make the work reviewable after the agent finishes.

## Core Model

Facts describe. Policies decide. Safety enforces. Reports prove. Adapters translate.

- Facts describe: profiles record observed repo structure, stack, commands, risks, and existing patterns.
- Policies decide: policy overlays state required, recommended, forbidden, approval-gated, and exception-based behavior.
- Safety enforces: safety overlays, hooks, command tiers, and approval rules block or surface risky behavior where supported.
- Reports prove: run reports show what happened, which checks ran, which deviations occurred, and what risk remains.
- Adapters translate: tool-specific adapters map the same harness model into Codex, Claude Code, Cursor, Pi, AXGA, or generic agent contexts.

## Separation of Concerns

Heli should split:

- Repo facts
- Policy overlays
- Safety overlays
- Task state
- Tool adapters
- Hook observability
- Review reports

This split prevents common failure modes:

- Existing weak code does not automatically become a recommended convention.
- Memory cannot silently override required policy.
- A user prompt cannot silently bypass a safety hard block.
- Hook status can be inspected instead of inferred.
- Reports remain durable review artifacts instead of chat-only summaries.

## File and Layer Map

| Layer | Current or proposed path | Role | Authority |
| --- | --- | --- | --- |
| Harness core | `.heli-harness/HARNESS.md` | Workspace protocol and source of truth | High protocol authority |
| Repo profiles | `.heli-harness/profiles/` | Descriptive repo facts and risks | Descriptive, not prescriptive |
| Policy overlays | `.heli-harness/policies/` | Required and recommended engineering rules | Prescriptive |
| Safety overlays | `.heli-harness/safety/` | Command tiers, risky paths, secrets handling | Enforced where hooks allow |
| Task state | `.heli-harness/state/` | Current task, decisions, runs, reports | Task-scoped evidence |
| Workspace index | `.heli-harness/workspace/` | Known repos, git roots, target state | Target identity |
| Advisory locks | `.heli-harness/state/`, `.heli-harness/workspace/` | Session and target lock signals | Advisory coordination |
| Benchmarks | `benchmarks/` | Repeatable evaluation artifacts | Evidence/evaluation support |
| Adapters | `.heli-harness/adapters/` | Tool-specific loading instructions | Translation layer |
| Templates | `.heli-harness/templates/` | Reusable profile, report, and task formats | Authoring support |
| Schemas | `.heli-harness/schemas/` | Machine-checkable contracts | Validation support |

## Proposed Directory Model

```text
.heli-harness/
  HARNESS.md
  profiles/
  policies/
    engineering.md
    security.md
    release.md
    testing.md
  safety/
    command-tiers.md
    command-rules.json
    secrets.md
  state/
    current-task.md
    decisions.md
    session.lock.example.json
    reports/
    runs/
  workspace/
    index.json
    target.json
    target.lock.example.json
  adapters/
  templates/
  schemas/
```

## Load Order vs Authority Order

Load order is the order in which context becomes available to an agent.

Authority order is the order used to resolve conflicts.

These are not the same. A late-loaded prompt can provide useful task detail, but it should not silently override a safety hard block or required policy.

## Suggested Load Order

1. Tool adapter defaults
2. User or global Heli preferences if any
3. Workspace harness core
4. Repo profile facts
5. Policy overlays
6. Task-specific state
7. Explicit user prompt
8. Hook-added one-shot context

## Suggested Authority Order

1. Safety hard blocks
2. Explicit user approval for risky actions
3. Policy overlays
4. Workspace harness protocol
5. Repo profile facts
6. Task state
7. User task prompt
8. Tool adapter defaults

## Conflict Rules

- User prompts can override repo facts when the user supplies newer or more specific information.
- User prompts should not silently override safety or policy.
- Safety enforcement belongs in hooks, guards, command tiers, host permissions, and approval flows where available.
- Instruction files alone are context, not enforcement.
- If a policy and a repo profile conflict, the policy wins and the report should record the deviation or conflict.
- If a safety hard block and user request conflict, the agent should stop unless explicit approval is part of the defined safety flow.

## Repo Profiles

Repo profiles are descriptive. They answer:

- What stack exists?
- Which commands are known?
- Which files and directories matter?
- Which risks are known?
- Which patterns exist?
- Which patterns are known tech debt?
- Which commands are safe, risky, or expensive?

Profiles should include evidence paths. They should avoid vague claims like "use existing patterns" unless those patterns are classified.

Recommended profile taxonomy:

- Policy references
- Observed stack
- Existing patterns
- Recommended conventions
- Known tech debt
- Forbidden patterns
- Safer alternatives
- Command tiers
- Repo risks
- Exceptions
- Evidence paths

## Policy Overlays

Policy overlays are prescriptive. They answer:

- What is required?
- What is recommended?
- What is forbidden?
- What requires approval?
- What exception is allowed, and why?

Policy files should be small enough for review and stable enough for repeated use. They should not describe every repo detail. They should express team rules that apply across work.

Suggested files:

- `.heli-harness/policies/engineering.md`
- `.heli-harness/policies/security.md`
- `.heli-harness/policies/release.md`
- `.heli-harness/policies/testing.md`

Statement classes:

- Required
- Recommended
- Forbidden
- Requires approval
- Exception

## Safety Overlays

Safety overlays define actions that need blocking, confirmation, or special reporting.

Suggested files:

- `.heli-harness/safety/command-tiers.md`
- `.heli-harness/safety/command-rules.json`
- `.heli-harness/safety/secrets.md`

Safety overlays should cover:

- destructive commands
- release and publish commands
- remote write commands
- API-credit-consuming commands
- secret-bearing files
- out-of-target writes
- old runtime paths and identity drift

Safety rules should be enforced by hooks or host permissions where possible. Markdown can explain the rule, but enforcement needs an executable guard or host setting.

In v0.5.6, Pi/AXGA command guards consume `.heli-harness/safety/command-rules.json` as the runtime policy source of truth where compatible `tool_call` hooks are available. A local classifier normalizes common command bypass forms before matching those rules and adds guard facts for destructive commands, shell redirection writes outside `writesAllowedUnder`, sensitive paths, obvious secret-like write content, and sensitive reads. Invalid or missing command-rule configuration does not silently disable the guard; the adapter falls back to built-in conservative defaults. This is still not a sandbox.

## Task State

Task state records the current task and its governance context.

It should include:

- target repo
- target git root
- task summary
- mode
- risk tier
- files expected to change
- dirty files observed
- planned verification
- current status
- failed attempts count
- next smallest action

Task state is not long-term memory. It is a current-run coordination artifact.

## Workspace Index

Workspace index files make target identity explicit in parent workspaces with many repos.

They should record:

- known repo names
- repo paths
- git roots
- profile mappings
- default target when appropriate

Target state should record:

- target repo
- target git root
- writes allowed under
- active profile
- selection metadata

This is coordination state, not orchestration.

## Advisory Locks

Advisory lock templates make parallel-agent intent visible without introducing distributed locking.

They should record:

- lock owner
- agent identity
- target repo
- start and expiration timestamps
- purpose or reason

Locks are warnings, not enforcement. They help agents and humans see when multiple agents may be touching the same workspace or target state. Heli does not create active lock files by default.

## Benchmarks

Benchmark artifacts provide repeatable evaluation support for governance behavior.

They should include:

- scenario templates
- scoring rubrics
- experiment plans
- run logs
- scorecards
- comparison reports

Benchmarks are evidence/evaluation support, not runtime authority. They help humans measure whether Heli improves governance outcomes. They do not enforce behavior. They are local, manual, and markdown-first.

## Reports

Reports are durable review artifacts. They should make the run inspectable without replaying the chat.

Reports should include:

- target repo and git root
- files changed
- commands run
- validations run
- policy deviations
- safety events
- assumptions
- unresolved risks
- next steps

Reports prove process discipline. They should be lintable before a task is considered complete.

Heli report lint records workspace root, target repo, target git root, writes allowed under, workspace index usage, target selection method, and out-of-target warnings. The linter still warns by default rather than acting as a hard rule engine.

## Adapter Responsibilities

Adapters translate the harness into each tool's loading model.

Adapters should:

- point the tool to `.heli-harness/HARNESS.md`
- explain how to find repo profiles
- load only relevant skills or workflows
- expose status where possible
- expose hook observability where possible
- avoid placing tool-specific behavior in the tool-neutral core

Adapters should not:

- define core policy
- invent separate runtime paths
- hide behavior in unreadable configuration
- require a hosted service

## Machine-Readable Sidecars

Markdown should remain the primary authoring format. Sidecars should exist only where validation or enforcement needs structure.

Good sidecar candidates:

- workspace index
- target state
- command rules
- schema definitions
- package manifests

Poor sidecar candidates:

- long-form policy rationale
- architecture decisions
- research synthesis
- human review reports

## What Remains Markdown-First

- Harness protocol
- Repo profiles
- Engineering policies
- Safety rationale
- Task reports
- Architecture decisions
- Roadmap
- Research synthesis
- Templates

Markdown keeps the harness inspectable in pull requests and usable by agents that can read files but cannot load a custom database.

## What Should Not Be Centralized Yet

Heli should not centralize:

- user memory
- vector search
- telemetry
- task execution
- multi-agent orchestration
- cross-repo build planning
- plugin marketplace state

Those capabilities can be useful in agent systems, but they are not required for Heli's governance role. Adding them before schemas stabilize would make the harness harder to inspect and harder to trust.
