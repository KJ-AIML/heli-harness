# Generic Agent Instructions

The agent must treat `.heli-harness/HARNESS.md` as the source of truth.

Before substantive work:

1. Start from the parent workspace.
2. Read `.heli-harness/HARNESS.md`.
3. Identify the target repo before editing.
4. Read the matching `.heli-harness/profiles/<repo>.md` if it exists.
5. Read repo-local agent, README, package, build, and test docs where relevant.
6. For non-trivial edits, update `.heli-harness/state/current-task.md`.
7. Use the relevant skill docs from `.heli-harness/skills/`.

Do not assume branch policy, test commands, generated-file policy, or deployment policy unless repo documentation says so.
