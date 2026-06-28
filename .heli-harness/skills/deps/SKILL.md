---
name: deps
description: Dependency add, remove, or upgrade protocol. Use before changing package manifests or lockfiles.
---

# deps

Trigger: adding, removing, upgrading, replacing, or pinning dependencies.

Scope:
- Identify why the dependency change is needed.
- Read changelogs, migration notes, license, maintenance status, and security posture where relevant.
- Prefer one dependency concern per commit or PR.
- Verify lockfile and runtime impact.

Rules:
- Do not upgrade opportunistically during unrelated work.
- Do not assume generated lockfiles are safe without reviewing scope.
- For S2/S3 dependency changes, document rollback and compatibility risks.

