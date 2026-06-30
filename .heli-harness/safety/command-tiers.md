# Command Tiers

`command-rules.json` is the source of truth for Pi/AXGA command guard policy where compatible `tool_call` hooks are available. v0.5.6 adds a small local classifier before rule matching: it normalizes whitespace, case, simple chains, shell wrappers, destructive command variants, shell redirection writes, sensitive paths, and obvious secret-like write content. This is not a sandbox and does not replace host permissions.

## T0 - Read-only inspection

- Examples: `rg`, `git status`, `cat`, `ls`
- Default guidance: usually allow

## T1 - Non-mutating validation

- Examples: `node --check`, `bash -n`, lint in read-only mode
- Default guidance: usually allow

## T2 - Local mutation

- Examples: editing tracked files, local code generation inside target repo
- Default guidance: allow after task and profile context are clear

## T3 - Dependency, build, or runtime actions

- Examples: `npm install`, local builds, runtime services, broad test commands
- Default guidance: ask first or report before running

## T4 - Network, API, or cost-bearing actions

- Examples: billable API calls, remote downloads, swarm or hosted test runs
- Default guidance: explicit approval

## T5 - Git, release, or deploy actions

- Examples: `git push`, `git tag`, `npm publish`, release creation
- Default guidance: explicit approval only
- Multi-repo note: require target repo context before running these commands

## T6 - Destructive, secret-bearing, or outside-root actions

- Examples: `rm -rf`, secret printing, force reset, writes outside the target root
- Default guidance: block by default
