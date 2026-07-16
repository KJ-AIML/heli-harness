---
name: using-heli-skills
description: Use when starting any Heli-Harness session or before substantive engineering work — establishes how to find, select, and follow Heli skills without loading the entire library.
---

# Using Heli skills

Heli skills are **mandatory workflow resources** when they match the task. They are not optional background reading.

## Before substantive action

1. Check whether a Heli skill applies (host skill inventory and/or `.heli-harness/skills/`).
2. If the user names a skill, load that skill.
3. Read the **current** skill body — do not rely on memory of an older version.
4. Select only skills relevant to this task. Do not load every skill.
5. Prefer process/workflow skills (routing, premise, impact, debug, verification, governance) before implementation detail skills.
6. Announce the selected skill briefly when useful (`Using <skill> for <purpose>`).
7. Do not invent skills that are not in the inventory or skill tree.
8. User instructions and Heli safety/ownership rules remain authoritative over skill text.
9. Subagents executing a tightly scoped task should not restart the full controller skill stack unless the parent assigned a skill-bearing workflow.
10. Using a skill must not change Heli task, session, worktree, or lease identity.

## How to load

- **Host-native skill tools** (when the Heli plugin is loaded): invoke the skill by its registered name.
- **File form** (always available after workspace install): read `.heli-harness/skills/<name>/SKILL.md` and any linked `references/`.

If the host plugin is not loaded, workspace Markdown skills still apply when their triggers match — load them by reading the files. Report that host-native inventory may be incomplete without plugin activation.

## Quick routing

| Situation | Start with |
|-----------|------------|
| Ambiguous next step | `flow` |
| Claimed bug / disputed fact | `verify-premise` |
| Confirmed unexplained bug | `debug` |
| Shared-surface edit | `impact` |
| Risk / done criteria unclear | `engineering` |
| Failed tests / repeated fixes | `fix-loop` |
| Parent workspace / target / concurrent work | `heli-governance`, `heli-target` |
| Before claiming complete | `audit` or verification skill |

## Red flags

| Rationalization | Reality |
|-----------------|---------|
| "I'll explore first" | Skill check comes first; skills tell you how to explore. |
| "I know this skill" | Skills evolve — read the current body. |
| "No Skill-tool entry" | Read the skill file; still apply it. |
| "Load everything to be safe" | Load only what matches; context cost matters. |
| "Skill use will mess up my session" | Skills are instructions; they do not rebind task/session/lease. |
