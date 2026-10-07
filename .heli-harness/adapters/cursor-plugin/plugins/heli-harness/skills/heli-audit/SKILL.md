---
name: heli-audit
description: Use when invoking the ergonomic /heli-audit entry point — compose broad workflow review with dependency, test-coverage, and impact lenses as triggered.
---

# Heli Audit

`heli-audit` is a broad read-only composition layer. It should not maintain a parallel audit methodology.

## Resolve context

For a Heli-managed project:

```bash
heli status
```

Resolve linked vs embedded layout, current target/resource context, and the repository actually being audited. Do not assume `.heli-harness/HARNESS.md` is the primary source in a linked v0.11 project.

## Composition

Start with `workflow` for broad candidate discovery and skeptical refutation.

Add these lenses only when relevant:

- `deps` — package/lockfile/dependency risk;
- `test-coverage` — missing, weak, flaky, or misleading tests;
- `impact` — shared surfaces, destructive paths, API/data/operational blast radius;
- `audit` — focused verification of a specific completed claim or fix;
- `heli-governance` — Heli policy/authority/runtime-evidence questions.

Common audit categories include:

- correctness and fragile logic;
- overengineering or dead flexibility;
- unsafe/destructive operations;
- dependency and supply-chain concerns;
- generated-file / lockfile drift;
- CI, validation, or regression gaps;
- runtime-enforcement overclaims;
- version/layout assumptions that conflict with the current Heli topology.

## Rules

- Read-only by default.
- Prefer static inspection and focused non-mutating verification.
- Do not edit, install, commit, push, publish, deploy, rotate credentials, or consume paid/API resources merely to finish the audit.
- Separate confirmed findings from hypotheses and coverage gaps.
- Rank findings by severity/blast radius, not by stylistic preference.
- Preserve dirty user work.
- A Heli skill/plugin file proves available guidance or wiring, not that a host callback actually executed.

## Output

Return:

```text
Scope:
Heli layout/context:
Confirmed findings:
Coverage gaps:
Dependency/test/impact notes:
Residual risks:
Safest next actions:
```
