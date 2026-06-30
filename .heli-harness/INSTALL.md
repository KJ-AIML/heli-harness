# Install (Internal)

This directory contains the Heli-Harness runtime.

## Install to workspace

From the repo root:

```bash
# macOS/Linux
./install.sh /path/to/workspace

# Windows
.\install.ps1 -Parent "C:\your\workspace"
```

This copies `.heli-harness/` to the target workspace and creates adapter pointer files.

## What gets installed

- `.heli-harness/HARNESS.md` — source of truth
- `.heli-harness/manifest.json` — harness metadata
- `.heli-harness/skills/` — 23 skills
- `.heli-harness/adapters/` — agent-specific instructions
- `.heli-harness/profiles/` — repo profiles (empty, user adds)
- `.heli-harness/state/` — task tracking
- `.heli-harness/templates/` — profile templates
- `.heli-harness/hooks/` — optional hooks
- `AGENTS.md` — Codex pointer
- `CLAUDE.md` — Claude Code pointer
