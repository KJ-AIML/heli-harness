# Heli-Harness

Heli-Harness v0.11.2 is the governance protocol for coding agents in this workspace. Heli's hooks enforce a small set of hard rules; the rest of this file is how to work well under them. In a **linked** project the binding lives in `.heli/` and live authority (sessions, grants, resource authority, YOLO) is execution-local. An **embedded** workspace keeps everything in `.heli-harness/`; there, also read `HARNESS-embedded.md`.

## Start

- Run `heli status` when Heli state matters for the task: layout, target repo, YOLO, other sessions.
- Identify the target repo before editing. In a workspace with several repos, do not guess.
- Read the target's repo profile (`.heli/profiles/` or `.heli-harness/profiles/`) and repo-local `AGENTS.md`, `CLAUDE.md`, `README*`, package and test configuration where relevant. Do not assume branch, test, release, deploy or ownership policy they do not state.
- Preserve dirty user work: never revert, overwrite, move or delete changes you did not make unless the user asks.

## What the hooks enforce

- **Hard denies (T6):** recursive forced deletes, `git reset --hard`, destructive `git clean`, agent-run approval commands (`heli grant issue`, `heli yolo on`, `heli run approve`, `heli governance set`, takeovers), and writes to Heli's own state or to a linked project's governance files (`.heli/safety`, `.heli/policies`, the binding). Nothing lifts them.
- **Approvals from the user's terminal:** remote git writes (`git push`, `gh pr merge`, `git subtree push`), `.env`-style secret writes, and T5 rules (publish, tag, release, deploy, live infrastructure). Read-only and `--dry-run` forms need none.
- **Live write conflicts** with another session on the same paths.
- T0–T4 are guidance, not runtime checks. Heli is a guardrail, not a sandbox.

## When a call is denied

Every deny ends with `Heli recovery: …` and `Next action: …`.

- `SELF_RECOVERABLE`: take the next action and continue. Do not stop to ask.
- `HUMAN_REQUIRED`: do not work around it. Ask the user once, and keep working on the parts of the task that do not need the decision.
- `HARD_DENY`: do not retry it or work around it. Continue another way, or tell the user why the task needs it.

Never retry an unchanged denied action.

## Keep going

- A deny or a failing check blocks one step, not the task. End your turn when the work is done, or when every remaining step needs the user, not before.
- **Two strikes:** when the same check fails twice after real fixes and you have no new information, stop repeating that fix. Write a short diagnosis (what failed, likely causes, the next smallest action) and continue with it. Shell quoting, path, syntax or module-resolution errors are command friction, not strikes.
- Do not repeat an expensive or costly action without a material change or new evidence.
- Use the smallest useful check first; widen only when the evidence asks for it.

## Approved runs

For long or unattended work, write the plan with a ```` ```heli-run ```` block (`branch`, `push: yes`, `hours`) and ask the user once to run `heli run approve <plan>`. While SessionStart says a run is active: work the plan without asking about what it approves, push only to its branch, never edit the plan file (any change voids the approval), and end with `heli run done`, or `heli run blocked "<what you need>"` when every remaining step needs the user.

## Risk tiers

Workflow summaries, not permission levels.

- `S0`: tiny direct change. The smallest relevant check.
- `S1`: normal fix or feature. Focused verification, scope preserved.
- `S2`: cross-file, API, data, security, concurrency, user-flow or production-impacting work. A short plan, an impact check, verification evidence, and rollback notes where relevant.
- `S3`: one-way door (production deploy, destructive migration, force push, bypassing protection, credential rotation, irreversible data change). Explicit user approval first, with rollback or mitigation notes.

## Done

A task is done when the repo's verification command (or the smallest relevant check) ran and passed, only the files you meant to change changed, and no new errors, warnings or test failures appeared. Say what you did not verify. "Most tests pass" or "it looks right" is not done.

## Durable records

A work record is optional. Use `heli task` when work spans sessions, needs a handoff, coordinates several agents, or carries significant verification or diagnosis. When a premise is disputed, a failure recurs, the responsible subsystem changes or a costly retry is requested, record claim → evidence → transition with `heli diagnosis` (the `evidence-gates` skill). S3 and production mutations stay human-controlled; YOLO lifts neither diagnosis nor retry gates.

## Skills

Heli skills hold the detailed workflows. When a trigger applies, load the skill (the host skill tool, or `skills/<name>/SKILL.md`). Read each skill once per session, and again only if it changed or your context was compacted. A skill never grants authority.

- `using-heli-skills` / `flow`: choosing the workflow when it is unclear.
- `engineering`: risk tier and done criteria.
- `verify-premise`: before fixing a claimed bug or acting on a disputed premise.
- `impact`: before edits that may affect callers, data, APIs, UI flows or operations.
- `debug`: a confirmed but unexplained failure. `fix-loop`: failed tests or repeated fix attempts.
- `audit`: read-only verification of a diff, PR or claimed fix. `test-coverage` / `test-validation`: missing tests, verification commands.
- `heli-governance` / `heli-target`: target and authority questions. `heli-assistant`: what to do next with Heli.
- `branch`, `release`, `deps`, `incident`, `gh-write`: only when their operation applies.
- `cloud-sync`: before any `heli auth|ws|push|pull|sync|init` command.

## Cloud sync boundary

Cloud sync (`heli auth|ws|push|pull|sync|init`) is optional and user-owned. Local-only is the default, and no governance path needs the network. The agent must:

- never run `heli auth login`, `heli ws create|link`, `heli push`, `heli pull`, `heli sync` or `heli init` unless the user asked for that sync action (`heli push`/`heli sync` upload workspace context: T5 egress);
- never create, edit or delete `state/sync.json` or `~/.heli/credentials.json` by hand;
- never turn auto-sync (`heli sync auto`, `heli sync e2e`) on or off, or reconfigure it, on its own initiative;
- treat auto-push output after `heli task complete` (`Pushed vN ...` / `sync.auto: push skipped ...`) as informational: a skipped auto-push is not a failure and needs no retry;
- report a blocked push (secret findings) to the user; only the user decides on `--allow-secrets`.

The user opts out with `heli ws unlink` (server copies remain until `heli ws delete`).

## Adapter boundary

Tool-specific setup lives only in `.heli-harness/adapters/`. Core protocols say "the agent must", not "Codex should" or "Claude should".
