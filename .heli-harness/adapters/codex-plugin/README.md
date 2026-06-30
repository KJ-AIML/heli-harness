# Heli-Harness Codex Plugin

Status: `verified-plugin-wired`.

This plugin follows the Codex plugin layout: `.codex-plugin/plugin.json`, root-level `skills/`, and root-level `hooks/hooks.json`.

Local test:

```powershell
node scripts/smoke-codex-plugin.mjs
```

The smoke test parses the manifest and hooks, checks hook scripts, and invokes synthetic SessionStart and PreToolUse inputs. It does not prove a live Codex session trusted or executed the hook.
