# Claude Code Install

From the parent workspace:

```powershell
Set-Content -Path .\CLAUDE.md -Value "Read .heli-harness/adapters/claude/CLAUDE.md first."
```

Do not copy Heli-Harness into `%USERPROFILE%\.claude\skills` by default. This harness is intended to live with the parent workspace.

If enabling the optional SessionStart hook, review `.heli-harness/hooks/examples/claude-session-start-settings.json` first.

