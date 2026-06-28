#!/usr/bin/env bash
# Optional Claude Code SessionStart hook for Heli-Harness.
# Emits JSON context only. It does not inspect, edit, or execute repo code.
cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Heli-Harness reminder: read .heli-harness/adapters/claude/CLAUDE.md first, then .heli-harness/HARNESS.md. Identify the target repo before editing. Read the repo profile and repo-local docs where relevant. For non-trivial edits, update .heli-harness/state/current-task.md. Use the smallest relevant skill from .heli-harness/skills/ instead of working from this reminder alone."}}
JSON
