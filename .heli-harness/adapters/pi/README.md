# Pi Adapter

Heli-Harness can be installed as a Pi package to expose skills and a lightweight extension.

## Install

```bash
pi install git:github.com/KJ-AIML/heli-harness@v0.5.15
axga install git:github.com/KJ-AIML/heli-harness@v0.5.15
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

**Status: supported.** Use the v0.5.15 tag after release.

**Pi / AXGA extension commands:**

| Command | Purpose | Mutates files? |
|---------|---------|----------------|
| `/heli-install` | Install workspace harness | Yes, with confirmation |
| `/hh-install` | Short alias for install | Yes, with confirmation |
| `/hh-status` | Show harness status | No |
| `/heli-help` | Show command help | No |
| `/heli-init` | Bootstrap repo profile | Yes, profile/state only |
| `/heli-review` | Review repo/diff | No by default |
| `/heli-audit` | Audit repo/workspace | No by default |
| `/heli-validate` | Run safe validation flow | Maybe, only with approval |
| `/heli-impact` | Impact/risk analysis | No by default |
| `/heli-hooks` | Show auto hooks status | No |
| `/heli-target` | Show or set active target repo | Yes, target state only |
| `/heli-lock` | Show advisory lock state | No |
| `/heli-hooks probe` | Arm one-shot `before_agent_start` canary | No |
| `/heli-hooks test-guard` | Arm one-shot `tool_call` guard canary | No |

All workflow commands are workspace-aware: they check for `.heli-harness/HARNESS.md` before proceeding and suggest `/heli-install` if missing.

`/hh-status` shows visible harness state: package version, package/workspace mode, current working directory, policy/safety state, workspace index state, known repos, selected target repo, target git root, writes allowed under, target profile state, cwd alignment, advisory lock state, active hooks, recent hook activity, skill count, and probe state.

`/heli-validate lint` runs lightweight local checks for repo profiles, policy overlays, safety overlays, workspace index, target state, advisory locks, and run report completeness. `/heli-validate workspace`, `/heli-validate target`, and `/heli-validate lock` provide focused checks.

Hook observability is opt-in and one-shot:

- `/heli-hooks probe` injects `HELI_HOOK_OK` into the next `before_agent_start` prompt context, then clears.
- `/heli-hooks test-guard` returns `HELI_GUARD_OK` on the next matching dangerous `tool_call`, before the command executes, then clears.
- Normal prompts and normal guarded tool calls do not include these canaries.

`command-rules.json` is consumed by the Pi/AXGA runtime guard where compatible `tool_call` hooks are available. These rules remain the policy source of truth, and the local classifier normalizes common shell forms before matching rules. This is not a sandbox; it is an adapter-level guard that depends on host hook support.

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
git checkout v0.5.15
./install.sh /path/to/workspace
cd ..
# Optional: remove source checkout after install
rm -rf hh-source

# Windows PowerShell
git clone https://github.com/KJ-AIML/heli-harness.git hh-source
cd hh-source
git checkout v0.5.15
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
