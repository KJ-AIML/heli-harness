---
name: flow
description: Lightweight task router and mode selector. Use when the next protocol is unclear.
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
- Dependency change -> `deps`
- Branch/PR/release/GitHub write operation -> relevant scoped skill
- Broad codebase review -> `workflow`

Rules:
- Pick the smallest protocol that covers the risk.
- If target repo is unclear, identify it before editing.
- Update `state/current-task.md` before non-trivial edits.

