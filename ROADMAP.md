# Heli-Harness Roadmap

## Current Baseline: v0.10.0

Latest stable release: `v0.10.0`

Heli is a **portable governance and coordination layer for coding agents**, implemented around a small policy/authority kernel with evidence-backed host integrations.

Canonical current architecture: [docs/architecture/README.md](docs/architecture/README.md).  
Release history: [CHANGELOG.md](CHANGELOG.md).  
Current adapter evidence: [docs/ADAPTER_SUPPORT_MATRIX.md](docs/ADAPTER_SUPPORT_MATRIX.md).

## Core thesis

- Facts describe.
- Trusted policy constrains.
- Resource authority scopes conflicting mutation.
- Scoped grants approve bounded exceptions.
- Evidence and receipts explain what happened.
- Adapters translate host semantics without pretending every host has identical enforcement.

Heli does not become an agent runtime, planner, scheduler, sandbox implementation, process supervisor, model router, general memory platform, or transcript store.

## Shipped in v0.10.0

- Global/shared distribution with `heli setup`.
- Explicit project binding with `heli link`.
- `.heli/workspace.json` + `.heli/heli.lock` as committed identity/reproducibility state.
- Execution-local machine/runtime authority state.
- Clone-safe machine/execution identity.
- Resource-scoped cooperative write authority.
- Scoped grants with action/resource/execution/time/use boundaries.
- Trusted built-in/user/project policy composition.
- Canonical human/machine transition semantics.
- Structured governance decisions and historical explanation.
- Runtime capability freshness/identity.
- Linked portability that carries evidence/work records without carrying live authorization.
- Fail-closed migration from embedded v0.8.x-compatible workspaces (historical).
- Cross-platform CI on Ubuntu/Windows with Node 20/22.

## Now

- Keep `v0.10.0` documentation, package metadata, adapter claims, and architecture references synchronized.
- Dogfood linked projects across supported hosts.
- Measure friction and correctness of automatic binding/resource-authority behavior before widening defaults.
- Keep support claims tied to reproducible smoke/live evidence.
- Preserve embedded `.heli-harness/` only as a compatibility/hermetic path, not as the primary topology.

## Next — v0.11 only when evidence warrants it

- Measured auto-binding for ordinary sessions.
- Measured automatic resource-authority acquisition where conflict semantics are reliable.
- Broader adapter coverage only with equivalent evidence.
- Better host-native approval/grant receipt integration.
- Stronger executor fencing where the executor can actually enforce loss of authority.
- Reduce compatibility artifacts only after linked installs no longer depend on them.

## Path to v1.0

v1.0 is a compatibility and truthfulness gate, not a feature-count milestone.

Required properties include:

- authority correctness and recovery;
- deterministic policy/grant/resource semantics;
- current/historical explanation parity;
- declared enforcement coverage that matches tested host behavior;
- safe clone/move/upgrade behavior;
- explicit remote authority ownership;
- usable linked defaults without reintroducing hidden global mutable authority.

See the accepted [Heli v1 Architecture Convergence RFC](docs/superpowers/specs/2026-09-18-heli-v1-architecture-convergence.md).

## Historical shipped milestone — Cloud Sync

Cloud Sync Phases 0–2 shipped in the v0.7.x line. Those version references are historical release facts, not the current architecture baseline.

Current v0.10 rule: portable evidence/context may move; authorization does not.

Design and current amendment: [docs/architecture/cloud-sync.md](docs/architecture/cloud-sync.md).

Phase 3 team/live cross-device authority remains unscheduled and would require its own authority-domain design.

## Not doing

- No full agent runtime or multi-agent scheduler.
- No general-purpose process execution/recovery plane.
- No hidden central authority database for local projects.
- No vector/general-memory platform as part of the governance kernel.
- No claim that Markdown/pointer files equal enforcement.
- No claim that callback observation equals containment.
- No broad temporary bypass as the preferred permission model.
- No portability of credentials, live grants, live writer authority, or host-session authority.
