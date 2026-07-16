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

Rules:
- Never fix what the agent cannot explain.
- Prefer instrumentation, focused tests, logs, and binary search over broad rewrites.
- If two fix attempts fail, stop coding and write diagnosis.
- Record commands and evidence in `state/current-task.md` or a run report when non-trivial.

Output before editing:

```text
Symptom:
Repro:
Root cause:
Smallest fix:
Verification:
```

