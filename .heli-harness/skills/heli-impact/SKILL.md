---
name: heli-impact
description: Use for the ergonomic /heli-impact entry point. Resolve the current Heli/repo context, then delegate blast-radius analysis to the canonical impact skill.
---

# Heli Impact

`heli-impact` is a thin entry point for the canonical `impact` protocol.

## Resolve context

When Heli state matters, start with:

```bash
heli status
```

Resolve linked vs embedded layout and the actual target/resource before analyzing a planned change or current diff. Do not assume old `.heli-harness/workspace/*` files control a linked v0.10 project.

## Delegate

Read and follow `impact`.

That protocol owns:

- callers and consumers;
- shared APIs/contracts;
- data and UI flows;
- generated files;
- destructive/delete-capable call chains;
- tests and verification;
- operational/deployment blast radius;
- rollback or mitigation for S2/S3 work.

Use `engineering` when risk/done criteria are unclear, and `heli-assistant` when the question is primarily "what should I do with Heli here?" rather than change-impact analysis.

## Boundary

This entry point is read-only unless the user separately asks for implementation. It does not grant write authority or approval.

## Output

Return the canonical `impact` report, plus the resolved Heli layout/target when that context materially affects the result.
