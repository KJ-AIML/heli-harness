# Testing Policy

Scope:

- Validation commands, smoke tests, skipped checks, and evidence recording.

## Required

- Run the smallest relevant verification for the change.
- Record every validation command actually run.
- Explain skipped checks when they would normally be expected.

## Recommended

- Start with non-mutating checks before broader or costlier validation.
- Prefer focused smoke tests over broad suites when the task scope is narrow.
- Keep validation reproducible from repo files when possible.

## Forbidden

- Do not claim completion without validation evidence.
- Do not hide failing checks behind summary prose.
- Do not present hypothetical tests as executed tests.

## Requires approval

- Costly external test runs.
- Destructive integration tests.
- Validation that mutates shared environments.

## Exceptions

- Scope:
- Approval:
- Justification:
- Compensating check:
