---
name: heli-review
description: Use when reviewing the current repo, diff, or task safely without making changes (/heli-review, review this).
---

# Heli-Harness Review

Review current repo, diff, or task safely without making changes.

## Workflow

1. **Read harness context**
   - Read `.heli-harness/HARNESS.md` as source of truth
   - Read `.heli-harness/profiles/<repo>.md` if present
   - Identify target repo and current task

2. **Inspect current state**
   - Run `git status` to see changed files
   - Run `git diff` to see actual changes
   - Read changed files to understand context
   - Identify what the change is trying to do

3. **Analyze for issues**
   - Look for bugs, logic errors, edge cases
   - Check for missing tests or test gaps
   - Identify unsafe changes (data loss, security, breaking changes)
   - Check for missing error handling
   - Look for performance issues
   - Check for API/contract violations

4. **Return actionable review**
   - Summarize what the change does
   - List issues found (critical, warnings, suggestions)
   - Suggest fixes or improvements
   - Do NOT edit files unless user explicitly asks

## Safety Rules

- Do NOT edit files by default
- Do NOT run mutating commands
- Do NOT commit or push
- Preserve dirty user work
- If user asks for fixes, confirm before editing

## Output

Return:
- Summary of changes
- Issues found (categorized by severity)
- Suggested fixes
- Safest next action
