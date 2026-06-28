---
name: branch
description: Branch and PR discipline without hard-coded repo policy. Use before creating, pushing, rebasing, merging, or opening a PR.
---

# branch

Trigger: any branch, push, merge, rebase, or PR-readiness decision.

Scope:
- Read the repo profile and repo-local docs for branch policy.
- Identify current branch, base branch, remote, and dirty files.
- Confirm whether the task belongs on the current branch or a new branch.
- Verify commits are scoped and reviewable before PR.

Rules:
- Do not assume `develop`, `main`, or trunk-based policy unless documented.
- Do not force push, rebase shared work, or bypass protection without explicit user approval.
- Do not add assistant/vendor co-author metadata unless the repo profile explicitly requires it.
- Preserve dirty user work.

Pre-PR checks:
- correct branch and base
- clean or intentionally dirty working tree
- scoped diff
- focused build/test evidence
- risk tier and rollback notes for S2/S3 work

