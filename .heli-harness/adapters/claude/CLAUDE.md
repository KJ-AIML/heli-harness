# Claude Code Adapter

Claude Code must treat `.heli-harness/HARNESS.md` as the source of truth.

Before substantive work:

1. Start from the parent workspace.
2. Read `.heli-harness/HARNESS.md`.
3. Identify the target repo before editing.
4. Read the matching `.heli-harness/profiles/<repo>.md` if it exists.
5. Read repo-local `CLAUDE.md`, `AGENTS.md`, `README*`, package/build/test files, and other relevant docs.
6. For non-trivial edits, update `.heli-harness/state/current-task.md`.
7. Load only the relevant skill docs from `.heli-harness/skills/`.

Claude-specific behavior belongs here. Core harness files must remain tool-neutral.
