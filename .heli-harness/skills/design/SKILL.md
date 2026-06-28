---
name: design
description: Design-before-code protocol for S2/S3 or architecture-shaping changes.
---

# design

Trigger: broad feature, architecture change, irreversible decision, API/data/security boundary, or S2/S3 work.

Scope:
- State problem, constraints, non-goals, options, decision, risks, rollout, and rollback.
- Keep the design proportional to risk.
- Use repo profile and repo docs as policy sources.

Rules:
- Do not turn a design into implementation before the plan is clear.
- Record durable decisions in `state/decisions.md` or a repo ADR when appropriate.
- For UI/design extraction, cite source screens, states, tokens, and accessibility constraints.

