---
name: incident
description: "Production or urgent incident protocol: mitigate first, preserve evidence, then root cause."
---

# incident

Trigger: production down, data loss risk, security incident, customer-impacting outage, or urgent operational failure.

Scope:

- Stabilize and mitigate before root-cause perfection.
- Preserve timeline, commands, evidence, and decisions.
- Use smallest safe checks.
- Escalate S3 actions for explicit approval.

Rules:

- Do not run destructive commands without explicit user consent.
- Do not deploy, roll back, rotate credentials, or alter production data unless authorized.
- After recovery, route root cause through `debug` and follow-ups through `fix-loop`.
