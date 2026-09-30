# Heli-Harness Antigravity Plugin

Plugin bundle for Google Antigravity CLI:

- `plugin.json` — required marker
- `hooks.json` — SessionStart + PreToolUse; each runs its entry point under `hooks/`, so both report the same host id (`antigravity`)
- `hooks/heli-*.mjs` — entry points that load the Claude-style wrappers from `shared/`; the PreToolUse one denies if the wrapper cannot load
- `skills/` — governance skills

Stage under `~/.gemini/antigravity-cli/plugins/heli-harness/` (or the host's current plugin path). Set `HELI_PLUGIN_ROOT` to this plugin directory if the host does not inject it automatically — see install notes.
