---
name: engineering
description: Use when non-trivial work needs risk tiering (S0–S3), done criteria, verification standards, or the smallest safe implementation path.
---

# engineering

Trigger: non-trivial work, broad changes, risk uncertainty, or "what is the right way to do this?"

Scope:
- Classify risk as `S0`, `S1`, `S2`, or `S3`.
- Define done criteria before editing.
- Choose the smallest safe implementation path.
- Select relevant verification and rollback notes.

Rules:
- S0/S1: use the smallest relevant check first.
- S2/S3: require plan, impact analysis, verification evidence, and rollback notes where relevant.
- Do not widen scope to make a solution elegant if a smaller correct path exists.
- Stop after two failed fix attempts and write diagnosis.

Done means:
- intent satisfied
- scope controlled
- verification evidence captured
- dirty user work preserved
- unresolved risks named
