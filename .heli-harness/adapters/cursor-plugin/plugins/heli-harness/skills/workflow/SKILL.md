---
name: workflow
description: "Use when a broad multi-file review, security/correctness sweep, or high-recall investigation needs find-broadly then refute-cold synthesis."
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
