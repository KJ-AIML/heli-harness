# Heli-Harness Antigravity Plugin

Plugin bundle for Google Antigravity CLI:

- `plugin.json` — required marker
- `hooks.json` — SessionStart + PreToolUse
- `hooks/heli-*.mjs` — Claude-style shared wrappers
- `skills/` — governance skills

Stage under `~/.gemini/antigravity-cli/plugins/heli-harness/` (or the host's current plugin path). Set `HELI_PLUGIN_ROOT` to this plugin directory if the host does not inject it automatically — see install notes.
