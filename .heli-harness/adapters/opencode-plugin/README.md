# Heli-Harness OpenCode Plugin

Local OpenCode plugin. Copy the **whole directory contents** into `.opencode/plugins/`:

```bash
mkdir -p .opencode/plugins
cp -R .heli-harness/adapters/opencode-plugin/. .opencode/plugins/
```

Hooks:

- `tool.execute.before` — blocks `git push`, `.env` writes, stuck/mismatched task state
- `experimental.session.compacting` — injects Heli session context when supported

Load requirements (verified against OpenCode 1.18.21):

- The entry file must be named `heli-harness.js` — OpenCode auto-loads `.js`/`.ts`
  files from plugin directories but **does not discover `.mjs`**.
- Copy the tree, not just the entry file: it imports `./shared/hook-core.mjs`
  relative to itself.

Depends on `shared/hook-core.mjs` (shipped inside this directory).
