# Install Matrix

This document lists all supported install methods for Heli-Harness.

## Workspace Harness Installs

These install `.heli-harness/` into your parent workspace. This is the primary install mode.

| Method | Command | Status | What it installs | Notes |
|--------|---------|--------|------------------|-------|
| Windows PowerShell | `.\install.ps1 -Parent "C:\your\workspace"` | **supported** | Full harness + adapter pointers | Recommended for Windows |
| macOS/Linux bash | `./install.sh /path/to/workspace` | **supported** | Full harness + adapter pointers | Recommended for macOS/Linux |
| Agent prompt | Ask agent to install from GitHub URL | **supported** | Full harness + adapter pointers | Fast-path for any agent |

## Agent Package / Adapter Installs

These expose harness rules/skills to a specific agent host. They do not replace the workspace harness.

| Host | Command | Status | What it installs | Notes |
|------|---------|--------|------------------|-------|
| Pi / AXGA | `pi install git:github.com/KJ-AIML/heli-harness@v0.5.18` or `axga install git:github.com/KJ-AIML/heli-harness@v0.5.18` | **supported** | 23 skills + lightweight extension (startup status, `/heli-install`, `/hh-install`, `/hh-status`, `/heli-target`, `/heli-lock`, `/heli-hooks`, `/heli-validate lint`, command-rule guard, safety classifier) | Does not auto-create `.heli-harness/`. Use `/heli-install` or `/hh-install` to set up workspace. Use the v0.5.18 tag after release |
| Codex | Workspace `AGENTS.md` -> `.heli-harness/adapters/codex/AGENTS.md`; plugin artifacts in `.heli-harness/adapters/codex-plugin/` | **verified-plugin-wired** | Pointer adapter plus `.codex-plugin/plugin.json`, hooks, skills, plugin `AGENTS.md`, and smoke tests | No live runtime hook enforcement proven. Plugin install/trust remains host-controlled |
| Claude Code | Workspace `CLAUDE.md` -> `.heli-harness/adapters/claude/CLAUDE.md`; plugin artifacts in `.heli-harness/adapters/claude-plugin/` | **verified-plugin-wired** | Pointer adapter plus `.claude-plugin/plugin.json`, hooks, skills, and smoke tests | No live runtime hook enforcement proven. Plugin install/trust remains host-controlled |
| Cursor | Workspace `.cursor/rules/` â†’ `.heli-harness/adapters/cursor/CURSOR.md` | **supported** | Adapter created by workspace installer | Requires workspace install first |
| Generic agents | `.heli-harness/adapters/generic/AGENT_INSTRUCTIONS.md` | **supported** | Adapter instructions for any local coding agent | Requires workspace install first |

## Planned Adapters

These adapters are planned but not yet implemented.

| Host | Status | Notes |
|------|--------|-------|
| Windsurf | planned | No timeline |
| Cline | planned | No timeline |
| Gemini | planned | No timeline |
| OpenCode | planned | No timeline |
| OpenClaw | planned | No timeline |

## Install comparison

| Install type | Use case | What you get |
|--------------|----------|--------------|
| Workspace harness | Parent workspace with multiple repos | Full harness: protocols, profiles, state, adapters, skills |
| Pi / AXGA package | Pi or AXGA agent needs harness skills | Skills + extension, no workspace harness |
| Adapter only | Specific agent needs harness instructions | Adapter pointer file, requires workspace harness |

## Safe install

To inspect before installing:

```bash
git clone https://github.com/KJ-AIML/heli-harness.git
cd heli-harness
git checkout v0.5.18
# Review install.sh / install.ps1 before running
./install.sh /path/to/workspace
```

## Post-install cleanup

After a successful workspace install, you can delete the source checkout folder (e.g., `hh-source/` or `heli-harness/`). The installed `.heli-harness/` folder in your workspace is self-contained.

**Do not delete `.heli-harness/` from your workspace** — that is the installed harness.

## What next after install?

1. **Start your agent** (Codex, Claude Code, Cursor, Pi, or generic) from the parent workspace folder.
2. **Read HARNESS.md** — the agent should read `.heli-harness/HARNESS.md` as the source of truth.
3. **Clone or create a target repo** inside the parent workspace.
4. **Create a repo profile** — add a profile under `.heli-harness/profiles/<repo>.md` describing the repo's conventions, test commands, and risk areas. Use templates in `.heli-harness/templates/` as a starting point.
5. **Run test-validation in audit-only mode** — validate that your repo profile's test commands are safe and non-mutating before relying on them.
