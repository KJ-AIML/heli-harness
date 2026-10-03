---
name: evidence-gates
description: Use when a diagnosis, failure transition, material decision, expensive retry, subsystem change, or completion claim needs current machine-readable evidence.
---

# Evidence Gates

Heli is a claim -> evidence -> transition protocol. The agent executes the work; Heli checks whether a state transition has current structured support.

## Resolve the active topology

Prefer the current Heli CLI surface:

```bash
heli status
```

- Linked v0.10: durable diagnosis/work evidence is resolved through Heli's linked workspace and execution-aware state.
- Embedded compatibility: local `.heli-harness/` task/diagnosis state may remain authoritative for that compatibility workflow.

Do not infer linked authority or diagnosis state from leftover embedded files merely because they still exist.

## When diagnosis is active

Keep the current structured record short and concrete:

- observed symptom or claim;
- normalized failure signature;
- closest proven boundary;
- responsible subsystem;
- bounded hypothesis;
- supporting and contradicting evidence;
- falsifier;
- expected result;
- root cause once established;
- smallest causal change;
- next discriminating action;
- current verification result.

Facts are not interpretations. An observer timeout proves the observation deadline expired; it does not prove a worker died. Contradictory evidence invalidates the old story and requires rerouting.

## Canonical failure transitions

Use the global Heli CLI when available:

```bash
heli diagnosis show <task-id>
heli diagnosis record <task-id> --type run --json '<result>'
heli diagnosis route <task-id> --route verify-premise|debug|fix-loop|impact|incident
heli diagnosis gate <task-id> ...
```

For an intentionally embedded compatibility workspace with only the local runtime, the equivalent commands may be run through:

```bash
node .heli-harness/heli.mjs diagnosis ...
```

The same normalized implementation-failure class stays in the fix-loop and advances its class-specific attempt count. Two implementation failures against that same class require root-cause re-evaluation.

A materially new class starts a new premise/boundary cycle. It does not consume the old class's attempt count.

When the responsible subsystem changes, checkpoint:

- what is known;
- what changed;
- why the prior boundary is no longer primary;
- the new closest boundary;
- the next discriminating action.

## Expensive actions

Mark costly work with structured action metadata or the supported diagnosis gate.

A repeated expensive action needs at least one of:

- a relevant material change plus predicted effect;
- new discriminating evidence after cheaper checks;
- an explicitly bounded transient-retry policy;
- explicit human override.

"Run it again and see" is not evidence.

S3, production mutation, destructive/irreversible work, security-boundary changes, credential/policy authority changes, and unresolved business intent require the applicable human approval. YOLO never bypasses ownership, reroute, or retry gates.

## Review boundaries

- S0: autonomous.
- S1: autonomous with focused verification.
- S2: may continue without interrupting the user when policy allows, but material transitions expose/record the independent-review obligation.
- S3: explicit human approval for the high-risk transition.

Hosts without proven runtime callbacks are advisory. Installed files, a Markdown skill, or a plugin manifest do not prove mechanical enforcement.

## Durable task boundary

Do not create a named durable task merely because evidence gates exist. In linked v0.10, use a durable work record when the investigation spans sessions, needs handoff/coordination, or requires durable diagnosis history. Small local work can remain taskless while resource authority and policy still apply.
