# Heli-Harness Grok Plugin

## What works (live-proven)

1. **User hooks** (blocking):  
   `node .heli-harness/adapters/grok-plugin/install-user-hooks.mjs`  
   → `~/.grok/hooks/heli-harness.json`  
   Live PreToolUse deny of `git push` confirmed via `grok --debug-file`.

2. **Plugin install** (skills inventory):  
   `grok plugin install .heli-harness/adapters/grok-plugin --trust`  
   → skills `heli-governance` / `heli-target` / `heli-install`  
   Note: plugin `has_hooks=true` does **not** currently wire runtime PreToolUse on Grok 0.2.x; user hooks are required for enforcement.

## Layout

- `.claude-plugin/plugin.json` + `.grok-plugin/plugin.json` (valid `author` object)
- `hooks/heli-pre-tool-use.mjs` — dual Grok+Claude deny payload
- `hooks/heli-session-start.mjs` — context injection
- `install-user-hooks.mjs` — one-command usable install
