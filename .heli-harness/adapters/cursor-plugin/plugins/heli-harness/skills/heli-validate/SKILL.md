---
name: heli-validate
description: Use when running the Heli test-validation workflow safely with proper command classification (/heli-validate, validate tests).
---

# Heli-Harness Validate

Run test-validation workflow safely with proper command classification.

## Workflow

1. **Read harness context**
   - Read `.heli-harness/HARNESS.md` as source of truth
   - Read `.heli-harness/skills/test-validation/SKILL.md` for validation protocol
   - Read `.heli-harness/profiles/<repo>.md` if present
   - Identify target repo and available test commands

2. **Start with safe audit-only checks**
   - Run non-mutating checks first (lint, type check, dependency checks)
   - Verify commands are safe before running
   - Check if dependencies are installed
   - If dependencies missing, report before installing

3. **Classify test commands**
   - **Safe audit-only**: Non-mutating, no API keys, no side effects
   - **Broader non-mutating gate**: May auto-fix formatting but no logic changes
   - **Mutating/full local gate**: Requires dependencies, may modify files
   - **API-credit-consuming**: Requires API keys, consumes credits
   - **Release/publish/version**: Production operations, requires approval

4. **Run approved tests**
   - Start with safe audit-only commands
   - Ask user before running broader gates
   - Do NOT run mutating/full gates without explicit approval
   - Do NOT run API-credit-consuming commands without explicit approval
   - Do NOT run release/publish/version commands without explicit approval

5. **Report results**
   - Show test results (pass/fail)
   - Identify any failures or warnings
   - Suggest fixes if tests fail
   - Do NOT edit files unless user asks

## Safety Rules

- Do NOT run mutating commands without approval
- Do NOT run API-credit-consuming commands without approval
- Do NOT run release/publish/version commands without approval
- Do NOT commit or push
- Preserve dirty user work
- If dependencies missing, report before installing
- If tests fail, report before attempting fixes

## Output

Return:
- Test results (pass/fail for each command)
- Failures or warnings found
- Suggested fixes
- Safest next action
