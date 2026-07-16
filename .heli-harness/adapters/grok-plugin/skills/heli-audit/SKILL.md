---
name: heli-audit
description: Use when asked for a repo-wide audit of overengineering, fragile areas, risky commands, dependency issues, generated-file risks, or CI/test gaps (/heli-audit).
---

# Heli-Harness Audit

Repo-wide audit for overengineering, fragile areas, risky commands, dependency issues, generated-file risks, CI/test gaps.

## Workflow

1. **Read harness context**
   - Read `.heli-harness/HARNESS.md` as source of truth
   - Read `.heli-harness/profiles/<repo>.md` if present
   - Identify target repo

2. **Static inspection first**
   - Inspect repo structure and architecture
   - Look for overengineering (unnecessary abstractions, speculative code)
   - Identify fragile areas (complex logic, tight coupling, missing tests)
   - Check for risky commands (destructive operations, API credit consumption)
   - Review dependency issues (outdated, vulnerable, unnecessary)
   - Check for generated-file risks (untracked builds, lockfile issues)
   - Identify CI/test gaps (missing coverage, flaky tests)

3. **Prefer static inspection**
   - Use `git status`, `git log`, file inspection
   - Read package files, config files, scripts
   - Avoid expensive/API tests unless approved
   - Do NOT run mutating commands

4. **Return audit report**
   - List findings by category
   - Prioritize by risk/severity
   - Suggest fixes or improvements
   - Do NOT edit files unless user asks

## Audit Categories

- **Overengineering**: Unnecessary abstractions, speculative code, dead flexibility
- **Fragile areas**: Complex logic, tight coupling, missing error handling
- **Risky commands**: Destructive operations, API credit consumption, release/publish
- **Dependency issues**: Outdated, vulnerable, unnecessary, unpinned
- **Generated-file risks**: Untracked builds, lockfile issues, shrinkwrap problems
- **CI/test gaps**: Missing coverage, flaky tests, slow tests

## Safety Rules

- Do NOT edit files by default
- Do NOT run mutating commands
- Do NOT run API-credit-consuming commands without approval
- Do NOT commit or push
- Preserve dirty user work
- Prefer static inspection over dynamic testing

## Output

Return:
- Findings by category
- Risk/severity assessment
- Suggested fixes
- Safest next action
