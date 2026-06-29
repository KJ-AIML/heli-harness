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
   - Identify target repo from context or ask user

2. **Inspect target repo**
   - Read repo-local docs (README, AGENTS.md, CLAUDE.md, package files)
   - Inspect repo structure (directories, scripts, config)
   - Identify test commands, build commands, dependencies
   - Do NOT edit target repo source code

3. **Create repo profile**
   - Create or update `.heli-harness/profiles/<repo>.md`
   - Include:
     - Repo overview and architecture
     - Test commands (classified by safety)
     - Build commands
     - Dependency state
     - High-risk files and commands
     - Git status
     - Safest next action

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
- If dependencies are missing, report before installing

## Output

Create `.heli-harness/profiles/<repo>.md` with:
- Overview and architecture
- Test commands (classified)
- Build commands
- Dependency state
- High-risk files/commands
- Git status
- Safest next action
