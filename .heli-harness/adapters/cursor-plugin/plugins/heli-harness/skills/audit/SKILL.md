---
name: audit
description: Use when someone asks whether a change is correct, safe, or ready — read-only verification of a diff, PR, commit, or claimed fix.
---

# audit

Trigger: verify a completed change without modifying files.

Scope:
- Read the stated intent, acceptance criteria, and diff.
- Check the change against the actual failure mode or requirement.
- Run the smallest relevant verification command.
- Report `PASS`, `FAIL`, or `INCONCLUSIVE` with evidence.

Rules:
- The agent must not edit files while auditing.
- Do not trust "tests pass" unless the agent reruns or inspects the evidence.
- If the audit fails, cite file and line where possible.
- If intent is missing and the diff makes surprising choices, ask for intent instead of inventing it.
- Separate documented, advisory, smoke-proven, and runtime-enforced evidence. A skill or adapter file alone is not enforcement proof.
- For Heli changes, inspect `diagnosis.json`/events, reroute behavior, retry gates, and generated host mirrors when those surfaces are in scope.

Output:

```text
Verdict: PASS | FAIL | INCONCLUSIVE
Scope:
Behavior:
Verification:
Risks:
Next action:
```
