---
name: using-heli-skills
description: Use at the start of substantive Heli work to select the smallest workflow, resolve linked vs embedded layout, and load specialized skills only when triggers require them.
---

# Using Heli skills

Heli skills are mandatory when their trigger is active, but loading unrelated methodology is not a safety feature.

## Resolve Heli layout first

Run `heli status`.

- **Linked v0.10:** project overlays may live under `.heli/`; authority is resource-scoped and execution-local; tasks are optional durable work records.
- **Embedded compatibility:** skills/state live under `.heli-harness/`; older task/session/lease workflows may apply.

Safety, trusted policy, resource authority, scoped approvals, and evidence obligations remain unconditional. A workflow fast path never bypasses them.

## Select the workflow

| Profile | Default minimum path |
|---|---|
| `S0_QUERY` | resolve context needed for answer → inspect/read → answer with evidence |
| `S1_CHANGE` | resolve resource/policy → focused edit → focused verification |
| `S1_FIX` | verify premise → causal edit → focused verification |
| `S2_INVESTIGATION` | explicit investigation/evidence → impact/diagnosis as triggered → independent review where required |
| `S3_HIGH_RISK` | explicit plan + scoped approval → strongest applicable safety/impact/verification path |

These are workflow/risk summaries, not permission levels.

## Escalation triggers

- disputed/ambiguous premise → `verify-premise`
- confirmed unexplained failure → `debug`
- repeated relevant failure or active diagnosis → `evidence-gates` + routed diagnostic skill
- shared API/schema/architecture/migration blast radius → `impact`
- risk/done criteria unclear → `engineering`
- release/staging/prod or broad completion claim → `audit` / matching verification skill
- target/resource/authority questions → `heli-governance`, `heli-target`
- embedded legacy shared-task migration only → `concurrent-upgrade`

## Before substantive action

1. Resolve linked vs embedded layout.
2. Identify the workflow/risk profile.
3. Check active escalation triggers.
4. Read the current body of any selected skill.
5. Load only relevant skill/reference material.
6. Preserve user intent, trusted policy, authority, grants, and safety boundaries.
7. Do not let skill use itself mutate authority identity.

## How to load

- Host-native plugin: invoke the registered Heli skill.
- Linked file form: read the relevant project skill under `.heli/skills/` when present, plus packaged Heli skill docs as needed.
- Embedded compatibility: read `.heli-harness/skills/<name>/SKILL.md`.

If host-native activation is not proven, say so; installed files alone do not establish enforcement.

## Quick routing

| Situation | Start with |
|---|---|
| Read/query | `S0_QUERY` |
| Small clear edit | `S1_CHANGE` |
| Small confirmed bug | `S1_FIX` |
| Ambiguous next step | `flow` |
| Claimed bug/disputed fact | `verify-premise` |
| Confirmed unexplained bug | `debug` |
| Shared-surface edit | `impact` |
| Repeated failure | `fix-loop` + `evidence-gates` |
| Linked target/resource authority | `heli-governance`, `heli-target` |
| Embedded legacy multi-agent race | `concurrent-upgrade` |
| Release/completion claim | `audit` or matching verifier |

## Red flags

- “Simple task means no safety.” → Fast paths remove ceremony, not governance.
- “Task name gives me write authority.” → Not in linked v0.10; authority is resource-scoped.
- “The plugin exists, so enforcement is active.” → File presence is not activation proof.
- “Copying the project copies approvals.” → Evidence may move; authorization does not.
