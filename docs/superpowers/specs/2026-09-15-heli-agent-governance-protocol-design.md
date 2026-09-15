# Heli v0.9 Agent Governance Protocol Design

## Goal

Evolve Heli from a file-oriented cross-agent governance harness into a small, versioned, machine-readable governance protocol while preserving Markdown as the human-authoring format and preserving Heli's task, target, evidence, lease, diagnosis, and adapter model.

## Product boundary

Heli remains a governance layer. It does not become an agent runtime, orchestrator, sandbox, MCP runtime, model router, vector-memory platform, hosted telemetry service, or automatic policy-learning system.

Heli answers:

1. What workspace/task am I operating in?
2. What target may I modify?
3. Which session owns write authority?
4. What host capabilities are actually available?
5. What governance decision was made, and why?
6. What evidence exists?
7. What happened during the task?
8. Is the task ready to be considered complete?

## Architecture

```text
Markdown authoring
profiles / policies / skills / safety
             |
             v
      Heli state layer
task / session / target / lease / diagnosis
             |
             v
    Heli Protocol Kernel
snapshot / capabilities / decisions / events
             |
      +------+-------+
      |      |       |
      v      v       v
     CLI   Plugins   ACP*
    JSON   Adapters  Proxy*
```

`ACP*` is experimental after Protocol v1 is stable.

## Canonical entities

v0.9 uses existing entities: Workspace, Task, Session, Target, Lease, Diagnosis, Decision, Event. There is no separate Principal entity in v0.9. A Session is the acting principal.

Future child-agent support extends Session with optional `parentSessionId`, `role`, and `delegation` fields.

## One-writer invariant

Heli retains one active writer for a task/worktree authority boundary. Child sessions default to observe/review. Write authority must be explicitly transferred or claimed; parent and child must not simultaneously become independent writers for the same task.

## Machine protocol

Machine-facing results use a versioned envelope:

```json
{
  "protocolVersion": 1,
  "command": "status",
  "ok": true,
  "data": {},
  "warnings": [],
  "errors": []
}
```

Human CLI output remains available. Adapters consume structured results rather than parsing CLI prose.

## Capability model

Adapter capability claims have declared, observed, and effective dimensions. Initial effective states are `unsupported`, `documented`, `wired`, `observed`, `enforced`, and `host-enforced`.

Initial capabilities: `session_start`, `pre_tool`, `post_tool`, `permission_request`, `subagent_start`, `subagent_stop`, `compaction`, `structured_tool_input`, `sandbox_attestation`, and `worktree_isolation`.

Heli must never infer live activation from files merely existing on disk.

## Structured decisions

Guard evaluation preserves backward-compatible `deny` and `reason` fields and adds a structured `decision` with stable `code`, `effect`, `rule`, `source`, task/session identity, and optional details.

## Event model

Existing `tasks/<id>/events.jsonl` remains the durable event stream. v0.9 adds `eventSchemaVersion` and namespaced event types such as `task.*`, `session.*`, `lease.*`, `guard.*`, `diagnosis.*`, `verification.*`, `decision.*`, and `report.*`. Historical v1 events are not rewritten.

## Explainability

`heli explain task|authority|capabilities|guard` deterministically explains current state and decisions. It does not call an LLM.

## S0/S1 fast path

Simple work uses compiled workflow profiles such as `S0_QUERY`, `S1_CHANGE`, `S1_FIX`, `S2_INVESTIGATION`, and `S3_HIGH_RISK`. Specialized skills load lazily on uncertainty, repeated failure, expanded impact, or risk escalation. Heli core does not add a natural-language task classifier.

## ACP

ACP is a later feasibility spike. Any proxy translates lifecycle/permission events into Heli Protocol operations and contains no policy logic itself.

## Learning

Learning is deferred until structured evidence exists. Future learning produces reviewable candidates only; observations never silently become policy.

## Compatibility

Existing Markdown files remain authoring surfaces. Existing plugins remain supported. Legacy workspace mode remains readable. Existing hook `deny`/`reason` contracts remain valid. Schema changes are additive where possible and tested across Windows, macOS, and Linux.

## Success criteria

1. Core CLI state is available through stable JSON.
2. Adapters no longer need to parse CLI prose.
3. Heli can truthfully describe what each host actually enforces.
4. Guard decisions have stable reason codes.
5. Task events can reconstruct governance lifecycle.
6. Simple S1 work has lower governance/context overhead than v0.8.
7. Existing task/lease/target safety invariants remain unchanged.
8. Supported CI lanes are green.
9. Runtime/orchestrator/sandbox responsibilities do not leak into Heli core.
