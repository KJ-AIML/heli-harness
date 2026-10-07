---
name: using-heli-skills
description: Use when starting substantive Heli work to resolve layout, select the smallest workflow, and load specialist skills only when their triggers apply; use heli-assistant for situational Heli guidance.
---

# Using Heli Skills

Heli skills are mandatory when their trigger is active, but loading unrelated methodology is not a safety feature.

## Two entry modes

Use `heli-assistant` when the user's question is situational:

- what should I do next with Heli;
- why is a host/session/workspace blocked;
- how do I continue after switching coding tools;
- how should an old workspace migrate;
- whether a task/handoff is needed;
- which Heli command/skill fits the current goal.

Use this skill directly when the work itself is already substantive and you need to select the correct protocol/risk path.

`heli-assistant` explains and routes. It does not replace specialist methodology or grant authority.

## Resolve Heli layout first when it matters

Use:

```bash
heli status
```

- **Linked v0.11:** project overlays may live under `.heli/`; authority is resource-scoped and execution-local; tasks are optional durable work records.
- **Embedded compatibility:** skills/state live under `.heli-harness/`; older task/session/lease workflows may apply.

Safety, trusted policy, resource authority, scoped approvals, and evidence obligations remain unconditional. A workflow fast path never bypasses them.

## Select the workflow

| Profile | Default minimum path |
|---|---|
| `S0_QUERY` | resolve only context needed for the answer -> inspect/read -> answer with evidence |
| `S1_CHANGE` | resolve resource/policy -> focused edit -> focused verification |
| `S1_FIX` | verify premise -> causal edit -> focused verification |
| `S2_INVESTIGATION` | explicit investigation/evidence -> impact/diagnosis as triggered -> independent review where required |
| `S3_HIGH_RISK` | explicit plan + scoped approval -> strongest applicable safety/impact/verification path |

These are workflow/risk summaries, not permission levels.

## Escalation and routing triggers

- situational Heli guidance -> `heli-assistant`
- disputed/ambiguous premise -> `verify-premise`
- confirmed unexplained failure -> `debug`
- repeated relevant failure or active diagnosis -> `evidence-gates` + routed diagnostic skill
- shared API/schema/architecture/migration blast radius -> `impact`
- risk/done criteria unclear -> `engineering`
- release/staging/prod or broad completion claim -> `release` / `audit` / matching verifier
- target/resource/authority questions -> `heli-governance`, `heli-target`
- embedded legacy shared-task migration only -> `concurrent-upgrade`
- broad repo/security/correctness sweep -> `workflow`

## Before substantive action

1. Understand the user's goal.
2. Resolve linked vs embedded layout when Heli state matters.
3. Identify the workflow/risk profile.
4. Check active escalation triggers.
5. Read the current body of each selected specialist skill.
6. Load only relevant skill/reference material.
7. Preserve user intent, trusted policy, authority, grants, and safety boundaries.
8. Do not let skill selection itself mutate authority identity.

## How to load

- Host-native plugin: invoke the registered Heli skill.
- Linked file form: read the relevant project skill under `.heli/skills/` when present, plus packaged Heli skill docs as needed.
- Embedded compatibility: read `.heli-harness/skills/<name>/SKILL.md`.

If host-native activation is not proven, say so; installed files alone do not establish runtime enforcement.

## Quick routing

| Situation | Start with |
|---|---|
| "What should I do with Heli here?" | `heli-assistant` |
| Read/query | `S0_QUERY` |
| Small clear edit | `S1_CHANGE` |
| Small confirmed bug | `S1_FIX` |
| Ambiguous general workflow | `flow` |
| Claimed bug/disputed fact | `verify-premise` |
| Confirmed unexplained bug | `debug` |
| Shared-surface edit | `impact` |
| Repeated failure | `fix-loop` + `evidence-gates` |
| Linked target/resource authority | `heli-governance`, `heli-target` |
| Embedded legacy multi-agent race | `concurrent-upgrade` |
| Release | `release` |
| Completion claim | `audit` or matching verifier |

## Red flags

- "Simple task means no safety." -> Fast paths remove ceremony, not governance.
- "Task name gives me write authority." -> Not in linked v0.11; authority is resource-scoped.
- "The plugin exists, so enforcement is active." -> File presence is not activation proof.
- "Copying the project copies approvals." -> Evidence may move; authorization does not.
- "Heli Assistant told me what to do, so it approved the action." -> Recommendation is not authority or approval.
