# Comparison Report

Use this template to compare benchmark runs across modes (A, B, C, D).

## Benchmark Name

_Descriptive name for this comparison (e.g., "docs-change-mode-comparison")_

## Scenario

_Link to the scenario file:_

- Scenario: [scenario-name.md](../scenarios/scenario-name.md)

## Runs Compared

| Mode | Run ID | Run Log | Scorecard |
|---|---|---|---|
| Mode A — No Harness | [run-id-a](mode-a/run-log.md) | [log](mode-a/run-log.md) | [score](mode-a/scorecard.md) |
| Mode B — Heli Profile Only | [run-id-b](mode-b/run-log.md) | [log](mode-b/run-log.md) | [score](mode-b/scorecard.md) |
| Mode C — Heli Policy + Profile | [run-id-c](mode-c/run-log.md) | [log](mode-c/run-log.md) | [score](mode-c/scorecard.md) |
| Mode D — Heli Full Governance | [run-id-d](mode-d/run-log.md) | [log](mode-d/run-log.md) | [score](mode-d/scorecard.md) |

## Summary Verdict

| Mode | Verdict | Category Average |
|---|---|---|
| Mode A | | |
| Mode B | | |
| Mode C | | |
| Mode D | | |

**Overall finding:**

_Summarize which mode performed best and why._

## Metric Comparison Table

| Metric | Mode A | Mode B | Mode C | Mode D |
|---|---|---|---|---|
| First-attempt acceptance | | | | |
| Human interventions | | | | |
| Unexpected file edits | | | | |
| Wrong-repo edits | | | | |
| Out-of-target edits | | | | |
| Unsafe command attempts | | | | |
| Guard/probe evidence | | | | |
| Report completeness | | | | |
| Policy-deviation handling | | | | |
| Profile/tech-debt handling | | | | |
| Target discipline | | | | |
| Validation coverage | | | | |
| Architecture decision quality | | | | |
| LOC changed | | | | |
| Reviewer confidence | | | | |

## Category Comparison Table

| Category | Mode A | Mode B | Mode C | Mode D |
|---|---|---|---|---|
| Safety | | | | |
| Target discipline | | | | |
| Context use | | | | |
| Implementation quality | | | | |
| Validation quality | | | | |
| Report quality | | | | |
| Minimality / anti-overbuild | | | | |
| Human-review readiness | | | | |

## Qualitative Observations

### What Worked Well

_Describe what worked well across modes:_

-

### What Did Not Work Well

_Describe what did not work well across modes:_

-

### Mode-Specific Observations

**Mode A:**

-

**Mode B:**

-

**Mode C:**

-

**Mode D:**

-

## Examples of Drift Prevented

_List specific examples where higher governance modes prevented drift:_

- Example 1:
- Example 2:

## Examples of Overbuild Prevented

_List specific examples where higher governance modes prevented over-engineering:_

- Example 1:
- Example 2:

## Safety Events

_List safety events across modes:_

| Mode | Safety Event | Outcome |
|---|---|---|
| Mode A | | |
| Mode B | | |
| Mode C | | |
| Mode D | | |

## Wrong-Repo or Out-of-Target Events

_List wrong-repo or out-of-target events across modes:_

| Mode | Event | Outcome |
|---|---|---|
| Mode A | | |
| Mode B | | |
| Mode C | | |
| Mode D | | |

## Report Quality Comparison

_Compare report quality across modes:_

- **Mode A:**
- **Mode B:**
- **Mode C:**
- **Mode D:**

## Limitations

_Describe limitations of this comparison:_

- Model behavior may have changed between runs
- Human scoring may be inconsistent
- Token/cost/time not recorded
- Other:

## Recommendation

_Based on this comparison, what is the recommendation?_

- Which mode provides the best governance outcomes?
- Which mode provides the best balance of governance and overhead?
- Should Heli be used in production? In which mode?

**Recommendation:**

_
