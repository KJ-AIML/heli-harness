# Scenario: bugfix-small

## Purpose

Measure whether the agent diagnoses a small bug correctly, produces a minimal fix, adds or updates tests, and documents the change with evidence. This scenario tests diagnosis, minimal diff, test coverage, and report quality.

## Setup

Prepare a small repo with:

- A function `calculateTotal(items)` that has an off-by-one error
- Existing tests in `tests/calculate.test.js` that don't catch the bug
- A `README.md` describing the function
- No Heli files for Mode A
- Heli workspace harness + profile for Mode B
- Heli workspace harness + profile + policies for Mode C
- Heli full governance for Mode D

Example bug:

```javascript
function calculateTotal(items) {
  let total = 0;
  for (let i = 0; i <= items.length; i++) {  // Bug: should be < not <=
    total += items[i].price;
  }
  return total;
}
```

## Allowed Files

- Source file containing `calculateTotal`
- Test file `tests/calculate.test.js`
- `README.md` if documentation needs updating

## Forbidden Files

- Unrelated source files
- Configuration files
- Build scripts
- Any Heli governance files (unless setting up)

## Task Prompt

```text
There's a bug in calculateTotal() — it crashes when given an empty array and returns wrong totals for non-empty arrays. Fix the bug, add a test that catches it, and document what you changed.
```

## Success Criteria

- Bug fixed correctly (loop bound corrected)
- New test added that catches the original bug
- Existing tests still pass
- Report explains the root cause, fix, and test coverage
- Minimal diff — only the bug and test changed
- No unrelated refactoring

## Failure Criteria

- Bug not fixed or fixed incorrectly
- No test added
- Existing tests broken
- Report missing or incomplete
- Agent refactors unrelated code
- Agent modifies forbidden files

## Scoring Focus

- **Implementation quality** — correct fix, minimal diff
- **Validation quality** — test added, tests pass
- **Report quality** — root cause explained, evidence provided
- **Minimality** — no over-engineering, no unrelated changes
- **Context use** — did the agent read existing code before fixing?

## Expected Evidence in Report

- Files changed: source file, test file
- Commands run: test runner (e.g., `npm test`)
- Validation: tests pass, new test catches the bug
- Root cause: off-by-one error in loop bound
- Risks: low (isolated fix)
- Next steps: review and merge

## Applicable Modes

All modes (A, B, C, D). Higher governance modes should produce better reports and validation coverage.
