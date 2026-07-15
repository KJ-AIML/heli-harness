# OpenCode Install

## 1. Workspace harness

Install `.heli-harness/` into the parent workspace (see root INSTALL.md).

## 2. Plugin (required for blocking)

Copy the self-contained plugin into the project plugin directory. OpenCode loads JavaScript and TypeScript files from `.opencode/plugins/` automatically at startup:

```bash
mkdir -p .opencode/plugins
cp .heli-harness/adapters/opencode-plugin/heli-harness.mjs .opencode/plugins/heli-harness.mjs
```

For a global install, copy it to `~/.config/opencode/plugins/heli-harness.mjs` instead. Do not add the copied project plugin to `opencode.json`; automatic discovery is the preferred path.

For older/custom configurations, explicit registration remains supported in `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["./opencode/plugins/heli-harness.mjs"]
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
