# Heli v0.9 Agent Governance Protocol Implementation Plan

**Status:** Historical implementation precursor; superseded by the accepted convergence architecture and the `v0.10.0` baseline.
**Current architecture:** [docs/architecture/README.md](../../architecture/README.md)

> Retained for provenance only. Current installation, project binding, grants, and authority semantics come from v0.10.0 documentation, not this plan.

> **For agentic workers:** implement task-by-task with isolated review gates. Do not merge phases merely because adjacent tasks touch similar files.

**Goal:** Introduce a stable machine-readable governance protocol, structured capability/decision semantics, hierarchical sessions, local explainability, and measurable workflow efficiency without turning Heli into an agent runtime.

**Architecture:** Existing Heli task/session/lease/target modules remain the state engine. A thin protocol layer projects that state into stable versioned structures. CLI and adapters consume that protocol. Hierarchical agents extend Session rather than adding another identity system.

**Tech Stack:** Node.js ESM, JSON/JSONL, existing Heli filesystem state, existing plugin hook surfaces.

**Spec:** `docs/superpowers/specs/2026-09-15-heli-agent-governance-protocol-design.md`

## Global constraints

- No new production dependency unless impossible with Node built-ins.
- Markdown remains the human authoring source.
- Machine consumers use JSON contracts.
- No agent orchestration, sandbox implementation, hosted telemetry, or automatic policy learning.
- Preserve legacy workspace compatibility.
- Preserve one-writer task/worktree invariant.
- Windows, Linux, and macOS path behavior use canonical Heli path identity.

## Milestone 0 — v0.8.4 stabilization

### Task 0.1 — Fix portable Windows path comparison

Modify `scripts/smoke-portable-targets.mjs` so expected paths are built with native `join(...)` and canonicalized afterwards. Search for the same anti-pattern. Gate on Linux/Windows Node 20/22 CI.

### Task 0.2 — Release evidence integrity

Ship the post-v0.8.3 OpenCode fixes and current support claims in a new release rather than claiming they belong to the existing tag. Update versioned release metadata only after the stabilization branch is green.

## Milestone 1 — Protocol foundation

### Task 1.1 — Protocol result envelope

Create `lib/protocol/version.mjs`, `lib/protocol/result.mjs`, and `scripts/smoke-protocol-result.mjs` with a stable Protocol v1 success/error envelope.

### Task 1.2 — Shared CLI JSON output

Create `lib/cli/output.mjs` and `scripts/smoke-cli-json.mjs`. Support only `--json` initially.

### Task 1.3 — Convert status first

Keep `status(cwd)` as the state projection and make `runStatus(args)` select human or JSON rendering. Preserve human output.

### Task 1.4 — Convert read-oriented commands

Add structured output to doctor, session/task read operations, diagnosis read/route/gate, conflicts, and target inspection.

### Task 1.5 — Convert mutations

Add structured results for task/session/diagnosis/target/yolo mutations without changing filesystem transition semantics.

## Milestone 2 — Capability model

Define a capability schema, extend adapter metadata with capability-level claims, and record only observed live host activation. Never infer activation from files on disk.

## Milestone 3 — Structured decisions

Add stable decision codes, preserve existing hook `deny`/`reason`, attach a structured `decision`, and record decision evidence in task events without rewriting historical JSONL.

## Milestone 4 — Explainability

Add deterministic `heli explain task|authority|capabilities|guard` commands based on existing state and structured decision evidence. No model call.

## Milestone 5 — S0/S1 fast paths

Add compiled workflow profiles and slim the skill bootstrap so simple tasks do not load a large skill stack. Escalate lazily on invalid premise, repeated failure, expanded impact, or higher risk.

## Milestone 6 — Hierarchical sessions

After Protocol v1 is stable, extend Session with optional `parentSessionId`, `role`, and `delegation`. Effective child authority is the intersection of task, target, parent delegation, child mode, and active lease. Preserve the one-writer invariant through explicit transfer.

## Milestone 7 — Trace and benchmark evidence

Expose the existing task event timeline locally and add a scorer that consumes externally-produced run evidence. Do not turn Heli into an agent launcher.

## Milestone 8 — ACP feasibility spike

Prototype ACP as a proxy translating lifecycle/permission events to Heli Protocol operations. Keep it outside core unless the boundary proves clean.

## Milestone 9 — Learning proposals

Deferred until repeated structured evidence exists. Any future learning command outputs reviewable candidates only and never mutates policy automatically.

## Release gates

Before stable v0.9.0: Protocol v1 frozen, JSON compatibility tests pass, capability claims validated, structured decisions pass hard guards, event v1 readers remain compatible, S1 overhead measured, one-writer invariants preserved, supported CI green, packaging/release validation green, and adapter live claims tied to exact release evidence.
