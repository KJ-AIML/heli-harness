---
name: gh-write
description: GitHub write operations protocol for issues, PRs, comments, labels, and releases.
---

# gh-write

Trigger: creating or editing GitHub issues, PRs, comments, labels, milestones, or release notes.

Scope:
- Read repo profile and existing templates.
- Draft content before posting when the operation is significant.
- Use body files for long content.
- Include verification evidence for fix/PR comments.

Rules:
- Do not post, close, merge, label, or request reviewers unless the user asked or the repo profile permits it.
- Do not expose secrets, private paths, or irrelevant local logs.
- Do not claim checks passed unless evidence was collected.

