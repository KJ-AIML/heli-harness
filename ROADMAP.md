# Heli-Harness Roadmap

## Current Baseline: v0.5.27

Latest stable release: `v0.5.27`

Heli-Harness is an instructions-as-code governance harness for coding agents. It gives local coding agents a shared, inspectable operating layer for workspace protocols, repo facts, policies, safety expectations, task state, adapter instructions, observable hooks, and reviewable reports.

Release history and shipped details live in the [changelog](CHANGELOG.md). Current adapter support and evidence live in the [adapter support matrix](docs/ADAPTER_SUPPORT_MATRIX.md).

## Core Thesis

Facts describe. Policies decide. Safety enforces. Reports prove.

- Facts describe: repo profiles record what exists, where it lives, and how the repo currently behaves.
- Policies decide: policy overlays state what teams require, recommend, forbid, or allow only with approval.
- Safety enforces: hooks, guards, command tiers, and approval rules block or surface risky actions where the host tool supports enforcement.
- Reports prove: run reports, validation notes, and audit artifacts show what changed, what commands ran, what risks remain, and where the agent deviated.

## Design Principles

- Keep Heli lightweight, local, markdown-first, and inspectable.
- Separate repo facts from engineering policy.
- Prefer explicit files over hidden state.
- Prefer adapter-friendly conventions over one host-specific runtime.
- Treat instruction files as context, not enforcement.
- Put enforcement into hooks, guards, approvals, and validation where available.
- Make hook behavior observable.
- Require evidence for claims of safety, validation, and completion.
- Avoid turning existing weak patterns into recommended conventions.
- Use machine-readable sidecars only where markdown cannot carry the contract safely.
- Keep release milestones version-based, not calendar-based.

## Now

- Maintain the `v0.5.27` Concurrent Session Foundation baseline and keep release claims aligned with the changelog and adapter support matrix.
- Dogfood multi-task leases, worktree bindings, and task-scoped YOLO/target isolation in real parent workspaces.
- Stabilize local governance contracts: profiles, policies, safety rules, workspace targeting, task state, and reports.
- Preserve evidence-backed adapter status; runtime enforcement is only claimed where host behavior has been tested.
- Keep `npm run check` (including `smoke-concurrency-foundation`) as the normal repository validation path.

## Next

- Close evidence gaps in existing adapters before expanding support; in particular, promote a status only with matching smoke or live verification evidence.
- Refine schemas and validation only where the markdown-first contract is insufficient.
- Use benchmark results to guide changes to governance workflows, safety behavior, and reporting.

## Not Doing

- No full agent runtime, planner, task execution engine, or multi-agent orchestrator.
- No central database, vector memory platform, hosted telemetry product, or plugin marketplace before schemas are stable.
- No replacement for linters, tests, code owners, branch protection, host-specific sandboxing, approval systems, or human review.
- No treating auto-generated descriptive profiles as authoritative policy.
- No memory source for required policy.
- No dependency unless a small local file format cannot satisfy the requirement.
