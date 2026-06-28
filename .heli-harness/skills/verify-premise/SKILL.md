---
name: verify-premise
description: Check whether a claim, bug report, or requested fix is true before acting.
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

