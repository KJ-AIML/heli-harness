# Heli-Harness

Heli-Harness is the source of truth for this parent workspace. It is tool-neutral: Codex, Claude Code, and any other local coding agent must use the same harness protocols, repo profiles, state files, hooks, and templates.

## Operating Model

- The agent starts from the parent workspace that contains multiple repos and `.heli-harness/`.
- The agent must identify the target repo before editing.
- In multi-repo workspaces, the agent should read `.heli-harness/workspace/index.json` and select a target repo before write workflows begin.
- The agent should treat `.heli-harness/workspace/target.json` as the active target record when it exists.
- The agent must read the relevant profile in `.heli-harness/profiles/` when one exists.
- The agent must read policy overlays in `.heli-harness/policies/` when they exist.
- The agent must read safety overlays in `.heli-harness/safety/` when they exist.
- The agent must also read repo-local `AGENTS.md`, `CLAUDE.md`, `README*`, package files, build files, and test configuration where relevant.
- The agent must create or update `.heli-harness/state/current-task.md` before non-trivial edits.
- The agent must preserve dirty user work. Never revert, overwrite, move, or delete user changes unless explicitly asked.
- The agent must not assume branch policy, test commands, generated-file policy, release process, deployment policy, or ownership unless a repo profile or repo docs say so.
- Repo profiles remain descriptive. Team rules belong in policy overlays, and command-risk guidance belongs in safety overlays.
- Repo profiles should classify weak existing patterns as tech debt when appropriate, include evidence paths for meaningful claims, and record safer alternatives for future work.
- Write workflows in multi-repo workspaces should not proceed silently when target identity is ambiguous.
- The agent should check for advisory lock files (session.lock.json, target.lock.json) before write workflows when multiple agents may be active.
- Locks are advisory warnings, not distributed locks. An expired or missing lock should warn, not block.
- The agent must not run expensive loops repeatedly. Use the smallest useful check first, then widen only when evidence requires it.
- After two failed fix attempts, stop coding and write a diagnosis with evidence, likely causes, and the next smallest action.

## Risk Tiers

- `S0`: Tiny direct change. Use the smallest relevant check first.
- `S1`: Normal local fix or feature. Use focused verification and preserve scope.
- `S2`: Cross-file, API, data, security, concurrency, user-flow, or production-impacting work. Requires plan, impact analysis, verification evidence, and rollback notes where relevant.
- `S3`: One-way-door or high-blast-radius action such as production deploy, destructive migration, force push, bypassing protection, credential rotation, or irreversible data change. Requires explicit user approval and rollback or mitigation notes.

## Required Task State

Before non-trivial edits, update `.heli-harness/state/current-task.md` with:

- target repo
- task
- mode
- risk tier
- files expected to change
- dirty files observed
- planned verification
- current status
- failed attempts count
- next smallest action

## Done Criteria

A task is done when:

- The verification command from the repo profile (or the smallest relevant check) ran and passed.
- `git status` shows only the files listed in "files expected to change" were modified. No unintended files changed.
- No new errors, warnings, or test failures were introduced.
- Task state in `current-task.md` is updated: status set to `complete`, failed attempts count recorded.

If verification fails:

1. Increment the failed attempts count in `current-task.md`.
2. Record what failed and why in the state file.
3. Route to `skills/fix-loop` for disciplined retry, or stop and write a diagnosis after two failed attempts.

Do not mark a task complete because "most tests pass" or "it looks right." Run the command, read the output, confirm with evidence.

## Skill Routing

- Use `skills/flow` for ambiguous task routing.
- Use `skills/engineering` for risk tiering and done criteria.
- Use `skills/verify-premise` before fixing a claimed bug or acting on a disputed premise.
- Use `skills/impact` before edits that may affect callers, data, APIs, UI flows, or operations.
- Use `skills/debug` to reproduce, isolate, and explain confirmed bugs.
- Use `skills/fix-loop` after failed tests or repeated fix attempts.
- Use `skills/audit` for read-only verification of a diff, PR, or claimed fix.
- Use `skills/test-coverage` to identify missing or weak tests.
- Use `skills/test-validation` to validate repo profile commands, classify failures, and confirm safe non-mutating verification.
- Use `skills/branch`, `skills/release`, `skills/deps`, `skills/incident`, and `skills/gh-write` only when their scoped operation applies.

## Adapter Boundary

Tool-specific setup lives only in `.heli-harness/adapters/`. Core harness protocols must say "the agent must", not "Codex should" or "Claude should".
