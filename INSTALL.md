# Install

## Quick start

### Windows (PowerShell)

```powershell
git clone https://github.com/KJ-AIML/heli-harness.git hh-source
cd hh-source
git checkout v0.5.11
.\install.ps1 -Parent "C:\your\workspace"
cd ..
# Optional: remove source checkout after install
Remove-Item -Recurse -Force hh-source
```

### macOS / Linux (bash)

```bash
git clone https://github.com/KJ-AIML/heli-harness.git hh-source
cd hh-source
git checkout v0.5.11
./install.sh /path/to/workspace
cd ..
# Optional: remove source checkout after install
rm -rf hh-source
```

## What gets installed

- `.heli-harness/` â€” the full harness (HARNESS.md, skills, adapters, profiles, state, templates)
- `AGENTS.md` â€” pointer file for Codex
- `CLAUDE.md` â€” pointer file for Claude Code

## Claude/Codex plugin artifacts

v0.5.11 also ships local plugin artifact roots:

- `.heli-harness/adapters/claude-plugin/`
- `.heli-harness/adapters/codex-plugin/`

These are `verified-plugin-wired`: manifests, hook configs, skills, and synthetic hook behavior are smoke-tested. They are not a marketplace release and do not prove live runtime enforcement until the host install/trust flow is verified locally.
## Post-install

1. Add repo profiles under `.heli-harness/profiles/`
2. Add team rules under `.heli-harness/policies/` and `.heli-harness/safety/` when needed
3. Add workspace repo mappings under `.heli-harness/workspace/index.json` when working across multiple repos
4. Start agents from the parent workspace
5. Use the first-run prompt (see README.md)

## Pi / AXGA package install

```bash
pi install git:github.com/KJ-AIML/heli-harness@v0.5.11
axga install git:github.com/KJ-AIML/heli-harness@v0.5.11
```

Then run `/heli-install` inside Pi or AXGA to install the workspace harness.

## Uninstall

```bash
# macOS/Linux
./uninstall.sh /path/to/workspace

# Windows
.\uninstall.ps1 -Parent "C:\your\workspace"
```

## Update

```bash
# macOS/Linux
./update.sh /path/to/workspace

# Windows
.\update.ps1 -Parent "C:\your\workspace"
```

State is preserved by default. Use `--reset-state` or `-ResetState` to replace state.
