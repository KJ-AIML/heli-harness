# OpenCode Install

## 1. Workspace harness

Install `.heli-harness/` into the parent workspace (see root INSTALL.md).

## 2. Plugin (required for blocking)

Copy the self-contained plugin and reference it in `opencode.json`:

```bash
mkdir -p .opencode/plugins
cp .heli-harness/adapters/opencode-plugin/heli-harness.mjs .opencode/plugins/heli-harness.mjs
```

`opencode.json` (project root):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["./opencode/plugins/heli-harness.mjs"]
}
```

On Windows, absolute `file:///` URLs also work. Confirm load:

```bash
opencode debug config
# "plugin" array should list the heli-harness.mjs path
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
