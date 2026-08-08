---
name: evidence-gates
description: Use when a diagnosis, failure transition, material decision, expensive retry, subsystem change, or completion claim needs machine-readable evidence.
---

# Evidence gates

Heli-Harness is a claim → evidence → transition protocol. The agent executes
the work; Heli checks that the state transition has current structured support.
The canonical machine state is the task-local `diagnosis.json`, with
`events.jsonl` as append-only history. Markdown remains the human projection.

## When diagnosis is active

Keep these fields short and concrete:

- observed symptom/claim;
- failure signature and closest proven boundary;
- responsible subsystem;
- bounded hypothesis, supporting evidence, falsifier, and expected result;
- root cause and smallest causal change;
- next discriminating action and current verification result.

Facts are not interpretations. An observer timeout proves the observation
deadline expired; it does not prove a worker died. A contradictory observation
marks the hypothesis `CONTRADICTED` and requires rerouting. Do not rewrite the
event history to preserve an old story.

## Failure transitions

Use the embedded CLI or equivalent structured API:

```text
node .heli-harness/heli.mjs diagnosis show <task-id>
node .heli-harness/heli.mjs diagnosis record <task-id> --type run --json '<result>'
node .heli-harness/heli.mjs diagnosis route <task-id> --route verify-premise|debug|fix-loop|impact|incident
```

The same normalized failure class after a fix stays in the fix-loop and
advances its class-specific attempt count. Two implementation failures against
that same class require root-cause re-evaluation. A materially new class starts
`NEW FAILURE CLASS → REASSESS PREMISE → ROUTE AGAIN → ESTABLISH BOUNDARY`; it
does not consume the old diagnosis's two-strike count.

When the responsible subsystem changes, record a checkpoint with what is known,
what changed, why the prior boundary is no longer primary, the new closest
boundary, and the next discriminating action.

## Expensive actions

Mark costly work with structured `heli_action` metadata or use `diagnosis gate`.
The first run is recorded. A repeated expensive action needs a relevant
material change and prediction, new discriminating evidence after cheaper
checks, a bounded transient policy, or explicit human override. “Run it again
and see” is not evidence. S3 and production mutation always require human
approval. YOLO never bypasses ownership, reroute, or retry gates.

## Review boundaries

S0 is autonomous. S1 is autonomous with self-checkpoints. S2 can continue
without interrupting the user, but material transitions expose/record an
independent-review requirement. S3, production mutation, destructive or
irreversible work, security-boundary changes, credential/policy authority, and
unresolved business intent require human approval.

Hosts without a proven runtime hook are advisory. Do not claim that this skill
or a Markdown pointer mechanically enforces a transition.
