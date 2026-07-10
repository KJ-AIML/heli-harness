# Install

The workspace harness is the primary install mode. It installs `.heli-harness/` into a parent workspace, alongside `AGENTS.md` and `CLAUDE.md` pointer files.

## Fast path

Ask your agent:

```text
Install https://github.com/KJ-AIML/heli-harness into this folder as a parent-workspace harness. Use the latest stable tag, do not install globally, and confirm that .heli-harness/HARNESS.md, AGENTS.md, and CLAUDE.md exist.
```

## CLI

```bash
npx github:KJ-AIML/heli-harness install <path>
npx github:KJ-AIML/heli-harness update <path>
npx github:KJ-AIML/heli-harness target list
npx github:KJ-AIML/heli-harness status
```

Pin a release when needed: `npx github:KJ-AIML/heli-harness#v0.5.22 install <path>`.

## Manual workspace install

### Windows (PowerShell)

```powershell
git clone https://github.com/KJ-AIML/heli-harness.git hh-source
cd hh-source
git checkout v0.5.22
.\install.ps1 -Parent "C:\your\workspace"
```

### macOS / Linux (bash)

```bash
git clone https://github.com/KJ-AIML/heli-harness.git hh-source
cd hh-source
git checkout v0.5.22
./install.sh /path/to/workspace
```

After a successful install, the source checkout can be removed; do not remove the installed `.heli-harness/` directory.

## First use

Start the agent from the parent workspace. It should read `.heli-harness/HARNESS.md`, identify the target repository, read its profile when present, and update `.heli-harness/state/current-task.md` before non-trivial edits.

In a multi-repo workspace, map repositories in `.heli-harness/workspace/index.json` and select one with `/heli-target set <repo>` before write workflows.

## Adapter setup

Install the workspace harness first. Adapter status, tested scope, and limitations are maintained in [Adapter Support Matrix](docs/ADAPTER_SUPPORT_MATRIX.md).

### Codex

The workspace `AGENTS.md` points to `.heli-harness/adapters/codex/AGENTS.md`. To install the native plugin from the installed workspace:

```bash
codex plugin marketplace add .heli-harness/adapters/codex-plugin
codex plugin add heli-harness@heli-harness
```

### Claude Code

The workspace `CLAUDE.md` points to `.heli-harness/adapters/claude/CLAUDE.md`. To install the native plugin from the installed workspace:

```bash
claude plugin install .heli-harness/adapters/claude-plugin
```

### Cursor and generic agents

- Cursor reads `.heli-harness/adapters/cursor/CURSOR.md`.
- Other agents can use `.heli-harness/adapters/generic/AGENT_INSTRUCTIONS.md`.

### Grok Build

Install user hooks from the installed workspace:

```bash
node .heli-harness/adapters/grok-plugin/install-user-hooks.mjs
```

For optional plugin skills, run `grok plugin install .heli-harness/adapters/grok-plugin --trust`. See `.heli-harness/adapters/grok/install.md`.

### OpenCode

Copy `.heli-harness/adapters/opencode-plugin/heli-harness.mjs` to `.opencode/plugins/heli-harness.mjs` and list `./opencode/plugins/heli-harness.mjs` in the `plugin` array in `opencode.json`. See `.heli-harness/adapters/opencode/install.md`.

### Kimi Code CLI

```bash
node .heli-harness/adapters/kimi-plugin/install-user-hooks.mjs
kimi doctor config
```

See `.heli-harness/adapters/kimi/install.md`.

### Antigravity CLI

Stage `.heli-harness/adapters/antigravity-plugin/` in the host plugin directory. See `.heli-harness/adapters/antigravity/install.md`.

### Pi / AXGA package

```bash
pi install git:github.com/KJ-AIML/heli-harness@v0.5.22
axga install git:github.com/KJ-AIML/heli-harness@v0.5.22
```

This installs the agent package, not a workspace harness. Run `/heli-install` in Pi or AXGA to create the workspace harness.

## Update

```bash
npx github:KJ-AIML/heli-harness update /path/to/workspace
```

Or, from a source checkout, run `./update.sh /path/to/workspace` on macOS/Linux or `.\update.ps1 -Parent "C:\your\workspace"` on Windows.

## Uninstall

```bash
npx github:KJ-AIML/heli-harness uninstall /path/to/workspace
```

Or, from a source checkout, run `./uninstall.sh /path/to/workspace` on macOS/Linux or `.\uninstall.ps1 -Parent "C:\your\workspace"` on Windows. Remove `AGENTS.md` and `CLAUDE.md` afterwards only if they are no longer needed.

## Maintainer-only live verification

The `scripts/live-verify-*.mjs` commands are release-proof commands, not user setup. Run them only with isolated credentials and disposable workspaces: they may make API calls and consume provider usage. Their evidence and limitations are recorded in [Adapter Support Matrix](docs/ADAPTER_SUPPORT_MATRIX.md).
