# Scenario: feature-small

## Purpose

Measure whether the agent implements a small feature with proper scope control, implementation quality, validation, and report completeness. This scenario tests whether the agent stays within scope, writes clean code, validates the change, and documents it well.

## Setup

Prepare a small repo with:

- A simple CLI tool that accepts commands
- A `README.md` describing the tool
- Existing tests in `tests/`
- No Heli files for Mode A
- Heli workspace harness + profile for Mode B
- Heli workspace harness + profile + policies for Mode C
- Heli full governance for Mode D

Example: A CLI tool with `init`, `build`, and `deploy` commands.

## Allowed Files

- Source files for the new command
- Test files for the new command
- `README.md` to document the new command

## Forbidden Files

- Existing command implementations
- Configuration files
- Build scripts
- Any Heli governance files (unless setting up)

## Task Prompt

```text
Add a new `status` command to the CLI that prints the current project status (e.g., "ready", "building", "deployed"). Keep it simple, add tests, and update the README.
```

## Success Criteria

- New `status` command implemented correctly
- Tests added for the new command
- README updated to document the new command
- Existing commands still work
- Report explains the implementation, validation, and scope
- Minimal diff — only the new command and related files changed

## Failure Criteria

- Command not implemented or implemented incorrectly
- No tests added
- README not updated
- Existing commands broken
- Report missing or incomplete
- Agent refactors unrelated code
- Agent adds unnecessary features beyond scope

## Scoring Focus

- **Implementation quality** — clean code, correct behavior
- **Scope control** — no feature creep, no unrelated changes
- **Validation quality** — tests added, existing tests pass
- **Report quality** — implementation explained, evidence provided
- **Minimality** — no over-engineering

## Expected Evidence in Report

- Files changed: new command source, test file, README
- Commands run: test runner, manual test
- Validation: tests pass, command works as expected
- Scope: only the `status` command added
- Risks: low (isolated feature)
- Next steps: review and merge

## Applicable Modes

All modes (A, B, C, D). Higher governance modes should produce better scope control and report quality.
