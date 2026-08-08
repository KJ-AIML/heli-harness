# Heli vNext — Root-Cause Convergence & Evidence-Gated Autonomy

Status: implementation design for v0.8.0 candidate

## 1. Current behavior

Heli already has concurrent task/session/lease ownership, markdown task state,
append-only task events, skill routing, command-tier guards, and host-specific
PreToolUse/tool-call adapters. The existing failure loop and two-strike rule
are primarily instructions plus a global `Failed attempts count`. Hooks do not
know whether a failure is the same class, whether a hypothesis was contradicted,
or whether an expensive retry is justified. Hosts without runtime hooks are
advisory by design.

## 2. Desired behavior and non-goals

Add lightweight evidence-governed transitions while keeping the agent and host
responsible for execution. Heli will persist the current diagnosis, classify
failure signatures, invalidate stale hypotheses, require rerouting after a new
failure class, record subsystem checkpoints and material decisions, and gate
repeated expensive actions. It will not parse arbitrary logs, run an agent,
execute a graph, or become a planner/orchestrator.

## 3. Minimum new state

`tasks/<task-id>/diagnosis.json` is the current machine-readable diagnosis;
`tasks/<task-id>/events.jsonl` remains the append-only history. Legacy workspaces
use `.heli-harness/state/diagnosis.json`. The sidecar is absent/idle for a
successful S0/S1 task, so ordinary work keeps its current friction budget.

The sidecar stores only bounded structured values:

- symptom/claim and route phase;
- normalized failure signature and failure-class key;
- closest proven boundary and responsible subsystem;
- current hypothesis, status, supporting/contradicting evidence, falsifier;
- root-cause status, smallest causal change, verification prediction;
- last material change, previous failed action, attempt count by failure class;
- subsystem checkpoint, material decision, last verification/run;
- retry-gate record and explicit next smallest action.

Evidence entries carry a claim, source/reference, observation time, and optional
run/source SHA. Transitions reject missing required evidence rather than trying
to determine technical truth. History is never rewritten.

## 4. Transition API and enforcement points

The shared `concurrency/diagnosis.mjs` module owns normalization, transition
validation, append-only event recording, completion checks, and the generic
expensive-action evaluator. The embedded CLI exposes the same semantics:

```text
heli diagnosis show <task-id>
heli diagnosis init <task-id> --json <payload>
heli diagnosis record <task-id> --type <failure|evidence|hypothesis|classify|root-cause|checkpoint|decision|run> --json <payload>
heli diagnosis route <task-id> --route <verify-premise|debug|fix-loop|impact|incident>
heli diagnosis gate <task-id> --json <action-payload>
```

`record run` is the explicit structured result helper. It records terminal
results and automatically distinguishes same failure class from a materially
new class. Two implementation failures for the same class require diagnosis
re-evaluation; a new class creates a reroute boundary without consuming the
old diagnosis's attempt count.

Supported PreToolUse/tool-call hosts call the shared evaluator. They enforce
two structured gates:

1. a pending reroute or unestablished S2/S3 diagnosis blocks material writes
   until the agent records the route/boundary/root-cause transition;
2. a tool call carrying structured `heli_action` metadata is checked by the
   same generic expensive-action gate.

No hook attempts to infer cost or root cause from free-form output. Pi's
`tool_call` and the shipped Claude/Codex/Grok/Kimi/Antigravity wrappers use the
same core; OpenCode uses its plugin bridge. Post-result support is represented
by the explicit `record run` helper because the shipped hosts do not currently
provide a portable, proven PostToolUse contract.

Task completion rejects an unresolved reroute, failed current verification, or
an S2/S3 active diagnosis without current passing verification evidence.

## 5. Failure signature and diagnosis rules

A signature is normalized across operation/stage, subsystem, error class,
terminal status, assertion identity, environment, provider, normalized message,
and source SHA. The stable failure-class key excludes source SHA so the same
failure after a relevant fix remains the same class; stage/subsystem/error
changes produce a new class. A new class preserves the previous snapshot in
events, marks the old context superseded, and requires:

