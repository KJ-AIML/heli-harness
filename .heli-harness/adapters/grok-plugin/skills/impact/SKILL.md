---
name: impact
description: Use when editing shared or high-use surfaces — pre-edit blast-radius analysis for callers, APIs, data, UI flows, jobs, and operations.
---

# impact

Trigger: before editing shared or high-use surfaces.

Scope:
- Identify callers, consumers, siblings, generated files, tests, data flows, and operational paths.
- Check recent history when useful.
- State expected blast radius before editing.

Rules:
- Do not assume a symbol is local because only one file was mentioned.
- For S2/S3 impact, include rollback or mitigation notes.
- If impact is broader than the task, stop and surface the scope change.

Output:

```text
Surface:
Callers/consumers:
Files likely affected:
Generated files:
Tests/checks:
Rollback:
```

