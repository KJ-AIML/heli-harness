# Heli-Harness

<p align="center">
  <img src="assets/heli-harness-hero.png" alt="Heli-Harness mascot hero banner — governance for coding agents" width="100%">
</p>

Heli-Harness gives local coding agents a shared governance layer: protocols, repo profiles, policy overlays, state tracking, optional hooks, and adapter instructions. It is designed for a parent workspace that contains many repos and may be touched by many agents.

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

## Roadmap and Architecture

- [Roadmap](ROADMAP.md)
- [Governance model](docs/architecture/governance-model.md)
- [Agent governance research synthesis](docs/research/agent-governance-research-synthesis.md)
- [ADR 0001: Heli as governance harness](docs/decisions/0001-heli-as-governance-harness.md)

## Governance Benchmarks

`benchmarks/` contains repeatable governance benchmark templates for evaluating whether Heli improves coding-agent work quality, safety, target discipline, and report completeness.

- Measures safety, target discipline, report completeness, validation, and implementation quality
- No telemetry — all benchmark data stays local
- Optional manual use — no automated runner required
- Includes scenarios, scoring rubrics, experiment templates, and A/B/C/D comparison examples

See [benchmarks/README.md](benchmarks/README.md) for details.

## Install

Heli-Harness has two install modes. The **workspace harness** is the primary mode — it installs `.heli-harness/` into your parent workspace and is what most users want. The **agent package** mode exposes harness skills/rules to a specific agent host (Pi, etc.) without replacing the workspace model.

### Fast-path (prompt-based)

Ask your agent:

```
Install this repo into the current folder as a parent-workspace harness:

https://github.com/KJ-AIML/heli-harness

Use the latest stable tag (v0.5.4). Do not install globally. Treat the current
directory as the workspace. Verify .heli-harness/HARNESS.md, AGENTS.md,
and CLAUDE.md exist after install.
```

### Manual workspace install

#### Windows (PowerShell)

```powershell
git clone https://github.com/KJ-AIML/heli-harness.git hh-source
cd hh-source
git checkout v0.5.4
.\install.ps1 -Parent "C:\your\workspace"
cd ..
# Optional: remove source checkout after install
Remove-Item -Recurse -Force hh-source
```

#### macOS / Linux (bash)

```bash
git clone https://github.com/KJ-AIML/heli-harness.git hh-source
cd hh-source
git checkout v0.5.4
./install.sh /path/to/workspace
cd ..
# Optional: remove source checkout after install
rm -rf hh-source
```

### Pi / AXGA agent harness

Pi and AXGA can load Heli-Harness as a package to get skills and a lightweight extension:

```bash
pi install git:github.com/KJ-AIML/heli-harness@v0.5.4
axga install git:github.com/KJ-AIML/heli-harness@v0.5.4
```

This installs the agent package, which does two things:

1. **Loads 23 Heli-Harness skills** into the host skill system.
2. **Loads a lightweight Pi/AXGA extension** (`extensions/pi-extension.js`) that announces status, exposes workflow commands, and enables hooks/guards where the host adapter supports them.

On session start, the extension reports:

- `Heli-Harness loaded`
- `Workspace harness detected` if `.heli-harness/HARNESS.md` exists in the current folder
- `Heli-Harness package loaded; run /heli-install to set up workspace harness` if not detected

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

All workflow commands (`/heli-init`, `/heli-review`, `/heli-audit`, `/heli-validate`, `/heli-impact`) are workspace-aware: they check for `.heli-harness/HARNESS.md` before proceeding and suggest `/heli-install` if missing.

`/hh-status` shows visible harness state: package version, package/workspace mode, current working directory, policy/safety state, workspace index state, known repos, selected target repo, target git root, writes allowed under, target profile state, cwd alignment, advisory lock state, active hooks, recent hook activity, skill count, and probe state.

`/heli-validate lint` now runs lightweight local checks for repo profiles, policy overlays, safety overlays, workspace index, target state, advisory locks, and run report completeness. `/heli-validate workspace`, `/heli-validate target`, and `/heli-validate lock` provide focused checks.

`command-rules.json` is consumed by the Pi/AXGA runtime guard where compatible `tool_call` hooks are available. These rules remain the policy source of truth, and v0.5.4 adds a local classifier that normalizes common shell forms before matching rules. The classifier improves detection for repeated whitespace, case variants, simple shell wrappers/chains, publish/release variants, destructive delete variants, shell redirection writes outside `writesAllowedUnder`, sensitive paths, and obvious secret-like write content. This is not a sandbox; it is an adapter-level guard that depends on host hook support.

Hook observability is opt-in and one-shot:

- `/heli-hooks probe` injects `HELI_HOOK_OK` into the next `before_agent_start` prompt context, then clears.
- `/heli-hooks test-guard` returns `HELI_GUARD_OK` on the next matching dangerous `tool_call`, before the command executes, then clears.
- Normal prompts and normal guarded tool calls do not include these canaries.

**Important:**

- `pi install ...` does **not** automatically create `.heli-harness/` in every folder. Use `/heli-install` to set up the workspace harness in a specific folder.
- Workspace install remains the source of truth for parent-workspace behavior.
- Agent packages may run with broad local access. Inspect source code before installing.
- **Status: supported** - verified with AXGA and Pi loading v0.5.4.

### Multi-repo targeting

The current lightweight workspace model supports parent workspaces with many repos:

- `.heli-harness/workspace/index.json` lists known repos, git roots, and profile mappings
- `.heli-harness/workspace/target.json` records the active target repo for current work
- `/heli-target` shows, lists, sets, and clears target state
- write workflows can be warned or intercepted when no target is selected in a configured multi-repo workspace

This is explicit target identity, not orchestration, dependency solving, or monorepo planning. Policies remain prescriptive in `.heli-harness/policies/`, profiles remain descriptive, and measured benchmark matrix runs remain planned v0.5.x work.

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
git checkout v0.5.4
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
