# Repo Profile

Repo name:

Purpose:

## Policy references

- `.heli-harness/policies/engineering.md`
- `.heli-harness/policies/security.md`
- `.heli-harness/policies/release.md`
- `.heli-harness/policies/testing.md`

## Observed stack

- Fact:
- Evidence path:

## Existing patterns

- Observed pattern:
- Classification:
  - fact only
  - recommended convention
  - known tech debt
- Evidence path:
- Notes:

Example:
- Observed pattern: frontend API client uses raw fetch with weak token handling
- Classification: existing pattern, possible known tech debt
- Evidence path: `src/api/client.ts`
- Notes: do not treat this as an automatic recommendation for new integrations

## Recommended conventions

- Recommended convention:
- Why new work should follow it:
- Evidence path:

## Known tech debt

- Debt:
- Why it is debt:
- Evidence path:

## Forbidden patterns

- Forbidden pattern:
- Policy backing or rationale:
- Evidence path:

## Safer alternatives

- Safer alternative:
- Replaces:
- Why it is safer:
- Evidence path:

## Command tiers

Safe:
- Command:
- Evidence path:

Requires approval:
- Command:
- Evidence path:

Forbidden:
- Command:
- Evidence path:

## Repo risks

- Risk:
- Evidence path:

## Exceptions

- Exception:
- Scope:
- Rationale:
- Approval evidence:

## Evidence paths

- Claim:
- Path:
- What it proves:

## Classification checklist

Before using this profile for implementation, verify:

- Existing patterns are not automatically treated as recommended conventions.
- Known tech debt has safer alternatives.
- Recommended conventions have evidence.
- Forbidden patterns are policy-backed where possible.
- Risky implementation choices are connected to security, testing, or release policies.
- Exceptions include rationale and approval evidence when relevant.

## Operational notes

Branch policy:

PR policy:

Build commands:

Test commands:

Generated-file policy:

Deployment policy:

Release policy:

Ownership/review expectations:
