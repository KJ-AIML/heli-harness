# Repo Profile

Repo name: heli-harness

Purpose: Local, markdown-first governance harness for coding agents in parent workspaces.

Target repo mapping:

- Workspace index entry: heli-harness
- Repo path: .
- Git root: .

## Policy references

- `.heli-harness/policies/engineering.md`
- `.heli-harness/policies/security.md`
- `.heli-harness/policies/release.md`
- `.heli-harness/policies/testing.md`

## Observed stack

- Fact: Node-based package with a Pi/AXGA extension and dependency-free validation scripts.
- Evidence path: `package.json`
- Evidence path: `extensions/pi-extension.js`
- Evidence path: `scripts/validate-release.mjs`

## Existing patterns

- Observed pattern: governance contracts live in markdown under `.heli-harness/`.
- Classification: recommended convention
- Evidence path: `.heli-harness/HARNESS.md`
- Notes: keep core instructions tool-neutral and adapter-specific behavior under `.heli-harness/adapters/`.

- Observed pattern: local checks are plain Node scripts without extra dependencies.
- Classification: recommended convention
- Evidence path: `scripts/validate-release.mjs`
- Evidence path: `scripts/smoke-extension-load.mjs`
- Notes: keep validation inspectable and runnable from a fresh checkout.

## Recommended conventions

- Recommended convention: keep harness behavior local, markdown-first, and adapter-friendly.
- Why new work should follow it: this matches the product positioning and avoids hidden runtime state.
- Evidence path: `ROADMAP.md`

- Recommended convention: use small dependency-free validation when checking release claims.
- Why new work should follow it: the package exposes `npm run check` without an install step.
- Evidence path: `package.json`

## Known tech debt

- Debt: benchmark examples are illustrative until measured matrix runs are captured.
- Why it is debt: example language can be mistaken for measured evidence without explicit labeling.
- Evidence path: `benchmarks/examples/openmesh-style-ab.md`

## Forbidden patterns

- Forbidden pattern: presenting hypothetical benchmark examples as completed measured results.
- Policy backing or rationale: testing policy forbids presenting hypothetical tests as executed tests.
- Evidence path: `.heli-harness/policies/testing.md`

- Forbidden pattern: editing repos outside the selected target during release cleanup.
- Policy backing or rationale: engineering policy requires target repo context before non-trivial edits.
- Evidence path: `.heli-harness/policies/engineering.md`

## Safer alternatives

- Safer alternative: label illustrative benchmark examples and keep measured results for future run logs.
- Replaces: language that reads like completed experiment evidence.
- Why it is safer: it preserves benchmark ambition while keeping evidence claims honest.
- Evidence path: `benchmarks/README.md`

- Safer alternative: add precise release validation for current docs and shipped defaults.
- Replaces: relying on manual grep for stale references.
- Why it is safer: it fails future releases before stale install docs ship.
- Evidence path: `scripts/validate-release.mjs`

## Command tiers

Safe:
- Command: `git status --short`
- Evidence path: `.heli-harness/safety/command-tiers.md`

Safe:
- Command: `node --check extensions/pi-extension.js`
- Evidence path: `package.json`

Safe:
- Command: `node scripts/smoke-extension-load.mjs`
- Evidence path: `package.json`

Safe:
- Command: `node scripts/validate-release.mjs`
- Evidence path: `package.json`

Requires approval:
- Command: `git tag`
- Evidence path: `.heli-harness/safety/command-tiers.md`

Requires approval:
- Command: `git push`
- Evidence path: `.heli-harness/safety/command-tiers.md`

Forbidden:
- Command: `rm -rf`
- Evidence path: `.heli-harness/safety/command-tiers.md`

## Repo risks

- Risk: stale version references can make install docs point at older tags.
- Evidence path: `README.md`
- Evidence path: `.heli-harness/adapters/pi/README.md`

- Risk: host hook APIs can differ between Pi, AXGA, and local smoke fixtures.
- Evidence path: `extensions/pi-extension.js`
- Evidence path: `scripts/smoke-extension-load.mjs`

## Exceptions

- None currently approved.

## Evidence paths

- Claim: current package version and release scripts are Node-based.
- Path: `package.json`
- What it proves: version source and validation commands.

- Claim: the extension implements status, lint, target, lock, and hook commands.
- Path: `extensions/pi-extension.js`
- What it proves: user-facing Pi/AXGA behavior.

- Claim: release validation is local and dependency-free.
- Path: `scripts/validate-release.mjs`
- What it proves: release gate behavior.

## Operational notes

Branch policy: `main` is the current branch; release/tag actions require approval.

PR policy: Unknown.

Build commands: None required for the shipped package.

Test commands: `npm run check`

Generated-file policy: No generated files are expected for normal docs/script cleanup.

Deployment policy: GitHub release/package distribution is a release action.

Release policy: Update version files, changelog, roadmap baseline, install docs, and validation before tagging.

Ownership/review expectations: Unknown.
