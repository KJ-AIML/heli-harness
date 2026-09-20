# Heli Architecture — Current Canonical Baseline

**Current release:** `v0.10.1`
**Architecture baseline:** portable governance kernel + project binding + execution-local/resource-scoped authority
**Canonical convergence RFC:** [Heli v1 Architecture Convergence RFC](../superpowers/specs/2026-09-18-heli-v1-architecture-convergence.md)

This page is the entry point for **current** Heli architecture. If another document conflicts with this page or the convergence RFC, the current `v0.10.1` implementation and the convergence RFC win.

## Current architecture

Heli is a **portable governance and coordination layer for coding agents**, implemented around a small policy/authority kernel with evidence-backed host integrations.

The current topology is:

```text
Host agent / IDE
      |
      v
Host adapter / hook
      |
      v
Canonical Heli evaluator + transitions
  |       |        |        |
policy  grants  authority  receipts
      |
      +--> project binding (.heli/)
      +--> trusted user/global config (~/.heli/)
      +--> execution-local operational state
```

Heli does **not** own the model loop, agent scheduler, sandbox implementation, long-running process supervisor, general memory, or conversation transcript.

## Current distribution and project binding

Normal `v0.10.1` use separates distribution from authority:

- global/shared distribution supplies the `heli` CLI and immutable package code;
- `heli setup` initializes trusted user/global state;
- `heli link` creates a small project binding under `.heli/`;
- `.heli/workspace.json` is logical project identity and resource declaration;
- `.heli/heli.lock` pins behavior-relevant runtime/protocol/schema information;
- live sessions, leases/authority, grants, capability observations, credentials, and process handles are **not project state** and must not be committed as project binding.

The global workspace registry is a locator only. It is never the authority owner.

## Current authority model

Authority is scoped to **resources**, not narrative task names.

For modeled local worktrees, Heli uses one active writer authority per conflicting resource domain. Authority transitions are conflict-checked and generation/revision tracked.

A task is an optional durable work record/provenance object. It is useful for multi-session work, handoff, investigations, S2/S3 verification, and evidence history, but ordinary reversible work does not require a named task merely to become authorized.

## Current policy and grants

A permitted action is constrained by:

```text
trusted policy ceiling
  ∩ scoped grant (when approval is required)
  ∩ current resource authority
  ∩ required enforcement/evidence coverage
```

Repository/project policy may narrow trusted policy. Project-controlled files cannot elevate the trusted user/built-in ceiling.

Temporary approvals use scoped grants bounded by action/resource/execution and optionally session/time/use count. T6 hard-deny rules remain non-grantable.

## Current decision and evidence model

Human CLI, machine JSON/API surfaces, hooks, and explain are projections of one governance model.

Decision receipts carry stable decision identity, normalized action/resources, policy provenance, applicable grants, authority generation/revision, capability evidence, reason codes, and obligations.

Capability evidence is surface-specific. Installed files or an observed callback do not automatically prove enforcement.

Evidence/work records may be portable. **Authorization never becomes portable merely because evidence or a repository is copied.**

## Current documents

These are current-facing references for `v0.10.1`:

- [Governance model](governance-model.md)
- [Adapter support matrix](../ADAPTER_SUPPORT_MATRIX.md)
- [Enforcement matrix](../ENFORCEMENT_MATRIX.md)
- [Install guide](../../INSTALL.md)
- [Roadmap](../../ROADMAP.md)
- [Cloud sync](cloud-sync.md) — current service with historical phase notes retained
- [Heli v1 Architecture Convergence RFC](../superpowers/specs/2026-09-18-heli-v1-architecture-convergence.md) — accepted architecture contract implemented through the v0.10 baseline

## Historical / non-canonical records

Older design records are kept for provenance, not as current architecture authority:

- [Evidence-Governed Autonomy](evidence-governed-autonomy.md) — historical v0.8 subsystem design; concepts carried forward where still implemented.
- [Experimental ACP Governance Proxy](acp-governance-proxy.md) — experimental integration, outside the stable kernel contract.
- [vNext Root-Cause / Evidence-Gated Autonomy design](../design/heli-vnext-root-cause-evidence-gated-autonomy.md) — historical v0.8 implementation design.
- [v0.9 Agent Governance Protocol design](../superpowers/specs/2026-09-15-heli-agent-governance-protocol-design.md) — historical precursor.
- [v0.9 implementation plan](../superpowers/plans/2026-09-15-heli-agent-governance-protocol.md) — historical precursor.
- [v0.9 convergence stabilization plan](../superpowers/plans/2026-09-18-heli-v0.9-convergence-stabilization.md) — completed precursor to v0.10.
- [ADR 0001](../decisions/0001-heli-as-governance-harness.md) — foundational historical ADR, superseded for distribution/authority topology by ADR 0002.
- [ADR 0002](../decisions/0002-portable-governance-kernel.md) — current accepted architecture decision.

Historical version references inside changelog, reports, plans, ADR history, and explicitly historical design records are intentional facts. They must not be used as current install, authority, or support guidance.

## Documentation rule

Any current-facing documentation that explains installation, authority, project layout, policy, grants, adapters, or architecture must either:

1. describe the `v0.10.1` model directly, or
2. explicitly identify itself as historical/experimental and link back to this current architecture index.

CI enforces this distinction with the documentation-currentness validation.
