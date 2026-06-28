---
name: workflow
description: "Deep review workflow: find broadly, refute cold, synthesize actionable findings."
---

# workflow

Trigger: broad multi-file review, security/correctness sweep, or high-recall investigation where one skim is insufficient.

Scope:

- Find candidate issues across flows and risk lenses.
- Refute each significant finding with a skeptical second pass.
- Synthesize confirmed findings by severity and blast radius.
- Identify coverage gaps.

Rules:

- Do not edit during the review.
- Finding and judging must be separate steps.
- Prefer in-session review unless independent agents or parallel read-only sessions are clearly worth the overhead.
- Route confirmed fixes through `engineering`, `impact`, and `fix-loop`.
