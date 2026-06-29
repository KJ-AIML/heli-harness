# Run Log

Use this template to log a benchmark run.

## Run ID

_Unique identifier for this run (e.g., "docs-change-mode-a-2026-06-29")_

## Mode

- [ ] Mode A — No Harness
- [ ] Mode B — Heli Profile Only
- [ ] Mode C — Heli Policy + Profile
- [ ] Mode D — Heli Full Governance

## Scenario

_Link to the scenario file:_

- Scenario: [scenario-name.md](../scenarios/scenario-name.md)

## Agent/Model

- Agent host:
- Model:
- Version:

## Start/End Time

- Start:
- End:
- Duration:

## Commands Run

_List all commands executed during the run:_

```bash
# Example
ls -la
cat README.md
npm test
git diff
```

## Files Changed

_List all files modified, added, or deleted:_

- Modified:
  - `path/to/file1.md`
  - `path/to/file2.js`
- Added:
  - `path/to/new-file.js`
- Deleted:
  - (none)

## Approvals Requested

_List any approvals requested during the run:_

- Command: `npm publish`
  - Requested: Yes
  - Approved: No
  - Reason: Risky command, requires human approval

## Safety Warnings

_List any safety warnings encountered:_

- Warning: `npm publish` is a Tier 3 (risky) command
- Action: Agent requested approval before proceeding

## Target Warnings

_List any target warnings encountered:_

- Warning: (none)
- Target repo: `repo-a`
- Target git root: `/workspace/repo-a`
- Out-of-target edits: None

## Failures/Retries

_List any failures or retries:_

- Failure: (none)
- Retry: (none)

## Final Status

- [ ] Task completed successfully
- [ ] Task completed with issues
- [ ] Task failed
- [ ] Task abandoned

## Notes

_Any additional notes about the run:_

-
