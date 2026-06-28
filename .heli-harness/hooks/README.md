# Hooks

Hooks are optional. No hook may perform destructive actions without explicit user consent.

## Classified Hooks

| Hook | Class | Tool | Optional | What it does | Enable when | Disable by |
|---|---|---|---|---|---|---|
| `scripts/claude-session-baseline.sh` | safe context injection, tool-specific | Claude Code | Yes | Emits SessionStart context telling Claude to read the harness first. | You want automatic harness reminders in Claude sessions. | Remove the hook entry from Claude settings. |

## Risk Notes

- The current preserved hook only emits JSON context. It does not edit files or run repo commands.
- Hook configuration is tool-specific and should live in adapter docs or `hooks/examples/`.
- Review every hook before enabling it in user-level settings.
- Do not enable command-blocking hooks until their failure behavior is tested in the target tool.

## Empty Classes

- Logging/reporting hooks: none migrated.
- Risky command-blocking hooks: none migrated.
- Unused/obsolete hooks: none identified.

