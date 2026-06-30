# ADR 0001: Heli as Governance Harness

## Status

Accepted

## Date

2026-06-29

## Context

Heli-Harness started as a parent-workspace harness for coding agents. By v0.3.2 it provides a stable local baseline:

- `.heli-harness/` as the installed workspace harness.
- Tool-neutral harness instructions.
- Repo profiles, state, templates, skills, and adapters.
- Pi/AXGA package support through skills and a lightweight extension.
- Safe auto hooks.
- Hook observability probes for `before_agent_start` and `tool_call`.

Research and design rationale indicate that coding-agent quality should improve when durable instructions, scoped procedures, executable guardrails, approval rules, optional memory, skills, and reports are separate layers. The strongest pattern is separation of concerns, not simply more context.

Illustrative benchmark examples hypothesize that descriptive profiles alone can make agents more aware without reliably stopping them from copying weak existing patterns. Prescriptive policy overlays and tech-debt classification are needed so agents know which patterns are facts, conventions, risks, or forbidden behavior. Measured benchmark runs are planned in v0.5.x Full Coverage work.

## Decision

Heli-Harness will remain a lightweight, local, markdown-first, adapter-friendly governance harness for coding agents.

It will focus on:

- repo facts
- policies
- safety
- task state
- tool adapters
- observable hooks
- reviewable reports

It will separate:

- facts that describe
- policies that decide
- safety rules that enforce
- reports that prove
- adapters that translate

## Consequences

Positive consequences:

- Heli stays inspectable in pull requests.
- Teams can adopt it without a hosted service.
- Repo facts can evolve without silently changing policy.
- Policies can become stricter without rewriting descriptive profiles.
- Hooks and probes can prove active behavior.
- Reports can become durable review artifacts.
- Tool adapters can evolve independently from the tool-neutral harness core.

Tradeoffs:

- Heli will not offer rich runtime orchestration.
- Some enforcement depends on host tool hook support.
- Markdown-first files need linting to stay consistent.
- Policy overlays require careful wording to avoid vague governance.
- Multi-repo targeting will need explicit workspace index files instead of implicit discovery alone.

## Alternatives Considered

Full agent runtime:
Rejected. Runtime concerns belong to agent hosts. Heli should govern behavior, not execute tasks.

Planner or task execution engine:
Rejected. Planning and execution are host-agent responsibilities. Heli may provide task state and reports, but it should not become the planner.

Multi-agent orchestrator:
Rejected. Orchestration adds scheduling, delegation, lifecycle, and result-merging concerns that are outside Heli's role.

Central database:
Rejected. A database would reduce inspectability and make local adoption harder before schemas are stable.

Vector memory platform:
Rejected. Memory can be useful, but required policy must remain explicit and reviewable.

Plugin marketplace:
Deferred. Marketplace distribution should wait until policy, profile, safety, and report schemas are stable.

Prompt-only instruction pack:
Rejected. Instructions are context, not enforcement. Heli needs hooks, guards, status, reports, and validation to be a governance harness.

## Non-Goals

Heli will not become:

- an agent runtime
- a planner
- a task execution engine
- a multi-agent orchestrator
- a central database
- a vector memory platform
- a hosted telemetry system
- a plugin marketplace before schemas are stable

## Follow-Up Decisions

- Define policy overlay file format and statement classes.
- Define profile taxonomy and tech-debt classification rules.
- Define workspace index and target-state schema.
- Decide which safety rules need machine-readable sidecars.
- Decide report lint requirements.
- Decide how adapters expose status, hook observability, and target state.
