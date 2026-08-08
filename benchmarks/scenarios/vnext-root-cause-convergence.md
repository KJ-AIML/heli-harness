# vNext Root-Cause Convergence and Evidence-Gate Scenarios

This is a deterministic scenario pack for local Heli-Harness evaluation. It
is not an agent benchmark, does not use provider credits, and has no measured
results. The executable contract is
`node scripts/smoke-vnext-root-cause.mjs`; the scenarios below are its review
rubric and fixture intent.

Use the same task prompt, clean baseline, host, Heli version, and reset method
when comparing modes. Record structured observations through the diagnosis CLI
or equivalent API. Do not infer facts by scraping arbitrary logs.

## Scenario matrix

| # | Scenario | Required transition | Pass condition |
| --- | --- | --- | --- |
| 1 | Observer deadline | Verify premise and closest proven boundary | State says only that terminal state was not observed before the deadline; it does not claim worker death. |
| 2 | Contradicting claim event | Invalidate the active hypothesis | Contradicting evidence is retained, hypothesis is `CONTRADICTED`, and material implementation is rerouted. |
| 3 | Same failure after source change | Preserve failure class identity | A changed source SHA with the same normalized class increments the same-class attempt state. |
| 4 | New downstream failure | Start a fresh diagnosis route | A changed stage/subsystem/error class creates `NEW_FAILURE_CLASS`, resets current hypothesis evidence, and does not burn the old count. |
| 5 | Subsystem migration | Record checkpoint | The checkpoint records what is known, what changed, why the old subsystem is no longer primary, the new boundary, and the next discriminating action. |
| 6 | Costly retry without change | Deny repetition | A repeated expensive action with no new evidence or change returns `RETRY_JUSTIFICATION_REQUIRED`. |
| 7 | Costly retry after material fix | Permit justified retry | A changed source/config/environment/files entry includes a predicted effect and is accepted. |
| 8 | Costly retry after cheaper probes | Permit discriminating retry | New discriminating evidence names cheaper checks and explains why they were inconclusive. |
| 9 | Bounded transient | Permit within policy | A transient policy identifies the policy and remains below its retry bound. |
| 10 | S2 material change | Require independent review metadata | The action is allowed only with evidence; the gate exposes a pending independent-review requirement. |
| 11 | S3 or production mutation | Preserve human authority | The action is denied without explicit human approval evidence, including approver/requester and reason. |
| 12 | Simple S1 success | Keep lightweight path | No diagnosis ceremony is required for a successful simple task; current verification is sufficient for completion. |

## Review notes

- Compare `failureSignature.classKey`, not the full signature, when deciding
  same versus new failure. Source SHA is retained as evidence but is not part
  of class identity.
- A reroute keeps append-only task events and marks old supporting evidence as
  historical. A new route must earn current supporting evidence before a new
  root cause can be established.
- Expensive-action authorization retains the prior run, signature, boundary,
  material change, prediction, discrimination, retry count, and cost class.
- YOLO is tested as a friction setting only. It must not bypass ownership,
  reroute, checkpoint, root-cause, S3, or production gates.
- Unsupported or advisory hosts are scored as advisory; copied Markdown skills
  are not runtime enforcement evidence.

## Suggested run record

```text
Scenario:
Mode: A | B | C | D
Host:
Heli version:
Baseline:
Reset method:
Command:
Observed state transition:
Evidence paths:
Result: PASS | FAIL | NOT OBSERVED
Unverified boundary:
```
