# Heli-Harness Claude Code Plugin

Status: `verified-plugin-wired`.

This plugin follows the Claude Code plugin layout: `.claude-plugin/plugin.json`, root-level `skills/`, and root-level `hooks/hooks.json`.

Local test:

```powershell
claude plugin validate .heli-harness/adapters/claude-plugin
node scripts/smoke-claude-plugin.mjs
```

The smoke test parses the manifest and hooks, checks hook scripts, and invokes synthetic SessionStart and PreToolUse inputs. It does not prove a live Claude Code session trusted or executed the hook.
