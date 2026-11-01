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
- After two failed fix attempts on the same check with no new information, stop repeating that fix: write a short diagnosis (what failed, likely causes, next smallest action) and continue with it. End the turn only when the next step needs the user.
- For active S2/S3 diagnosis, material implementation requires current evidence and an established root cause; S2 material decisions also expose an independent-review requirement.
- Record material decisions as decision/evidence/predicted effect/falsifier/outcome. Complete only with current passing verification evidence.

Done means:
- intent satisfied
- scope controlled
- verification evidence captured
- dirty user work preserved
- unresolved risks named
