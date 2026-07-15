# Heli-Harness

<p align="center">
  <img src="assets/heli-harness-hero.png" alt="Heli-Harness: governance for coding agents" width="100%">
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <a href="CHANGELOG.md"><img alt="Version" src="https://img.shields.io/badge/version-0.5.24-informational"></a>
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

## Concurrent sessions (v0.5.24)

Multiple agent sessions can work on **different durable tasks and worktrees** in one parent workspace without sharing task, target, plan, report, or YOLO state.

```bash
heli task create work-3a --work-item 3A --repo repo-a
heli task claim work-3a --mode write
export HELI_SESSION_ID=...   # printed by claim/start

# second agent / worktree
heli task create work-3b --work-item 3B --repo repo-b
heli task claim work-3b --mode write
```

- **Task** = durable engineering work (`tasks/<id>/`)
- **Session** = ephemeral Heli attachment (`sessions/<id>.json`, optional host session metadata)
- **Lease** = single writer per task (exclusive lock directory; explicit takeover)
- **Legacy mode** remains default until you create or migrate a task

Local coordination only — not a distributed lock service, scheduler, or multi-agent runtime. See `CHANGELOG.md` and `.heli-harness/state/README.md`.

## Quickstart

From the parent folder that contains your repositories, paste this prompt into your agent:

```text
Install Heli-Harness as a parent-workspace harness here. Confirm that .heli-harness/HARNESS.md, AGENTS.md, and CLAUDE.md exist, then report the selected target repository and the checks you ran.
```

1. Install the harness in the parent workspace.
2. Select the target repository and read its profile and local instructions.
3. Record the task, make the change, run the relevant checks, and report evidence and risks.

For copy-paste commands, manual installation, updates, uninstall, and adapter setup, see [INSTALL.md](INSTALL.md).

The workflow preserves repository-local instructions and evidence boundaries; detailed adapter setup and verification limits remain in the linked documentation.

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
