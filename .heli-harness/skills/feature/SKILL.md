---
name: feature
description: Spec, slice, implementation plan, and verification protocol for larger feature work.
---

# feature

Trigger: new capability, multi-step product work, or feature request too large for a single focused edit.

Scope:
- Convert request into a short task brief.
- Slice into reviewable increments.
- Identify data/API/UI/test/doc impact.
- Plan verification per slice.

Rules:
- Do not start coding a large feature without a plan.
- Keep each slice independently reviewable where feasible.
- Use `impact` before changing shared surfaces.
- Use `test-coverage` to identify regression or characterization tests.

