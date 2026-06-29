# Experiment Plan

Use this template to plan a benchmark experiment.

## Benchmark Name

_Descriptive name for this experiment (e.g., "docs-change-mode-comparison")_

## Repo/Workspace Baseline

_Describe the repo or workspace setup:_

- Repo URL or local path:
- Commit or tag used:
- Branch:
- Workspace structure (if multi-repo):

## Agent/Model Used

- Agent host (e.g., Pi, AXGA, Codex, Claude Code):
- Model (e.g., claude-sonnet-4-20250514, gpt-4):
- Version or commit of agent host:

## Mode Being Tested

- [ ] Mode A — No Harness
- [ ] Mode B — Heli Profile Only
- [ ] Mode C — Heli Policy + Profile
- [ ] Mode D — Heli Full Governance

## Scenario

_Link to the scenario file:_

- Scenario: [scenario-name.md](../scenarios/scenario-name.md)

## Setup Commands

_List the commands needed to prepare the workspace for this mode:_

```bash
# Example for Mode D
git clone <repo-url> workspace
cd workspace
# Install Heli workspace harness
cp -r /path/to/heli-harness/.heli-harness .
# Set up target state
# Configure policies
# etc.
```

## Allowed Tools

_List the tools the agent is allowed to use:_

- File read/write
- Bash commands
- Test runner
- Linter
- Other:

## Safety Restrictions

_List any safety restrictions:_

- No `npm publish` without approval
- No `git push` without approval
- No `rm -rf` without approval
- Other:

## Target Repo

_If multi-repo workspace, specify the target repo:_

- Target repo:
- Target git root:
- Writes allowed under:

## Selected Profile/Policy State

_Describe the profile and policy state for this mode:_

- Profile: [profile-name.md](path/to/profile.md)
- Policies loaded:
  - [engineering.md](path/to/engineering.md)
  - [security.md](path/to/security.md)
  - [release.md](path/to/release.md)
  - [testing.md](path/to/testing.md)
- Safety overlays:
  - [command-tiers.md](path/to/command-tiers.md)
  - [command-rules.json](path/to/command-rules.json)

## Planned Validation

_What validation will be performed after the agent completes the task?_

- [ ] Run tests
- [ ] Run linter
- [ ] Manual code review
- [ ] Diff check
- [ ] Other:

## Run Timestamp

_Record when the experiment was run:_

- Date:
- Time:
- Timezone:

## Notes

_Any additional notes about the experiment setup, assumptions, or constraints:_

-
