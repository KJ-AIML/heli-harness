---
name: heli-review
description: Use when invoking the ergonomic /heli-review entry point. Resolve current Heli/repo context, then delegate focused verification to audit or broad review to workflow.
---

# Heli Review

`heli-review` is a routing wrapper, not a second review methodology.

## Resolve context

When the repository is Heli-managed, start with the smallest relevant Heli context:

```bash
heli status
```

Use linked `.heli/` context for linked v0.10 projects and embedded `.heli-harness/` context only for intentional compatibility workspaces. Preserve dirty user work.

## Route

- Current diff / PR / commit / claimed fix -> `audit`
- Broad multi-file correctness, security, or high-recall sweep -> `workflow`
- Shared/high-use surface in scope -> add `impact`
- Missing/weak regression protection -> add `test-coverage`
- Heli operation/state question rather than code review -> `heli-assistant`

Read the selected specialist skill and follow its evidence/output rules.

## Boundary

By default this entry point is read-only:

- inspect status, diff, history, code, tests, and relevant evidence;
- do not edit, commit, push, merge, publish, deploy, or alter Heli authority merely to complete a review;
- do not claim checks passed without current evidence;
- do not treat plugin/skill files as runtime-enforcement proof.

If the user separately asks to fix findings, route the implementation through the appropriate engineering/fix workflow and existing authority rules.

## Output

State:

- route used: `audit` or `workflow`;
- scope reviewed;
- findings/verdict;
- verification evidence;
- residual risk;
- next action.
