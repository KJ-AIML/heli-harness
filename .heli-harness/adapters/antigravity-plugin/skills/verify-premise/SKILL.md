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
- **Manual smoke / UX "fails":** open existing e2e/Playwright/smoke contracts first. If the manual path disagrees with the contract (wrong entry URL, wrong CTA), treat it as agent/operator error until the product path is proven broken.
- **Authorized ops request:** before mutating, map the request to a **supported control-plane action**. If no action exists (e.g. "rebind pin" but service only has pin-on-create), stop with a typed blocker such as `ACTION_UNSUPPORTED` — do not invent DB bypasses.
- Do not write product-defect claims into plan Evidence until this skill confirms them.
