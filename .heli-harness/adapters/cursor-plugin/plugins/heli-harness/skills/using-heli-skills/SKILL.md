---
name: using-heli-skills
description: Use when starting any Heli-Harness session or before substantive engineering work — selects the smallest compiled workflow and loads specialized skills only when escalation triggers require them.
---

# Using Heli skills

Heli skills are **mandatory when their trigger is active**, but loading methodology that the current workflow does not need is not a safety feature. Start from the smallest compiled workflow profile, then escalate lazily.

Safety, target ownership, task binding, write leases, approval gates, and diagnosis gates are unconditional. A fast path can reduce context/ceremony; it can never bypass those controls.

## Select the workflow first

| Profile | Default minimum path |
|---------|----------------------|
| `S0_QUERY` | establish target/context needed for the answer → inspect/read → answer with evidence |
| `S1_CHANGE` | target checked → premise clear → focused edit → focused verification → completion evidence |
| `S1_FIX` | reproduce/verify premise → focused causal edit → focused verification → completion evidence |
| `S2_INVESTIGATION` | explicit investigation plan → evidence gates → impact/diagnosis as triggered → independent review where required |
| `S3_HIGH_RISK` | explicit plan + approvals → strongest applicable safety/impact/verification workflow → human-controlled mutation/release gates |

For S0/S1, do **not** pre-load `debug`, `impact`, `fix-loop`, `audit`, and every verification skill merely because they exist. Load them when the work crosses their trigger.

## Escalation triggers

- Premise disputed, ambiguous, stale, or not reproduced → `verify-premise`.
- Confirmed but unexplained failure → `debug`.
- Second failed implementation/verification attempt or active `diagnosis.json` → `evidence-gates` + the diagnosis route (`debug`, `fix-loop`, `verify-premise`, `impact`, or `incident`).
- Shared API/schema, cross-package surface, architecture boundary, migration, or non-local blast radius → `impact`.
- Risk or done criteria unclear → `engineering`.
- Release/staging/prod gate, completion claim with broad evidence, or explicit review request → `audit` / the matching verification skill.
- Parent workspace, target selection, task ownership, concurrent writer questions → `heli-governance`, `heli-target`.
- Legacy shared-current-task workspace or multi-agent race → `concurrent-upgrade`.
- Any discovered S2/S3 condition → stop using the S0/S1 fast path and re-route at the higher risk tier.

When a task has an active `diagnosis.json`, read current machine state before treating a hypothesis, failure class, retry, root cause, or completion claim as current. Diagnosis routing takes precedence over the S1 convenience path.

## Before substantive action

1. Identify the Heli workflow profile that matches intent and risk.
2. Check whether an escalation trigger is already active.
3. If the user names a skill, load that skill.
4. Read the **current** skill body when a skill is selected — do not rely on memory of an older version.
5. Load only the selected routing/implementation skills; do not load the whole library.
6. Announce the selected skill briefly when useful (`Using <skill> for <purpose>`).
7. Do not invent skills that are not in the inventory or skill tree.
8. User instructions and Heli safety/ownership rules remain authoritative over skill text.
9. Subagents executing a tightly scoped delegated task inherit the parent's workflow intent; they should not restart the full controller skill stack unless their own evidence triggers escalation.
10. Using a skill must not change Heli task, session, worktree, lease, risk, or approval identity.

## How to load

- **Host-native skill tools** (when the Heli plugin is loaded): invoke the selected skill by its registered name.
- **File form** (always available after workspace install): read `.heli-harness/skills/<name>/SKILL.md` and only the linked `references/` required for the task.

If the host plugin is not loaded, workspace Markdown skills still apply when their triggers match — load them by reading the files. Report that host-native inventory may be incomplete without plugin activation.

## Quick routing

| Situation | Start with |
|-----------|------------|
| Straight read/query | `S0_QUERY`; no extra skill unless triggered |
| Small clear edit | `S1_CHANGE`; focused verify |
| Small confirmed bug | `S1_FIX`; escalate to `debug` only if unexplained |
| Ambiguous next step | `flow` |
| Claimed bug / disputed fact | `verify-premise` |
| Confirmed unexplained bug | `debug` |
| Shared-surface edit | `impact` |
| Risk / done criteria unclear | `engineering` |
| Failed tests / repeated fixes | `fix-loop` + `evidence-gates` |
| Parent workspace / target / concurrent work | `heli-governance`, `heli-target` |
| Old workspace still on shared current-task / multi-agent race | `concurrent-upgrade` |
| Before broad completion/release claim | `audit` or matching verification skill |
| Staging/prod multi-gate ready check | templates `ops-gate-packet.md` + Resume card |

## Red flags

| Rationalization | Reality |
|-----------------|---------|
| "I'll explore first" | Pick the smallest workflow first; escalate when evidence demands it. |
| "Simple task means no safety" | Fast paths remove ceremony, never ownership/safety/approval gates. |
| "I know this skill" | Skills evolve — read the current body when its trigger activates. |
| "No Skill-tool entry" | Read the skill file; still apply it when triggered. |
| "Load everything to be safe" | Context cost is real; unrelated methodology can reduce clarity. |
| "I should run debug just in case" | Debug is an escalation path for unexplained/failed work, not a tax on every edit. |
| "Skill use will mess up my session" | Skills are instructions; they do not rebind task/session/lease. |
