# Workspace Index

Use `index.json` to list known repos in the parent workspace and map each repo to its git root and profile.

Use `target.json` to record the active target repo for current work.

This directory is lightweight by design:

- `index.json` is reviewable workspace metadata.
- `target.json` is current target state, not long-term memory.
- Missing or incomplete files should produce warnings, not hard failures.
