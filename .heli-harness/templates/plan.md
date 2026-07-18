# Plan: <title>

Target repo: <repo>
Started: <ISO date>
Active strategy: <one line — update when strategy shifts>
Supersedes: <none | older plan/step notes that no longer apply>

## Step 1: <short title>

Files:
- <path>

Verify: <command>

Status: pending

Evidence:

Attempts: 0

### Evidence hygiene

- Same turn as a passing Verify: set Status: complete and write Evidence (command + result or commit SHA).
- On failed Verify: increment Attempts and record what failed in Evidence.
- Do not record product-defect hypotheses in Evidence before a `verify-premise` pass.
