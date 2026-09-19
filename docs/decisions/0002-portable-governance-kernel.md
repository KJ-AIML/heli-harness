# ADR 0002: Portable Governance Kernel and Scoped Authority

## Status

Accepted — current architecture for `v0.10.0`

## Date

2026-09-19

## Context

The parent-workspace harness model established useful policy, safety, evidence, adapter, and coordination primitives, but it mixed project distribution, portable context, and live authority too closely. The historical v0.9 protocol work also exposed duplicated decision paths, task-scoped authority assumptions, and capability claims that could exceed proven host enforcement.

The accepted convergence architecture requires Heli to remain smaller than an agent runtime while making governance semantics portable across heterogeneous coding hosts.

## Decision

Heli is a **portable governance and coordination layer for coding agents**, implemented around a small policy/authority kernel with evidence-backed host integrations.

For `v0.10.0`:

- global Heli means shared distribution and trusted user configuration, not a global mutable active-workspace singleton;
- projects bind explicitly through `.heli/workspace.json` and `.heli/heli.lock`;
- live operational authority is execution-local or authority-domain-local and is never committed as project binding;
- authority is scoped to resources rather than task names;
- tasks remain optional durable work/evidence records and provenance;
- temporary approval uses scoped grants rather than broad bypass as the preferred path;
- human CLI, machine output, hooks, and explain share canonical evaluator/transition semantics;
- capability claims remain evidence-backed and surface-specific;
- evidence may move between machines, but grants, live sessions, leases/authority, and runtime identity do not move merely because a repository or bundle is copied;
- hosts own model loops and conversations; executors own sandbox/process durability; Heli owns governance semantics and its own receipts/trace.

## Consequences

Positive:

- installation/distribution can be global without creating unsafe global authority;
- cloning a project preserves logical identity while creating new machine/execution identity and no inherited authorization;
- concurrent writers can be reasoned about by resource rather than narrative task identity;
- project-controlled files can narrow policy without silently elevating a trusted user/built-in ceiling;
- explain and runtime decisions can converge on the same semantics;
- host support claims can distinguish wiring, observation, enforcement, and containment.

Tradeoffs:

- embedded `.heli-harness/` installs remain a compatibility/hermetic path and therefore require migration logic;
- old task/session/lease vocabulary remains visible for compatibility even though task identity is no longer the primary authority boundary;
- some shell-mediated side effects remain only partially classifiable and must be reported as partial coverage instead of falsely called enforced;
- npm/GitHub distribution and host-plugin activation remain distinct concerns.

## Supersedes / amends

This ADR supersedes ADR 0001 **only for product identity, distribution topology, and authority ownership**. ADR 0001's separation-of-concerns principles remain useful history.

Canonical architecture details live in:

- `docs/architecture/README.md`
- `docs/architecture/governance-model.md`
- `docs/superpowers/specs/2026-09-18-heli-v1-architecture-convergence.md`
