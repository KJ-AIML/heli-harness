---
name: heli-help
description: Show Heli-Harness commands and what they do
triggers:
  - /heli-help
  - heli help
  - show heli commands
---

# Heli-Harness Help

Show all available Heli-Harness commands and their purposes.

## Available Commands

| Command | Purpose | Mutates Files? |
|---------|---------|----------------|
| `/heli-install` | Install workspace harness | Yes, with confirmation |
| `/hh-install` | Short alias for install | Yes, with confirmation |
| `/hh-status` | Show harness status | No |
| `/heli-help` | Show this help | No |
| `/heli-init` | Bootstrap repo profile | Yes, profile/state only |
| `/heli-review` | Review repo/diff | No by default |
| `/heli-audit` | Audit repo/workspace | No by default |
| `/heli-validate` | Run safe validation flow | Maybe, only with approval |
| `/heli-impact` | Impact/risk analysis | No by default |

## Workflow Commands

All workflow commands (`/heli-init`, `/heli-review`, `/heli-audit`, `/heli-validate`, `/heli-impact`) are workspace-aware:
- Check for `.heli-harness/HARNESS.md` before proceeding
- If missing, suggest `/heli-install`
- If present, execute the workflow safely

## Safety

- No command auto-runs tests, installs, commits, pushes, publishes, or release commands
- All mutating operations require explicit user confirmation
- Workflow commands preserve dirty user work
- Use only the current clean Heli-Harness identity, runtime folder, and commands. Do not use deprecated project names, deprecated runtime folders, or removed commands.
