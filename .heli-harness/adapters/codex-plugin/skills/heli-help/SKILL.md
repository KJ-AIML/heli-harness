---
name: heli-help
description: Use when the user asks what Heli can do, which command family exists, or how to find the right Heli workflow; route situational questions to heli-assistant.
---

# Heli Help

Use this skill as the current command map. For "what should I do in this workspace/session?" questions, route to `heli-assistant` instead of dumping every command.

## Start with the current topology

Normal v0.11 usage is:

```bash
npm install -g heli-harness@latest
heli setup
heli host install all
heli host status

cd /path/to/project
heli link
heli doctor
heli status
```

A normal linked project uses `.heli/` project binding plus execution-local runtime authority. A self-contained `.heli-harness/` tree is compatibility/hermetic mode, not the default onboarding path.

## Core command map

| Goal | Command family |
|---|---|
| Understand the current Heli situation | `heli-assistant` skill |
| Inspect project/layout/health | `heli status`, `heli doctor` |
| Continue after switching coding tools | `heli resume`, `heli resume --json` |
| Install/update host integrations | `heli host install|update|repair|remove|status` |
| Inspect runtime enforcement evidence | `heli explain capabilities` |
| Inspect current write/resource authority | `heli explain authority` |
| Link or refresh a project | `heli link`, `heli update` |
| Resolve project target/resource intent | `heli target list|show|set|clear` |
| Create durable work records | `heli task ...` |
| Declare dependencies / publish handoffs | `heli task depends ...`, `heli handoff ...` |
| Inspect or record diagnosis evidence | `heli diagnosis ...` |
| Issue human-scoped temporary approval | `heli grant ...` |
| Human temporary YOLO mode | `heli yolo ...` |
| Optional cloud workspace sync | `heli auth|ws|push|pull|sync ...` |

Run the command's own help surface when exact flags are needed. Do not invent undocumented subcommands.

## Situational questions

Route questions like these to `heli-assistant`:

- "What should I do next?"
- "Why can't Grok/Codex/Claude write?"
- "Codex usage ended; how do I continue?"
- "This repo is still on an old Heli workspace layout."
- "Do I need a durable task?"
- "Why does host status say stale?"
- "Which Heli command solves this?"

The assistant should inspect only the state needed for the goal, explain the situation, and recommend the smallest supported path.

## Ergonomic skill entry points

The packaged `/heli-*` skills are convenience entry points, not separate authority systems:

- `heli-review` -> focused `audit` or broad `workflow`
- `heli-audit` -> broad audit composition
- `heli-impact` -> `impact`
- `heli-validate` -> `test-validation`
- `heli-init` -> project/profile facts
- `heli-install` -> installation/migration guidance
- `heli-target` -> target/resource guidance
- `heli-governance` -> authority/policy model

## Safety and truth boundaries

- Do not infer linked authority from leftover embedded state files.
- Do not treat installed plugin files as proof that runtime callbacks executed.
- Tasks are optional durable work/provenance records in linked v0.11; task names are not the root write-authority boundary.
- Human-only approvals such as grants or YOLO must not be silently issued by an agent.
- Compatibility commands remain available for intentionally embedded workspaces, but do not present them as the normal v0.11 path.
