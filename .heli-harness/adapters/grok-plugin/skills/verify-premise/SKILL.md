---
name: verify-premise
description: Use when a claimed bug, review comment, or requested fix may be false — check the premise before implementing.
---

# verify-premise

Trigger: "fix X", "Y is broken", review comment claims, bug reports, or requests based on asserted behavior.

Scope:
- Restate the claim.
- Read cited files and nearby code.
- Reproduce, trace, or disprove the behavior.
- Decide whether the premise is confirmed.

Outcomes:
- confirmed as stated
- confirmed but broader
- confirmed differently
- not reproducible or premise broken

Rules:
- Do not implement if the premise is false or unclear.
- Do not silently switch scope.
- If confirmed but unexplained, route to `debug`.
- If confirmed and shared surface is affected, route to `impact` before editing.

