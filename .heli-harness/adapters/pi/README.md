# Pi Adapter

Heli-Harness can be installed as a Pi package to expose skills and a lightweight extension.

## Install

```bash
pi install git:github.com/KJ-AIML/heli-harness@v0.5.2
axga install git:github.com/KJ-AIML/heli-harness@v0.5.2
```

This installs the Pi package, which does two things:

**What this does:**

1. **Loads 23 Heli-Harness skills** into the host skill system via the `pi.skills` key in `package.json`.
2. **Loads a lightweight Pi extension** (`extensions/pi-extension.js`) that:
   - Announces `Heli-Harness loaded` on session start
   - Detects whether workspace harness is installed in the current folder
   - Provides install commands: `/heli-install`, `/hh-install`
   - Provides status command: `/hh-status`
   - Provides workflow commands: `/heli-help`, `/heli-init`, `/heli-review`, `/heli-audit`, `/heli-validate`, `/heli-impact`

   All workflow commands are workspace-aware: they check for `.heli-harness/HARNESS.md` before proceeding and suggest `/heli-install` if missing.

**What this does NOT do:**

- Does **not** automatically create `.heli-harness/` in any workspace on startup.
- Does **not** set up parent-workspace harness state, profiles, or adapter pointer files automatically.
- Use `/heli-install` or `/hh-install` inside Pi to install the workspace harness into the current folder.
- Workflow commands (`/heli-init`, `/heli-review`, etc.) require workspace harness to be installed first.

**Status: supported.** Remote `git:` install verified for v0.5.2.

### 2. Workspace harness install (recommended)

To get the full harness — state tracking, repo profiles, task protocol, adapter pointers — install the workspace harness. Ask Pi:

```
Install this repo into the current folder as a parent-workspace harness:

https://github.com/KJ-AIML/heli-harness

Use the latest stable tag. Do not install globally. Treat the current
directory as the workspace. Verify .heli-harness/HARNESS.md, AGENTS.md,
and CLAUDE.md exist after install.
```

Or run the installer manually:

```bash
# macOS/Linux
git clone https://github.com/KJ-AIML/heli-harness.git hh-source
cd hh-source
git checkout v0.5.2
./install.sh /path/to/workspace
cd ..
# Optional: remove source checkout after install
rm -rf hh-source

# Windows PowerShell
git clone https://github.com/KJ-AIML/heli-harness.git hh-source
cd hh-source
git checkout v0.5.2
.\install.ps1 -Parent "C:\your\workspace"
cd ..
# Optional: remove source checkout after install
Remove-Item -Recurse -Force hh-source
```

## How Pi should use the harness

Once installed, Pi should:

1. Read `.heli-harness/HARNESS.md` as the source of truth
2. Identify the target repo before editing
3. Read the matching `.heli-harness/profiles/<repo>.md` if it exists
4. Read repo-local docs (AGENTS.md, CLAUDE.md, README, etc.)
5. Update `.heli-harness/state/current-task.md` before non-trivial edits
6. Load only relevant skill docs from `.heli-harness/skills/`

## Safety notes

- Pi packages run with full system access. Inspect source code before installing.
- The workspace harness is opt-in. Pi does not auto-install on startup.
- Use `/heli-install` or `/hh-install` to set up the workspace harness in a specific folder.
- The extension asks for confirmation before modifying the workspace.
