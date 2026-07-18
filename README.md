# Heli-Harness

<p align="center">
  <img src="assets/heli-harness-hero.png" alt="Heli-Harness: governance for coding agents" width="100%">
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <a href="CHANGELOG.md"><img alt="Version" src="https://img.shields.io/badge/version-0.5.27-informational"></a>
  <a href="https://github.com/KJ-AIML/heli-harness/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/KJ-AIML/heli-harness/ci.yml?branch=main&label=CI"></a>
  <a href="docs/ADAPTER_SUPPORT_MATRIX.md"><img alt="Adapters" src="https://img.shields.io/badge/adapters-Pi%20%C2%B7%20Claude%20Code%20%C2%B7%20Codex%20%C2%B7%20Cursor-8A2BE2"></a>
</p>

**Shared-workspace governance for coding agents.** Heli-Harness gives every agent working across your repositories the same source of truth for the target, task, policies, and completion report.

## Why Heli-Harness

Without shared context, agents can edit the wrong repository, infer different rules, and leave work without evidence. Heli-Harness adds a workspace-level `.heli-harness/HARNESS.md` while preserving each repository's own documentation.

## What You Get

> Facts describe. Policies decide. Safety enforces. Reports prove.

- **Facts:** evidence-linked repository profiles.
- **Policies:** required, recommended, forbidden, and approval-needed work.
- **Safety:** host-supported hooks and command tiers for selected risky actions.
- **Reports:** a record of files, commands, risks, and completion state.

