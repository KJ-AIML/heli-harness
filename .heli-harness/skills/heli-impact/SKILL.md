---
name: heli-impact
description: Impact analysis for a planned change or current diff
triggers:
  - /heli-impact
  - heli impact
  - impact analysis
  - what will this affect
---

# Heli-Harness Impact

Impact analysis for a planned change or current diff.

## Workflow

1. **Read harness context**
   - Read `.heli-harness/HARNESS.md` as source of truth
   - Read `.heli-harness/skills/impact/SKILL.md` for impact protocol
   - Read `.heli-harness/profiles/<repo>.md` if present
   - Identify target repo and current/planned changes

2. **Inspect changes**
   - Run `git status` to see changed files
   - Run `git diff` to see actual changes
   - If no changes, ask user about planned changes
   - Read changed files to understand context

3. **Map affected areas**
   - Identify affected packages/modules
   - Identify affected tests (unit, integration, e2e)
   - Identify affected documentation
   - Identify affected generated files (builds, lockfiles, shrinkwraps)
   - Identify affected release/deployment processes
   - Identify affected API contracts or public interfaces

4. **Assess risk level**
   - **Low risk**: Local changes, no API changes, tests pass
   - **Medium risk**: Cross-file changes, test updates needed
   - **High risk**: API changes, breaking changes, data migration
   - **Critical risk**: Production deploy, destructive migration, credential rotation

5. **Return impact report**
   - List affected areas
   - Risk level assessment
   - Required verification steps
   - Rollback plan if needed
   - Safest next step

## Impact Categories

- **Packages/modules**: Which parts of the codebase are affected
- **Tests**: Which tests need updates or new tests
- **Documentation**: Which docs need updates
- **Generated files**: Build artifacts, lockfiles, shrinkwraps
- **Release/deployment**: Version bumps, changelog, deployment steps
- **API contracts**: Public interfaces, breaking changes

## Safety Rules

- Do NOT edit files by default
- Do NOT run mutating commands
- Do NOT commit or push
- Preserve dirty user work
- If user asks for fixes, confirm before editing

## Output

Return:
- Affected areas (packages, tests, docs, generated files, release)
- Risk level (low/medium/high/critical)
- Required verification steps
- Rollback plan
- Safest next step
