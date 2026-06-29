# Heli-Harness

Heli-Harness gives local coding agents a shared operating system: protocols, repo profiles, state tracking, optional hooks, and adapter instructions. It is designed for a parent workspace that contains many repos and may be touched by many agents.

The source of truth in this repository is `.heli-harness/HARNESS.md`. Tool-specific behavior lives only under `.heli-harness/adapters/`.

## Why this exists

When multiple coding agents (Codex, Claude Code, Cursor, Pi, generic local agents) work across many repos in one workspace, they need shared conventions for:

- Where to find the source of truth
- How to identify the target repo before editing
- How to track the current task
- How to load only the relevant skills
- How to respect repo-specific profiles

Heli-Harness provides that shared layer without replacing repo-local docs.

## Supported agents

- Codex: `.heli-harness/adapters/codex/`
- Claude Code: `.heli-harness/adapters/claude/`
- Cursor: `.heli-harness/adapters/cursor/`
- Pi: `.heli-harness/adapters/pi/`
- Generic agents: `.heli-harness/adapters/generic/`

## Install

Heli-Harness has two install modes. The **workspace harness** is the primary mode — it installs `.heli-harness/` into your parent workspace and is what most users want. The **agent package** mode exposes harness skills/rules to a specific agent host (Pi, etc.) without replacing the workspace model.

### Fast-path (prompt-based)

Ask your agent:

```
Install this repo into the current folder as a parent-workspace harness:

https://github.com/KJ-AIML/heli-harness

Use the latest stable tag (v0.3.0). Do not install globally. Treat the current
directory as the workspace. Verify .heli-harness/HARNESS.md, AGENTS.md,
and CLAUDE.md exist after install.
```

### Manual workspace install

#### Windows (PowerShell)

```powershell
git clone https://github.com/KJ-AIML/heli-harness.git hh-source
cd hh-source
git checkout v0.3.0
.\install.ps1 -Parent "C:\your\workspace"
cd ..
# Optional: remove source checkout after install
Remove-Item -Recurse -Force hh-source
```

#### macOS / Linux (bash)

```bash
git clone https://github.com/KJ-AIML/heli-harness.git hh-source
cd hh-source
git checkout v0.3.0
./install.sh /path/to/workspace
cd ..
# Optional: remove source checkout after install
rm -rf hh-source
```

### Pi agent harness

Pi can load Heli-Harness as a package to get skills and an extension:

```bash
pi install git:github.com/KJ-AIML/heli-harness@v0.3.0
```

This installs the Pi package, which does two things:

1. **Loads Heli-Harness skills** into Pi's skill system (audit, branch, debug, deps, design, engineering, feature, fix-loop, flow, gh-write, impact, incident, release, test-coverage, test-validation, verify-premise, workflow).
2. **Loads a lightweight Pi extension** (`extensions/pi-extension.js`) that announces status on session start and provides the `/heli-install` command.

On session start, the extension reports:

- `Heli-Harness loaded`
- `Workspace harness detected` — if `.heli-harness/HARNESS.md` exists in the current folder
- `Pi package loaded; workspace harness not installed in this folder` — if not detected

**Pi extension commands:**

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

All workflow commands (`/heli-init`, `/heli-review`, `/heli-audit`, `/heli-validate`, `/heli-impact`) are workspace-aware: they check for `.heli-harness/HARNESS.md` before proceeding and suggest `/heli-install` if missing.

**Important:**

- `pi install ...` does **not** automatically create `.heli-harness/` in every folder. Use `/heli-install` to set up the workspace harness in a specific folder.
- Workspace install remains the source of truth for parent-workspace behavior.
- Pi packages run with full system access. Inspect source code before installing.
- **Status: supported** — verified with Pi v0.80.2 (local path install; remote `git:` install verified for v0.3.0).

### Codex

Current supported path:

1. Install the workspace harness into your parent folder (see above).
2. Codex reads the workspace `AGENTS.md`, which points to `.heli-harness/adapters/codex/AGENTS.md`.
3. Codex follows the adapter instructions.

No marketplace plugin. No global install.

### Claude Code

Current supported path:

1. Install the workspace harness into your parent folder (see above).
2. Claude Code reads the workspace `CLAUDE.md`, which points to `.heli-harness/adapters/claude/CLAUDE.md`.
3. Claude Code follows the adapter instructions.

Optional hooks require review/consent. No marketplace plugin. No global install.

### Cursor

Current supported path:

1. Install the workspace harness into your parent folder (see above).
2. Cursor reads `.heli-harness/adapters/cursor/CURSOR.md`.
3. Cursor follows the adapter instructions.

No marketplace plugin. No global install.

### Generic agents

For any other local coding agent:

1. Install the workspace harness into your parent folder (see above).
2. Point your agent at `.heli-harness/adapters/generic/AGENT_INSTRUCTIONS.md`.
3. The agent follows the generic instructions.

## Safe install

If you want to inspect before installing:

```bash
git clone https://github.com/KJ-AIML/heli-harness.git
cd heli-harness
git checkout v0.3.0
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

## First-run prompt

Use this first-run prompt with your agent:

```
Start from this parent workspace. Read .heli-harness/HARNESS.md, identify the
target repo, read its profile if present, then inspect repo-local docs. Update
.heli-harness/state/current-task.md before non-trivial edits.

Task: <describe task>
```

## Example session

```
You: Add rate-limiting middleware to the auth service.

Agent:
  1. Reads .heli-harness/HARNESS.md
  2. Identifies target repo: auth-service/
  3. Reads .heli-harness/profiles/auth-service.md
  4. Reads auth-service/README.md, package.json, test setup
  5. Updates .heli-harness/state/current-task.md
  6. Implements rate-limiting
  7. Runs tests per profile
  8. Updates state on completion
```

## Uninstall

```bash
# macOS/Linux
./uninstall.sh /path/to/workspace

# Windows
.\uninstall.ps1 -Parent "C:\your\workspace"
```

Then remove adapter pointer files (`AGENTS.md`, `CLAUDE.md`) if no longer needed.

## Update

```bash
# macOS/Linux
./update.sh /path/to/workspace

# Windows
.\update.ps1 -Parent "C:\your\workspace"
```

State is preserved by default. Use `--reset-state` (bash) or `-ResetState` (PowerShell) to replace state from the repo checkout.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