Heli-Harness is not an agent runtime, planner, or orchestrator; see [the roadmap](ROADMAP.md#not-doing).

## Start with Heli

### 1) Create a parent workspace

Heli installs into a **parent folder** that holds one or more repos (and optional shared folders). Example layout:

```text
my-lab/                          ← open agents from here (parent workspace)
├── repos/
│   ├── my-app/                  ← git repo (product code)
│   └── my-api/                  ← another git repo
├── docs/                        ← shared notes, RFCs, runbooks (optional)
├── resources/                   ← fixtures, dumps, design assets (optional)
├── AGENTS.md                    ← created by install (Codex pointer)
├── CLAUDE.md                    ← created by install (Claude pointer)
└── .heli-harness/               ← created by install (governance)
    ├── HARNESS.md
    ├── workspace/
    │   ├── index.json           ← list known repos
    │   ├── target.json          ← active target
    │   └── schema.json          ← workspace mode
    ├── profiles/                ← per-repo facts (tests, branch policy)
    ├── state/                   ← task / plan (legacy or projection)
    └── skills/
```

Tips:

- Put **git checkouts under `repos/`** so the parent stays tool-neutral.
- Keep **docs / resources outside product repos** when they are workspace-wide, not package source.
- Always start Codex / Claude / Grok from **`my-lab/`**, not from a nested repo root only.

### 2) Install (npx)

From the parent folder (`my-lab/`):

```bash
# pin a release (recommended)
npx github:KJ-AIML/heli-harness#v0.5.27 install .

# or latest main
npx github:KJ-AIML/heli-harness install .
```

Windows PowerShell (same idea):

```powershell
npx github:KJ-AIML/heli-harness#v0.5.27 install .
```

Confirm:

```bash
npx github:KJ-AIML/heli-harness status .
# expect: Heli-Harness version, Workspace mode, Target repo, skill packaging lines
```

You should see `.heli-harness/HARNESS.md`, `AGENTS.md`, and `CLAUDE.md`.

**Update later:**

```bash
npx github:KJ-AIML/heli-harness update .
```

Update refreshes harness files; it does **not** wipe your profiles/tasks. It also does **not** flip an old legacy workspace to concurrent by itself — see skill `concurrent-upgrade` if two agents share one parent.

### 3) Host plugin (so hooks/skills are live)

Workspace install alone puts files on disk. For **Codex** (recommended Git marketplace):

```bash
codex plugin marketplace add KJ-AIML/heli-harness
codex plugin add heli-harness@heli-harness
```

Later:

```bash
codex plugin marketplace upgrade heli-harness
```

Other hosts: [INSTALL.md](INSTALL.md). Without the host plugin, treat governance as **advisory** (files only).

### 4) YOLO after install? **No — keep strict**

A clean install starts **strict** (no `.heli-harness/state/yolo.json`).

| Mode | When |
|------|------|
| **Strict (default)** | Normal and recommended. Guards still apply (e.g. block `git push` / `.env` writes when hooks are live). |
| **`heli yolo on`** | Only when **you** explicitly want unguarded mode for a short, deliberate window. Not for production, secrets, or shared multi-agent work. |

Do **not** enable YOLO as part of first-time setup.

```bash
npx github:KJ-AIML/heli-harness yolo status
# leave off unless you know why you need it
```

### 5) Register repos + target

Edit or have the agent write `.heli-harness/workspace/index.json` so each product repo is known, then set the active target:

```bash
npx github:KJ-AIML/heli-harness target list
npx github:KJ-AIML/heli-harness target set my-app
npx github:KJ-AIML/heli-harness status .
```

Create a profile for the target (tests, branch policy, validation command) under `.heli-harness/profiles/<repo>.md` from the template — or use the open prompt below.

### 6) Open prompt (first session — active Heli + profile + ready to code)

Paste this in a **new agent session opened on the parent workspace** after install + (for Codex) plugin add:

```text
You are in a Heli-Harness parent workspace. Do setup only, then stop for my first real task.

1) Prove Heli is active
   - Read .heli-harness/HARNESS.md
   - Run: npx github:KJ-AIML/heli-harness status .
   - Report: version, workspace mode, target, whether SessionStart/plugin context is present (hooks live vs advisory-only)
   - Confirm AGENTS.md / CLAUDE.md exist

2) Map the workspace
   - List folders under repos/, docs/, resources/ (if present)
   - Ensure .heli-harness/workspace/index.json lists each git repo under repos/ (name, path, gitRoot, profile path)
   - Set the active target with heli-target / target.json to the repo I name (or the only app repo if clear)
   - If target mismatch vs current-task, stop and confirm with me

3) Init repo profile
   - If .heli-harness/profiles/<target>.md is missing, create it from .heli-harness/templates/repo-profile.md
   - Fill: purpose, package manager, first verification command (non-mutating if possible), branch policy if known, evidence paths
   - Do not invent release/deploy policy

4) Task state
   - Leave YOLO strict (do not enable yolo)
   - Seed or update current task as idle/ready for my next request (or create a concurrent task if multi-agent)
   - Keep a short Resume card in task state

5) Reply with a one-screen ready card:
   - Target repo + path
   - Profile path
   - First verify command
   - Governance: enforced vs advisory
   - Mode: legacy vs concurrent
   - Next: waiting for my development task

Do not start product feature work until I give the task.
```

Then send your real task, for example:

```text
Target stays <repo>. Task: <what to build/fix>. Risk: S1/S2. Use Heli task state + profile verify command before claiming done.
```

### 7) Multi-agent (optional)

When two agents may write in the same parent:

```bash
npx github:KJ-AIML/heli-harness task create work-a --work-item A --repo my-app
npx github:KJ-AIML/heli-harness task claim work-a --mode write
# export HELI_SESSION_ID=... from claim output
```

Prefer a separate git worktree per parallel task. Details: `.heli-harness/state/README.md`, skill `concurrent-upgrade`.

Local coordination only — not a distributed lock service or multi-agent runtime.

### Full install matrix

Copy-paste host setup, updates, uninstall: [INSTALL.md](INSTALL.md).

## How It Works

The workspace harness is the shared layer; tool-specific adapters live under `.heli-harness/adapters/`. Repository profiles capture facts, policy overlays state expectations, supported hooks add guardrails, and task state plus reports make work reviewable across handoffs.

## Supported Agents

| Adapter | Status |
| --- | --- |
| Pi | `enforced` |
| Claude Code | `enforced` |
| Codex | `enforced` |
| Cursor | `wired` |
| Grok Build | `enforced` |
| OpenCode | `enforced` |
| Kimi Code CLI | `enforced` |
| Antigravity CLI | `verified-plugin-wired` |
| AXGA and generic agents | `documented` |
| Windsurf, Cline, Gemini, and OpenClaw | `planned` |

The [Adapter Support Matrix](docs/ADAPTER_SUPPORT_MATRIX.md) is the authoritative evidence, verification, and limitation record. Detailed adapter installation commands are in [INSTALL.md](INSTALL.md).

## Proof and Boundaries

Tested hook rules cover named actions including remote pushes and environment-file writes in isolated workspaces. Coverage is deliberately narrow: it is a guardrail, not host permission enforcement or sandbox isolation. See the [support matrix](docs/ADAPTER_SUPPORT_MATRIX.md) for each adapter's tested scope and limits.

## Benchmarks

The local, repeatable [benchmark pack](benchmarks/README.md) measures safety, target discipline, report completeness, and implementation quality across governance modes. It includes scenarios, rubrics, templates, and examples; it is not telemetry or a hosted service.

## Documentation

- [INSTALL.md](INSTALL.md) — installation, updates, removal, and adapter setup.
- [Adapter Support Matrix](docs/ADAPTER_SUPPORT_MATRIX.md) — status evidence and limits.
- [Governance model](docs/architecture/governance-model.md) — the model in depth.
- [Roadmap](ROADMAP.md) — shipped work, next steps, and non-goals.
- [Security policy](SECURITY.md) — vulnerability reporting and security guidance.
- [Contributing](CONTRIBUTING.md) — contribution guidance.
