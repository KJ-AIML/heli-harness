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

## Maintainer release

From a clean `main` worktree, run `npm run release -- <x.y.z> "summary"`. The command updates current version surfaces, runs `npm run check`, stages only release-managed paths, creates the commit and annotated tag, and refuses unrelated dirty files. Add `--push` to push `main` and the new tag.

Pin a release when needed: `npx github:KJ-AIML/heli-harness#v0.5.27 install <path>`.

## Manual workspace install

### Windows (PowerShell)

```powershell
git clone https://github.com/KJ-AIML/heli-harness.git hh-source
cd hh-source
git checkout v0.5.27
.\install.ps1 -Parent "C:\your\workspace"
```

### macOS / Linux (bash)

```bash
git clone https://github.com/KJ-AIML/heli-harness.git hh-source
cd hh-source
git checkout v0.5.27
./install.sh /path/to/workspace
```

After a successful install, the source checkout can be removed; do not remove the installed `.heli-harness/` directory.

### Clean install semantics (v0.5.27+)

`heli install` (and `install.sh` / `install.ps1` / Pi `/heli-install`) copies **distribution assets only** (HARNESS, adapters, skills, policies, safety, templates, manifest) then **constructs** idle operational state. It never copies live package dogfood such as:

- `state/current-task.md` / `plan.md` / `yolo.json` from the source checkout
- `tasks/`, `sessions/`, `bindings/`, `locks/`, reports, or machine-specific targets

A fresh install always starts **idle**, **no target selected**, and **strict YOLO** (no `yolo.json`).

### Update semantics

`heli update` preserves user operational state (`state/`, `tasks/`, `sessions/`, `bindings/`, `locks/`) and local overlays (`profiles/`, `workspace/`, `policies/`, `safety/`). It updates shipped distribution assets only. Use `heli update --reset-state` to reseed idle operational runtime without importing package dogfood. Package checkout sessions/tasks never land in the destination.

## First use

Start the agent from the parent workspace. It should read `.heli-harness/HARNESS.md`, identify the target repository, read its profile when present, and update `.heli-harness/state/current-task.md` before non-trivial edits.

In a multi-repo workspace, map repositories in `.heli-harness/workspace/index.json` and select one with `/heli-target set <repo>` before write workflows.

In concurrent mode, `heli status` shows each active task’s **live** writer session, worktree (from write lease → session → binding → task metadata), lease expiry, target, mode, and reviewer/observer counts.

### Workspace install vs host-native skills

`heli install` installs **workspace governance** (`.heli-harness/`, pointer files, Markdown skill library on disk). It does **not** by itself register host-native skills or hooks with Codex/Claude/other hosts.

Host-native skill inventory requires a second step -- activate the host plugin (see Adapter setup below). Until then:

- skills exist as files under `.heli-harness/skills/` and under adapter plugin trees;
- SessionStart skill bootstrap and PreToolUse guardrails run only when the host plugin is loaded;
- `heli status` reports skill packaging counts and `host activation: installed / activation not verifiable` -- file presence is not live activation proof.

## Adapter setup

Install the workspace harness first. Adapter status, tested scope, and limitations are maintained in [Adapter Support Matrix](docs/ADAPTER_SUPPORT_MATRIX.md).

### Codex

The workspace `AGENTS.md` points to `.heli-harness/adapters/codex/AGENTS.md`.

#### Recommended: Git marketplace (Ponytail-style, upgradeable)

Install from the published repo so Codex treats the marketplace as **Git** and `marketplace upgrade` works (same flow as `DietrichGebert/ponytail`):

```bash
codex plugin marketplace add KJ-AIML/heli-harness
codex plugin add heli-harness@heli-harness
```

Upgrade later:

```bash
codex plugin marketplace upgrade heli-harness
```

Requires a root Codex marketplace manifest at `.agents/plugins/marketplace.json` (indexes the nested plugin under `./.heli-harness/adapters/codex-plugin`). If you previously added a **local** marketplace with the same name, remove it first:

```bash
codex plugin marketplace remove heli-harness
codex plugin remove heli-harness@heli-harness
```

