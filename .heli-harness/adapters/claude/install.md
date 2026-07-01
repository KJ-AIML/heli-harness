# Claude Code Install

Use the workspace installer from the repo checkout:

```powershell
.\install.ps1 -Parent "C:\your\workspace"
```

or:

```bash
./install.sh /path/to/workspace
```

The installer creates `CLAUDE.md` in the parent workspace only when that file does not already exist:

```text
Read .heli-harness/adapters/claude/CLAUDE.md first.
```

Updates do not modify the parent workspace `CLAUDE.md`; keep local Claude notes there if needed.

Do not copy Heli-Harness into `%USERPROFILE%\.claude\skills` by default. This harness is intended to live with the parent workspace.

Optional settings examples are packaged for review. v0.5.11 live-verifies the native plugin against a real Claude Code session (`node scripts/live-verify-claude-plugin.mjs`); see the native plugin path in the root README for details.