```text
NEW FAILURE CLASS → REASSESS PREMISE → ROUTE AGAIN → ESTABLISH BOUNDARY
```

Contradicting evidence marks the active hypothesis `CONTRADICTED` and blocks
material implementation until rerouting. A subsystem change requires a
checkpoint containing what is known, what changed, why the prior boundary is no
longer primary, the new closest boundary, and the next discriminating action.

## 6. Expensive-action retry gate

Actions are classified by explicit structured metadata (`costClass`,
`repositoryDefinedCostly`, action id/command) and optional
`.heli-harness/safety/expensive-actions.json` policy rules. The mechanism is
not tied to a provider or command name. The initial run is allowed and recorded;
repeated expensive actions require at least one of:

- a relevant material change with a predicted effect;
- new discriminating evidence plus a recorded cheaper-action check;
- a repository policy bounded transient retry still below its limit;
- explicit human override evidence.

The prior run id/signature/boundary, changed material, prediction,
discrimination, retry count, and cost classification are retained. “Run it
again and see” is denied. S3/production mutation always needs explicit human
approval, regardless of YOLO.

S2 material transitions also expose an independent-review requirement. A
reviewer can record a structured passing review; this is not a user interrupt
and is distinct from human approval. S0 is autonomous; S1 is autonomous with
self-checkpoints; S3 remains human-controlled.

## 7. Compatibility and migration

Existing task JSON and markdown remain readable. Missing diagnosis sidecars are
treated as inactive. Existing `Failed attempts count` remains as a legacy
compatibility gate; the new failure-class attempt counter is authoritative for
diagnosis-aware loops and prevents different classes from sharing one counter.
Existing CLI commands keep their syntax and behavior unless a diagnosis has
explicitly activated a gate.

Fresh install creates no live diagnosis. Update preserves user overlays and
runtime state, then deterministically merges newly shipped safety defaults by
rule/action id without overwriting local entries. A managed-defaults version is
recorded so future updates can explain drift. Custom policies remain intact.

## 8. Test strategy

Dependency-free deterministic smokes cover false premise, contradicted
hypothesis, same failure/two-strike behavior, new downstream failure/reroute,
subsystem checkpoint, denied and justified expensive retries, discriminating
retry, S1/S2/S3 review boundaries, simple successful work, hook denial/allow,
task completion, fresh install, update overlay merge, and generated plugin/CLI
parity. Existing concurrency, adapter, skill, update, and release checks remain
in the `npm run check` path.

## 9. Performance and friction

The diagnosis sidecar is lazy and task-local. Reads are one small JSON parse on
hook paths only when a task has a diagnosis; writes are atomic and append one
event. S0/S1 success does not require a diagnosis command. Expensive actions
and failure-driven material edits pay the evidence cost intentionally.

## 10. Intentionally advisory boundaries

Generic hosts, Cursor rules, AXGA without a proven hook contract, and any host
that does not load the native hook remain advisory. Heli documents this status
and never calls a Markdown skill or unsupported adapter an enforcement proof.
Arbitrary log interpretation, technical truth, business intent, and the choice
of the next engineering action remain with the agent/human.

## Independent design review

Review performed against the vNext request, `HARNESS.md`, the source profile,
the shared hook/CLI architecture, and the generated-file sync scripts.

- Scope is bounded to the Heli-Harness source checkout; no product repository,
  cloud sync, release, tag, push, or deployment is required.
- State is an extension of existing task-local state plus existing events, not
  a second workflow engine.
- New enforcement is structured and shared; unsupported hosts are explicitly
  advisory, and no arbitrary log heuristic is claimed.
- Same-class and new-class failures are separated before attempt counting;
  history is append-only and diagnosis invalidation is visible.
- Retry policy has explicit alternatives and a first-run exception, preserving
  S0/S1 simplicity while protecting expensive/S3 paths.
- Generated CLI/plugin mirrors and overlay migration are included in the test
  plan, with existing ownership/lease gates left intact.

Decision: coherent and safe to implement automatically in reviewable slices.