#### Workspace-local dogfood (after `heli install`; not upgradeable)

Use this only when dogfooding the plugin tree that was copied into the parent workspace. Codex requires a real path form (`./…` or absolute) — a bare `.heli-harness/…` source is rejected as invalid:

```bash
codex plugin marketplace add ./.heli-harness/adapters/codex-plugin
codex plugin add heli-harness@heli-harness
```

Local marketplaces cannot be refreshed with `codex plugin marketplace upgrade` (that command only upgrades Git marketplaces).

### Claude Code

The workspace `CLAUDE.md` points to `.heli-harness/adapters/claude/CLAUDE.md`. To install the native plugin from the installed workspace:

```bash
claude plugin install .heli-harness/adapters/claude-plugin
```

### Cursor

For local marketplace testing, select `.heli-harness/adapters/cursor-plugin/` in Cursor. It contains `.cursor-plugin/marketplace.json`, which indexes the plugin under `plugins/heli-harness/`. Alternatively, copy `.heli-harness/adapters/cursor-plugin/plugins/heli-harness/` to `~/.cursor/plugins/local/heli-harness/`, then restart Cursor or run `Developer: Reload Window`.

The existing pointer adapter remains available for parent-workspace setup:

- Cursor reads `.heli-harness/adapters/cursor/CURSOR.md`.

### Generic agents
- Other agents can use `.heli-harness/adapters/generic/AGENT_INSTRUCTIONS.md`.

### Grok Build

Install user hooks from the installed workspace:

```bash
node .heli-harness/adapters/grok-plugin/install-user-hooks.mjs
```

For optional plugin skills, run `grok plugin install .heli-harness/adapters/grok-plugin --trust`. See `.heli-harness/adapters/grok/install.md`.

### OpenCode

Copy `.heli-harness/adapters/opencode-plugin/heli-harness.mjs` to `.opencode/plugins/heli-harness.mjs`; OpenCode auto-loads project plugins from that directory. See `.heli-harness/adapters/opencode/install.md`.

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
pi install git:github.com/KJ-AIML/heli-harness@v0.5.27
axga install git:github.com/KJ-AIML/heli-harness@v0.5.27
```

This installs the agent package, not a workspace harness. Run `/heli-install` in Pi or AXGA to create the workspace harness.

## Update

### Workspace harness

```bash
npx github:KJ-AIML/heli-harness update /path/to/workspace
```

Or, from a source checkout, run `./update.sh /path/to/workspace` on macOS/Linux or `.\update.ps1 -Parent "C:\your\workspace"` on Windows.

`heli update` refreshes **workspace** distribution assets only. It does **not** upgrade host-native plugins or Codex marketplace snapshots. After updating the workspace, refresh host plugins separately.

### Codex plugin (Git marketplace)

If you installed with `codex plugin marketplace add KJ-AIML/heli-harness`:

```bash
codex plugin marketplace upgrade heli-harness
```

If you previously used a **local** path marketplace (`./.heli-harness/adapters/codex-plugin`), switch once so Upgrade works:

```bash
codex plugin remove heli-harness@heli-harness
codex plugin marketplace remove heli-harness
codex plugin marketplace add KJ-AIML/heli-harness
codex plugin add heli-harness@heli-harness
```

Then future updates are:

```bash
npx github:KJ-AIML/heli-harness update /path/to/workspace
codex plugin marketplace upgrade heli-harness
```

## Uninstall

```bash
npx github:KJ-AIML/heli-harness uninstall /path/to/workspace
```

Or, from a source checkout, run `./uninstall.sh /path/to/workspace` on macOS/Linux or `.\uninstall.ps1 -Parent "C:\your\workspace"` on Windows. Remove `AGENTS.md` and `CLAUDE.md` afterwards only if they are no longer needed.

## Maintainer-only live verification

The `scripts/live-verify-*.mjs` commands are release-proof commands, not user setup. Run them only with isolated credentials and disposable workspaces: they may make API calls and consume provider usage. Their evidence and limitations are recorded in [Adapter Support Matrix](docs/ADAPTER_SUPPORT_MATRIX.md).
