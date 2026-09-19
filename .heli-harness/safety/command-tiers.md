# Command Tiers

**Current release:** `v0.10.0`

`command-rules.json` is a runtime guard policy source where compatible host hooks expose sufficient structured input. The current classifier normalizes common command forms, destructive variants, shell redirection writes, sensitive paths, and obvious secret-like write content before matching rules. This is not a sandbox and does not replace host permissions or executor containment.

Risk tiers summarize workflow impact; they are not authority levels. Actual permission depends on trusted policy, scoped grant when needed, current resource authority, and enforcement/evidence coverage.

## T0 - Read-only inspection

- Examples: `rg`, `git status`, `cat`, `ls`
- Default guidance: usually allow

## T1 - Non-mutating validation

- Examples: `node --check`, `bash -n`, focused read-only lint
- Default guidance: usually allow

## T2 - Local mutation

- Examples: editing tracked files, local code generation inside the resolved resource scope
- Default guidance: allow only when target/resource authority and policy permit

## T3 - Dependency, build, or runtime actions

- Examples: dependency installation, local builds, runtime services, broad test commands
- Default guidance: evaluate side effects/cost and policy obligations

## T4 - Network, API, or cost-bearing actions

- Examples: billable API calls, remote downloads, hosted test runs
- Default guidance: require the applicable scoped approval/policy evidence

## T5 - Git, release, or deploy actions

- Examples: `git push`, `git tag`, `npm publish`, release creation
- Default guidance: explicit scoped approval plus target/resource validation

## T6 - Destructive, secret-bearing, or outside-root actions

- Examples: destructive reset/delete, secret exfiltration, forbidden outside-root mutation
- Default guidance: hard deny by default
- Normal temporary grants do not make T6 rules grantable.
