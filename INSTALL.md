# Install

Heli-Harness has two install modes. The **workspace harness** is the primary mode — it installs `.heli-harness/` into your parent workspace and is what most users want. The **agent package** mode exposes harness skills/rules to a specific agent host (Pi, AXGA) without replacing the workspace model.

## Fast-path (prompt-based)

Ask your agent:

```
Install this repo into the current folder as a parent-workspace harness:

https://github.com/KJ-AIML/heli-harness

Use the latest stable tag (v0.5.19). Do not install globally. Treat the current
directory as the workspace. Verify .heli-harness/HARNESS.md, AGENTS.md,
and CLAUDE.md exist after install.
```

## CLI (recommended if Node.js is available)

```bash
npx github:KJ-AIML/heli-harness install <path>
npx github:KJ-AIML/heli-harness update <path>
npx github:KJ-AIML/heli-harness target list
npx github:KJ-AIML/heli-harness status
```

No install step of its own, no npm account, works identically with or without any AI tool loaded.
Pin to a specific release with `npx github:KJ-AIML/heli-harness#v0.5.19 install <path>`. Everything
below (manual scripts, per-adapter paths) remains available as an alternative for environments
without Node.

## Manual workspace install

### Windows (PowerShell)

```powershell
git clone https://github.com/KJ-AIML/heli-harness.git hh-source
cd hh-source
git checkout v0.5.19
.\install.ps1 -Parent "C:\your\workspace"
cd ..
# Optional: remove source checkout after install
Remove-Item -Recurse -Force hh-source
```

### macOS / Linux (bash)

```bash
git clone https://github.com/KJ-AIML/heli-harness.git hh-source
cd hh-source
git checkout v0.5.19
./install.sh /path/to/workspace
cd ..
# Optional: remove source checkout after install
rm -rf hh-source
```

## What gets installed

- `.heli-harness/` — the full harness (HARNESS.md, skills, adapters, profiles, state, templates)
- `AGENTS.md` — pointer file for Codex
- `CLAUDE.md` — pointer file for Claude Code

## Safe install

If you want to inspect before installing:

```bash
git clone https://github.com/KJ-AIML/heli-harness.git
cd heli-harness
git checkout v0.5.19
# Review install.sh / install.ps1 before running
./install.sh /path/to/workspace
```

## Post-install cleanup

After a successful workspace install, you can delete the source checkout folder (e.g., `hh-source/` or `heli-harness/`). The installed `.heli-harness/` folder in your workspace is self-contained.

**Do not delete `.heli-harness/` from your workspace** — that is the installed harness.

## What next after install?

1. **Start your agent** (Codex, Claude Code, Cursor, Pi, or generic) from the parent workspace folder.
2. **Read HARNESS.md** — the agent should read `.heli-harness/HARNESS.md` as the source of truth.
3. **Clone or create target repos** inside the parent workspace.
4. **Map repos in `.heli-harness/workspace/index.json`** so Heli can show known git roots and profile mappings.
5. **Select the active target repo** with `/heli-target set <repo>` before write workflows in a multi-repo workspace.
6. **Create a repo profile** — add a profile under `.heli-harness/profiles/<repo>.md` describing the repo's conventions, test commands, and risk areas. Use templates in `.heli-harness/templates/` as a starting point.
7. **Run test-validation in audit-only mode** — validate that your repo profile's test commands are safe and non-mutating before relying on them.

## First-run prompt

```
Start from this parent workspace. Read .heli-harness/HARNESS.md, identify the
target repo, read its profile if present, then inspect repo-local docs. Update
.heli-harness/state/current-task.md before non-trivial edits.

Task: <describe task>
```

## Multi-repo targeting

The lightweight workspace model supports parent workspaces with many repos:

- `.heli-harness/workspace/index.json` lists known repos, git roots, and profile mappings
- `.heli-harness/workspace/target.json` records the active target repo for current work
- `/heli-target` shows, lists, sets, and clears target state
- write workflows can be warned or intercepted when no target is selected in a configured multi-repo workspace

This is explicit target identity, not orchestration, dependency solving, or monorepo planning.

## Per-adapter install paths

### Codex

Pointer adapter path:

1. Install the workspace harness into your parent folder (see above).
2. Codex reads the workspace `AGENTS.md`, which points to `.heli-harness/adapters/codex/AGENTS.md`.
3. Codex follows the adapter instructions.

Native plugin artifact path:

1. Inspect `.heli-harness/adapters/codex-plugin/`.
2. The package includes `.codex-plugin/plugin.json`, `hooks/hooks.json`, `skills/heli-governance/SKILL.md`, `.agents/plugins/marketplace.json`, and plugin `AGENTS.md`.
3. Run `node scripts/smoke-codex-plugin.mjs` to verify local plugin artifacts and synthetic hook decisions.
4. Run `node scripts/live-verify-codex-plugin-install.mjs` to prove `codex plugin marketplace add` and `codex plugin add` install and trust the plugin against your real, locally installed Codex CLI (isolated `CODEX_HOME`; does not touch your real Codex config).
5. Run `node scripts/live-verify-codex-plugin-hook.mjs` to prove the PreToolUse hook actually denies `git push` and `.env` writes in a real Codex session (isolated `CODEX_HOME`, `--dangerously-bypass-hook-trust`; makes real API calls; requires `codex login`).

Status: `enforced`. A real `codex exec` turn denies both `git push` and a `.env` write via the PreToolUse hook, confirmed via the CLI's own output and the filesystem. See [docs/ADAPTER_SUPPORT_MATRIX.md](docs/ADAPTER_SUPPORT_MATRIX.md) for full evidence.

### Claude Code

Pointer adapter path:

1. Install the workspace harness into your parent folder (see above).
2. Claude Code reads the workspace `CLAUDE.md`, which points to `.heli-harness/adapters/claude/CLAUDE.md`.
3. Claude Code follows the adapter instructions.

Native plugin artifact path:

1. Inspect `.heli-harness/adapters/claude-plugin/`.
2. The package includes `.claude-plugin/plugin.json`, `hooks/hooks.json`, and `skills/heli-governance/SKILL.md`.
3. Run `node scripts/smoke-claude-plugin.mjs` to verify local plugin artifacts and synthetic hook decisions. When the local Claude CLI is available, the smoke also runs `claude plugin validate`.
4. Run `node scripts/live-verify-claude-plugin.mjs` to prove the PreToolUse hook actually denies `git push` and `.env` writes in a real Claude Code session (isolated `--plugin-dir` sandbox; makes real API calls).

Status: `enforced`. A real `claude -p` session loading the plugin via `--plugin-dir` in an isolated sandbox repo denies both `git push` and a `.env` write, confirmed via the session's own `permission_denials` result. This covers `--plugin-dir` session loading, not the marketplace-installed-and-trusted flow (`claude plugin install`). See [docs/ADAPTER_SUPPORT_MATRIX.md](docs/ADAPTER_SUPPORT_MATRIX.md) for full evidence.

### Cursor

1. Install the workspace harness into your parent folder (see above).
2. Cursor reads `.heli-harness/adapters/cursor/CURSOR.md`.
3. Cursor follows the adapter instructions.

No marketplace plugin. No global install.

### Generic agents

For any other local coding agent:

1. Install the workspace harness into your parent folder (see above).
2. Point your agent at `.heli-harness/adapters/generic/AGENT_INSTRUCTIONS.md`.
3. The agent follows the generic instructions.

### Pi / AXGA package install

```bash
pi install git:github.com/KJ-AIML/heli-harness@v0.5.19
axga install git:github.com/KJ-AIML/heli-harness@v0.5.19
```

This installs the agent package, which loads 23 Heli-Harness skills and a lightweight extension (`extensions/pi-extension.js`) that announces status, exposes workflow commands, and enables hooks/guards where the host adapter supports them. `pi install` does **not** automatically create `.heli-harness/` in every folder — run `/heli-install` inside Pi/AXGA to set up the workspace harness. See [.heli-harness/adapters/pi/README.md](.heli-harness/adapters/pi/README.md) for the full command reference.

Agent packages may run with broad local access. Inspect source code before installing.

## Uninstall

```bash
npx github:KJ-AIML/heli-harness uninstall /path/to/workspace
```

Or with a local checkout:

```bash
# macOS/Linux
./uninstall.sh /path/to/workspace

# Windows
.\uninstall.ps1 -Parent "C:\your\workspace"
```

Then remove adapter pointer files (`AGENTS.md`, `CLAUDE.md`) if no longer needed.

## Update

```bash
npx github:KJ-AIML/heli-harness update /path/to/workspace
```

Or with a local checkout:

```bash
# macOS/Linux
./update.sh /path/to/workspace

# Windows
.\update.ps1 -Parent "C:\your\workspace"
```

State is preserved by default. Use `--reset-state` (CLI/bash) or `-ResetState` (PowerShell) to replace state from the repo checkout.
