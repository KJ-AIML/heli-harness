# Heli-Harness

Heli-Harness is the source of truth for this parent workspace. It is tool-neutral: Codex, Claude Code, and any other local coding agent must use the same harness protocols, repo profiles, state files, hooks, and templates.

## Operating Model

- The agent starts from the parent workspace that contains multiple repos and `.heli-harness/`.
- The agent must identify the target repo before editing.
- In multi-repo workspaces, the agent should read `.heli-harness/workspace/index.json` and select a target repo before write workflows begin.
- The agent should treat `.heli-harness/workspace/target.json` as the active target record when it exists.
- The agent must read the relevant profile in `.heli-harness/profiles/` when one exists.
- If no profile exists yet for the identified target repo, the agent should create one from `.heli-harness/templates/repo-profile.md` before S2/S3 work, so branch policy, test commands, and other project-specific facts become durable and discoverable instead of verbal-only for this session.
- A task that naturally breaks into 3+ discrete steps must have those steps recorded in `.heli-harness/state/plan.md` (from `.heli-harness/templates/plan.md`) before starting, with `Files` and `Verify` filled in per step. Immediately after a step's verification passes — not batched at the end — fill that step's `Evidence` (command + result, or commit SHA) and set `Status: complete` before starting the next step. On a failed verification, increment that step's `Attempts` and record what failed in `Evidence`, mirroring the Done Criteria rule below at step granularity. `current-task.md`'s `Plan:` field should point at `.heli-harness/state/plan.md` when one exists, or read `n/a` otherwise.
- `current-task.md`'s `Step count` field is a self-reported number of discrete steps in the current task (0 if the task isn't naturally step-shaped). Set it honestly before starting, not as a formality — it is what lets session-start context warn when `Step count` is 3+ but `Plan` is still `n/a`, catching the exact case where a task obviously needed a plan.md and didn't get one. This is a warning, not a blocking gate: it surfaces the gap instead of leaving it silent, but it does not stop you from proceeding.
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
- On Claude Code and Codex native plugin installs, `PreToolUse` blocks `Edit`/`Write`/`apply_patch` calls when `.heli-harness/state/current-task.md` shows 2+ failed attempts on an incomplete task, or a target repo that doesn't match `.heli-harness/workspace/target.json` — update the state file (or target.json) to resolve it before continuing. This closes the gap where a session in one CLI carries over stale or mismatched task state to a session in a different CLI without either agent noticing.
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
- plan
- step count
- files expected to change
- dirty files observed
- planned verification
- relevant skills consulted
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

The canonical skill library lives under `.heli-harness/skills/`. Host plugins that support native skills (Codex, Claude, and other skill-capable plugins) ship a **full copy** of that library under their plugin `skills/` directory. Workspace install and host plugin activation remain separate: `heli install` places files on disk; host-native skill inventory requires the host plugin to be installed/loaded.

SessionStart injects a short **skill-usage bootstrap** (plus separate task/session governance context). The meta skill `using-heli-skills` defines the full selection protocol.

When a skill matches the task:

1. Prefer the host skill tool when the Heli plugin is loaded and the skill is in inventory.
2. Otherwise read `.heli-harness/skills/<name>/SKILL.md` (and linked `references/`) with your file tools — still mandatory when the trigger applies.

If a trigger condition applies, this is not optional or discretionary:

- Use `using-heli-skills` when starting work or when skill selection is unclear.
- Use `flow` for ambiguous task routing.
- Use `engineering` for risk tiering and done criteria.
- Use `verify-premise` before fixing a claimed bug or acting on a disputed premise.
- Use `impact` before edits that may affect callers, data, APIs, UI flows, or operations.
- Use `debug` to reproduce, isolate, and explain confirmed bugs.
- Use `fix-loop` after failed tests or repeated fix attempts.
- Use `audit` for read-only verification of a diff, PR, or claimed fix.
- Use `test-coverage` to identify missing or weak tests.
- Use `test-validation` to validate repo profile commands, classify failures, and confirm safe non-mutating verification.
- Use `heli-governance` / `heli-target` for parent-workspace and target discipline.
- Use `branch`, `release`, `deps`, `incident`, and `gh-write` only when their scoped operation applies.

Record which skills actually applied (or "none applied" if genuinely none did) in `current-task.md`'s `Relevant skills consulted` field — that field existing is what makes a skipped skill a visible blank instead of a silent omission.

### Red flags — these mean stop and check for a matching skill

| Thought | Reality |
|---------|---------|
| "This is a simple question, I don't need the skill" | Simple tasks are exactly where this discipline drifts first. Check anyway. |
| "I'll just fix this one thing directly" | That is what `fix-loop` / `debug` are for once you're past a first attempt. |
| "There's no Skill-tool entry for this, so it must not apply here" | Read the skill file; it still applies. Host plugin activation may be missing. |
| "I already know what this skill says" | Skills evolve. Read the current body instead of relying on memory of it. |
| "This will slow me down" | An unaudited diff, an unverified fix, or a skipped impact check costs more later than reading one file now. |

## Adapter Boundary

Tool-specific setup lives only in `.heli-harness/adapters/`. Core harness protocols must say "the agent must", not "Codex should" or "Claude should".
