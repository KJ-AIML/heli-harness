---
name: heli-init
description: Bootstrap a repo profile for a target repo in the current parent workspace
triggers:
  - /heli-init
  - heli init
  - bootstrap repo profile
  - create repo profile
---

# Heli-Harness Init

Bootstrap a repo profile for a target repo in the current parent workspace.

## Workflow

1. **Read harness context**
   - Read `.heli-harness/HARNESS.md` as source of truth
   - Read `.heli-harness/profiles/` to see existing profiles
   - Read `.heli-harness/workspace/index.json` when present
   - Identify target repo from context or ask user

2. **Inspect target repo**
   - Read repo-local docs (README, AGENTS.md, CLAUDE.md, package files)
   - Inspect repo structure (directories, scripts, config)
   - Identify test commands, build commands, dependencies
   - Do NOT edit target repo source code

3. **Create repo profile**
   - Create or update `.heli-harness/profiles/<repo>.md`
   - Map the profile to one repo entry from `.heli-harness/workspace/index.json` when the workspace index exists
   - Include:
     - Observed stack
     - Existing patterns
     - Recommended conventions
     - Known tech debt
     - Forbidden patterns
     - Safer alternatives
     - Command tiers
     - Repo risks
     - Exceptions
     - Evidence paths
     - Policy references when overlays exist
   - Treat observed patterns as facts, not automatic recommendations
   - Require evidence paths for meaningful claims
   - If a risky existing pattern exists, classify it as possible tech debt and provide a safer alternative
   - Do not use vague phrases like "follow existing patterns" without classification

4. **Update task state**
   - Update `.heli-harness/state/current-task.md`
   - Record: target repo, task, mode, risk tier, files expected to change

## Command Classification

Classify repo commands into:
- **Safe audit-only**: Non-mutating, no API keys, no side effects
- **Broader non-mutating gate**: May auto-fix formatting but no logic changes
- **Mutating/full local gate**: Requires dependencies, may modify files
- **API-credit-consuming**: Requires API keys, consumes credits
- **Release/publish/version**: Production operations, requires approval

## Safety Rules

- Do NOT edit target repo source code
- Do NOT commit or push
- Do NOT run mutating commands without approval
- Do NOT run API-credit-consuming commands without approval
- Preserve dirty user work
- If multiple repos are configured, confirm the target repo before write workflows
- If dependencies are missing, report before installing

## Output

Create `.heli-harness/profiles/<repo>.md` with:
- taxonomy sections from the repo profile template
- evidence paths for meaningful claims
- tech-debt framing for risky existing patterns
- safer alternatives for future work
- policy references when policy overlays exist
