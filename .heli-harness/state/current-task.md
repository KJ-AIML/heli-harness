# Current Task

Target repo: heli-harness

Task: Honest-degradation follow-up from real dogfooding feedback (Evokehub/OpenDocument session): add an adapter enforcement self-check (warn when the SessionStart hook didn't actually inject context, meaning guardrails are advisory only), add a "Relevant skills consulted" field to current-task.md/HARNESS.md, and nudge repo-profile creation when none exists. Also found and fixed a real bug in this same file's own gate: heli-pre-tool-use.mjs's/pi-extension.js's field-parsing regex used `\s*` after the label colon, which spans blank lines and greedily captures the next field's label when a field is left empty.

Mode: implement

Risk tier: S1

Files expected to change:
- .heli-harness/adapters/claude/CLAUDE.md
- .heli-harness/adapters/codex/AGENTS.md
- .heli-harness/HARNESS.md
- .heli-harness/templates/current-task.md
- .heli-harness/adapters/claude-plugin/hooks/heli-pre-tool-use.mjs
- .heli-harness/adapters/codex-plugin/hooks/heli-pre-tool-use.mjs
- extensions/pi-extension.js
- scripts/smoke-*.mjs (regression coverage for the field-parsing fix)
- .heli-harness/state/current-task.md

Dirty files observed:
- none

Planned verification:
- npm run check

Relevant skills consulted:
- none (plain doc/regex edits, no skills/* routing needed)

Current status: complete

Failed attempts count: 0

Next smallest action: none — npm run check passes (140+53 assertions, all green including 2 new regression tests for the field-parsing fix); ready to commit and decide on a version release.
