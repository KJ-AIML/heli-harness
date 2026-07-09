# Heli-Harness OpenCode Plugin

Local OpenCode plugin (JS module). Copy to `.opencode/plugins/heli-harness.mjs`.

Hooks:

- `tool.execute.before` — blocks `git push`, `.env` writes, stuck/mismatched task state
- `experimental.session.compacting` — injects Heli session context when supported

Depends on workspace `.heli-harness/adapters/shared/hook-core.mjs` at runtime.
