---
name: debug
description: Use when a bug is confirmed but the cause is unknown — reproduce, isolate, root-cause, and explain before fixing.
---

# debug

Trigger: the premise is confirmed but the cause is unknown.

Scope:
- Reproduce or confirm the symptom.
- Trace the execution path.
- Form and test hypotheses one at a time.
- Identify the smallest causal change.
- Explain root cause before implementation.
- When a durable diagnosis record exists, bind the explanation to its current evidence: closest proven boundary, active hypothesis, evidence, falsifier, and predicted effect.

Rules:
- Never fix what the agent cannot explain.
- Prefer instrumentation, focused tests, logs, and binary search over broad rewrites.
- If two implementation attempts fail against the same failure class, stop coding and return to diagnosis.
- Record commands and evidence in the durable work/diagnosis record when the work spans sessions or carries non-trivial investigation history.
- When a new failure signature or responsible subsystem appears, record the new boundary and reroute; do not continue the old diagnosis silently.
- Do not manufacture a durable task only to satisfy this skill in a small linked v0.11 edit.

Canonical diagnosis surfaces:

```bash
heli diagnosis show <task-id>
heli diagnosis record <task-id> --type run --json '<result>'
heli diagnosis route <task-id> --route verify-premise|debug|fix-loop|impact|incident
```

For an intentionally embedded compatibility workspace where only the local runtime is available, the equivalent local CLI may be invoked through `.heli-harness/heli.mjs`.

Output before editing:

```text
Symptom:
Repro:
Closest proven boundary:
Root cause:
Smallest fix:
Verification:
```
