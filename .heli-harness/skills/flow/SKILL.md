---
name: flow
description: Use when the next protocol is unclear — lightweight task router and mode selector for ambiguous or mixed work.
---

# flow

Trigger: ambiguous request, mixed task, or uncertainty about which skill applies.

Route:
- Production or live-user incident -> `incident`
- Claimed bug or disputed behavior -> `verify-premise`
- Confirmed but unexplained bug -> `debug`
- Non-trivial edit -> `engineering` and `impact`
- Large feature -> `feature`
- Failed tests or repeated fixes -> `fix-loop`
- Read-only verification -> `audit`
- New failure signature, contradicted hypothesis, subsystem change, or costly retry -> `evidence-gates` plus the scoped route
- Dependency change -> `deps`
- Branch/PR/release/GitHub write operation -> relevant scoped skill
- Broad codebase review -> `workflow`

Rules:
- Pick the smallest protocol that covers the risk.
- If target repo is unclear, identify it before editing.
- Update `state/current-task.md` before non-trivial edits.
- If `diagnosis.json` reports a new failure class or pending reroute, stop the old fix-loop and route through `verify-premise`/`debug` before material writes.
