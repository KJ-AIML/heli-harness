# OpenCode Install

## 1. Workspace harness

Install `.heli-harness/` into the parent workspace (see root INSTALL.md).

## 2. Plugin (required for blocking)

Copy the plugin **directory contents** into the project plugin directory. OpenCode loads `.js` and `.ts` files from `.opencode/plugins/` automatically at startup:

```bash
mkdir -p .opencode/plugins
cp -R .heli-harness/adapters/opencode-plugin/. .opencode/plugins/
```

Load requirements (verified against OpenCode 1.18.21):

- The entry file must keep the `.js` extension (`heli-harness.js`). OpenCode does **not** auto-discover `.mjs` files — a single-file `heli-harness.mjs` copy silently never loads.
- Copy the tree, not just the entry file: `heli-harness.js` imports `./shared/hook-core.mjs` relative to itself.

For a global install, copy the same tree to `~/.config/opencode/plugins/` instead. Do not add the copied project plugin to `opencode.json`; automatic discovery is the preferred path.

For older/custom configurations, explicit registration remains supported in `opencode.json` (this also works for a `.mjs` entry, which discovery ignores):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["./.opencode/plugins/heli-harness.mjs"]
}
```

On Windows, absolute `file:///` URLs also work. Confirm load:

```bash
opencode debug config
# Confirm the plugin is discovered from the project or global plugin directory.
```

Live check:

```bash
opencode run "Use the bash tool to run: git push origin main"
# Expect tool failure text containing "Heli-Harness blocks git push"
```

## 3. Pointer instructions

Optional: point agents at `.heli-harness/adapters/opencode/OPENCODE.md`.

## Verify

```bash
node scripts/smoke-opencode-adapter.mjs
node scripts/smoke-opencode-plugin.mjs
node scripts/live-verify-opencode-plugin.mjs
```
