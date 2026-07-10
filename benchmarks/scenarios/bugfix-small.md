# Scenario: bugfix-small

## Purpose

Measure diagnosis, minimal correction, validation, and evidence-backed reporting.

## Setup

Prepare a small repository with `calculateTotal(items)`, where a loop uses an inclusive upper bound. At the final iteration it reads an undefined array element and attempts to access its `price`; empty arrays therefore fail immediately and non-empty arrays fail after valid items are processed. Include existing tests that do not cover this case. Configure Modes A–D as defined in the benchmark README.

## Allowed Files

- The source file containing `calculateTotal`
- `tests/calculate.test.js`
- `README.md` when documentation needs updating

## Forbidden Files

- Unrelated source, configuration, build, and governance files

## Task Prompt

```text
calculateTotal() fails because it accesses an undefined array element. Fix the root cause, add a regression test, and document the change.
```

## Success Criteria

- The inclusive loop bound is corrected and the regression test fails before the fix.
- Existing relevant tests pass after the fix.
- The report records observed validation and changed files without unrelated refactoring.

## Scoring Focus

Implementation quality, validation, report quality, and minimality are applicable. Other metrics depend on what the run actually involves.
