---
name: release
description: Release checklist for versioning, changelog, tagging, verification, rollout, and rollback.
---

# release

Trigger: preparing, cutting, publishing, deploying, tagging, or documenting a release.

Scope:
- Read repo release policy.
- Confirm branch, version, changelog, artifacts, checks, rollout, and rollback.
- Capture post-release verification evidence.

Rules:
- Do not assume release branch flow.
- Do not publish or deploy without explicit user request or documented automation policy.
- Treat irreversible release actions as S3 unless the repo profile says otherwise.

