# Evidence-Governed Autonomy

Heli-Harness v0.8.0 adds a small control surface for engineering claims. It
does not execute agents or workflows. Agents and hosts execute; Heli validates
which claims and transitions have sufficient current evidence.

## Claim → evidence → transition

The task-local `diagnosis.json` is lazy. A simple successful S0/S1 task can
remain unchanged. When a diagnosis is activated, the record keeps a symptom,
normalized failure class, closest proven boundary, responsible subsystem,
hypothesis status, supporting/contradicting evidence, falsifier, root-cause
status, smallest causal change, verification prediction, retry justification,
last run, and next smallest action. `events.jsonl` is append-only history.

Use the embedded CLI from the workspace root:

```bash
node .heli-harness/heli.mjs diagnosis init <task> --json '<object>'
node .heli-harness/heli.mjs diagnosis record <task> --type run --json '<object>'
node .heli-harness/heli.mjs diagnosis route <task> --route verify-premise
node .heli-harness/heli.mjs diagnosis gate <task> --json '<heli_action object>'
```

The CLI accepts explicit structured observations; it does not attempt to turn
arbitrary logs into facts.

## Same failure vs new failure

Failure classes combine operation/stage, subsystem, error class, terminal
status, assertion identity, environment, provider, and normalized message. The
class key intentionally excludes source SHA so a relevant fix followed by the
same observed failure remains the same class. A changed stage/subsystem/error
class becomes a new class.

```text
same class → fix-loop → class-specific attempt count
new class  → new-failure-class → verify-premise/debug/impact/incident → boundary
```

Two implementation failures against one class require root-cause
re-evaluation. A new class does not burn the old two-strike count. Contradicting
evidence marks the hypothesis `CONTRADICTED`, preserves the evidence, and
blocks material implementation until routing is re-entered.

## Closest proven boundary and checkpoints

An observer deadline proves only that terminal state was not observed before
the deadline. It does not prove worker death. A subsystem checkpoint is required
when the responsible subsystem changes and records:

- what we know;
- what changed;
- why the previous subsystem is no longer the primary boundary;
- the new closest proven boundary;
- the next discriminating action.

S0/S1 agents can self-record this checkpoint. S2 material transitions expose an
independent-review requirement; this is not an automatic user interruption.

## Expensive retry gate

Cost is explicit in `heli_action` metadata or a workspace extension under
`.heli-harness/safety/expensive-actions.json`. The first run is recorded. A
repeated costly action needs at least one of:

- a relevant material change with a predicted effect;
- new discriminating evidence after retained evidence, fixtures, logs, fake
  adapters, focused tests, and cheap probes were considered;
- a bounded transient policy below its retry limit;
- explicit human override evidence.

The prior run identity, signature, boundary, change, prediction,
discrimination, retry count, and cost class are retained. `run it again and
see` is rejected. S3 and production mutation always require human approval.

## Host boundaries

The shared hook evaluator is used by supported PreToolUse/tool-call adapters.
It can enforce reroute/checkpoint/root-cause gates for material writes and
structured expensive-action metadata. The repository does not claim automatic
post-result parsing because the shipped host contracts do not provide one
portable, proven PostToolUse surface; agents use the explicit `record run`
transition instead.

Cursor rules, generic adapters, AXGA without a proven runtime hook, and hosts
that do not load the native plugin are advisory. A Markdown skill or pointer is
context, not mechanical enforcement.

## Review boundaries and YOLO

S0 is autonomous. S1 is autonomous with self-checkpoints. S2 can continue with
evidence and independent review for material changes. S3, production mutation,
destructive/irreversible work, security-boundary changes, credential/policy
authority, unresolved business intent, and unbounded cost exposure require
human approval. YOLO is visible opt-in friction reduction; it never bypasses
ownership or the evidence gates above.
