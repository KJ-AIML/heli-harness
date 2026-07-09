# Antigravity CLI Install

Use the workspace installer from the repo checkout:

```powershell
.\install.ps1 -Parent "C:\your\workspace"
```

or:

```bash
./install.sh /path/to/workspace
```

## Plugin

Stage the Heli plugin into Antigravity's plugin directory (exact CLI command may vary by version):

```text
~/.gemini/antigravity-cli/plugins/heli-harness/
```

Copy contents of `.heli-harness/adapters/antigravity-plugin/` into that folder so `plugin.json` and `hooks.json` are present.

Project-level hooks can also be linked via `.agents/hooks.json` pointing at the same command scripts.

Optional pointer:

```text
Read .heli-harness/adapters/antigravity/ANTIGRAVITY.md first.
```

## Verify

```bash
node scripts/smoke-antigravity-adapter.mjs
node scripts/smoke-antigravity-plugin.mjs
```
