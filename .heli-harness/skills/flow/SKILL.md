---
name: flow
description: Use when the next protocol is unclear — lightweight router for ambiguous or mixed work. Route Heli-specific situational questions to heli-assistant.
---

# flow

Trigger: ambiguous request, mixed task, or uncertainty about which skill applies.

Route:
- "What should I do with Heli in this workspace/session?" -> `heli-assistant`
- Production or live-user incident -> `incident`
- Claimed bug or disputed behavior -> `verify-premise`
- Confirmed but unexplained bug -> `debug`
- Non-trivial edit -> `engineering` and `impact` as triggered
- Large feature -> `feature`
- Failed tests or repeated fixes -> `fix-loop`
- Read-only verification of a completed change -> `audit`
- Broad security/correctness/repo sweep -> `workflow`
- New failure signature, contradicted hypothesis, subsystem change, or costly retry -> `evidence-gates` plus the scoped route
- Dependency change -> `deps`
- Branch/PR/release/GitHub write operation -> relevant scoped skill
- Target/resource/authority question -> `heli-governance` / `heli-target`

Rules:
- Pick the smallest protocol that covers the risk.
- Resolve linked vs embedded layout when Heli state matters.
- If target/resource identity is unclear, identify it before editing.
- In linked v0.10, do not create or update a durable task merely to authorize an ordinary reversible edit. Use a durable task when work spans sessions, needs handoff/dependency coordination, or carries significant diagnosis/verification history.
- If `diagnosis` state reports a new failure class or pending reroute, stop the old fix-loop and route through `verify-premise` / `debug` before material writes.
- Routing does not grant authority. Existing resource, policy, grant, and approval rules still apply.
