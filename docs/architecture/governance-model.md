# Heli-Harness Governance Model — v0.10.0

**Status:** Current canonical governance model  
**Current release:** `v0.10.0`  
**Architecture index:** [README.md](README.md)  
**Convergence contract:** [Heli v1 Architecture Convergence RFC](../superpowers/specs/2026-09-18-heli-v1-architecture-convergence.md)

## Summary

Heli is a portable governance and coordination layer for coding agents. It owns policy resolution, normalized governance decisions, scoped approvals, modeled resource authority, capability-evidence interpretation, optional durable work/evidence records, decision receipts, and deterministic explanation of its own decisions.

Heli deliberately does not own the host's model loop, conversation transcript, task scheduler, sandbox implementation, long-running process supervisor, or general memory.

## Core rule

> Facts describe. Trusted policy constrains. Resource authority scopes. Grants approve. Evidence explains. Adapters translate.

A permitted action is bounded by:

```text
trusted policy ceiling
  ∩ applicable scoped grant
  ∩ current resource authority
  ∩ required enforcement/evidence coverage
```

Project-controlled files may narrow the trusted ceiling. They cannot elevate it.

## Topology

```text
Host agent / IDE
      |
      v
Host adapter / hook
      |
      v
Canonical evaluator + transition layer
  |        |         |         |
policy   grants   authority  receipts
      |
      +--> project binding (.heli/)
      +--> trusted user/global config (~/.heli/)
      +--> execution-local operational state
```

### Shared/global distribution

Global Heli means distribution and trusted user configuration.

It may contain:

- installed package/runtime;
- user policy/preferences;
- machine identity;
- trusted grant store;
- rebuildable workspace locator;
- execution-local data roots.

It must not become one global mutable active-project/task/lease singleton.

### Project binding

A linked project contains a small committed `.heli/` surface:

- `workspace.json` — logical project/workspace identity and resource declarations;
- `heli.lock` — behavior-relevant runtime/protocol/schema pins;
- optional project `profiles/`, `policies/`, `safety/`, and `skills/`.

Committed project binding must not contain live grants, sessions, authority leases, capability observations, credentials, process handles, or other machine-local authorization.

Paths identify resources; they are not trust anchors.

### Execution-local operational state

Live coordination is bound to the machine/execution namespace.

Cloning or moving a repository does not copy authorization. A clone may preserve logical workspace identity while receiving a fresh machine/execution identity.

## Resource-scoped authority

The v0.10 authority boundary is the modeled **resource**, not a task name.

For a conflicting local worktree resource, Heli conservatively models one active writer authority unless an executor provides stronger isolation/fencing semantics.

Authority transitions include conflict-checked acquire/reacquire, renew, transfer, revoke, release, and inspect behavior with generation/revision tracking.

A stale owner cannot regain authority merely by renewing an expired record after another actor acquired the resource.

A cooperative Heli lease is not a claim that arbitrary already-running processes are physically fenced. Stronger containment must come from the executor/host and be reported as such.

## Work records

A task is an optional durable work record/provenance object.

Use one when:

- work spans sessions;
- handoff matters;
- multiple actors coordinate;
- verification obligations are significant;
- investigation/diagnosis must persist;
- evidence/reporting is required.

Ordinary reversible work does not need a named task merely to be authorized.

The CLI may retain task vocabulary for compatibility, but task identity is not the root authority boundary.

## Policy composition

Policy sources have different trust roles:

- built-in Heli safety ceiling;
- trusted user/global policy;
- project policy;
- explicit bounded grants.

Project policy may narrow the trusted ceiling. A repository cannot grant itself more power by editing its own policy or manifest.

Hard-deny classes remain hard denies unless an explicitly different trusted policy contract says otherwise. Normal temporary grants do not bypass T6 hard-deny rules.

## Scoped grants

A grant carries governance-relevant scope such as:

- grant ID;
- issuer/approval provenance;
- actor/subject;
- action selector;
- resource selector;
- execution scope;
- optional host-session binding;
- created/expiry time;
- use count/end condition;
- revocation state;
- delegation ceiling where applicable.

Typical UX:

- allow once;
- allow for this host session;
- allow this workspace/resource;
- allow for N minutes.

Time by itself is not sufficient scope.

## Canonical evaluator and transitions

Human CLI, machine-readable surfaces, hooks, and explain must not invent separate authority semantics.

Conceptually they share:

1. context resolution;
2. policy resolution;
3. evaluation;
4. authority transition;
5. decision/evidence recording;
6. current explanation;
7. historical-decision explanation.

Machine protocol is a transport over those semantics, not a second governance engine.

## Decision receipts and explain

A governance receipt records or references:

- decision ID;
- evaluator/protocol/schema identity;
- normalized action/resources;
- execution/host identity;
- policy/profile provenance;
- matched/rejected rules;
- grant IDs;
- authority resource/generation/revision;
- relevant capability evidence;
- evaluation time;
- decision/reason codes/obligations;
- approval/execution/verifier correlations.

Historical explanation is fixed to historical inputs. Later policy changes do not rewrite why an older decision occurred.

## Capability evidence

Capability evidence is surface-specific. Distinguish at least:

1. declared;
2. loaded;
3. observed;
4. tested enforcement;
5. execution containment.

An installed plugin file does not prove that the host loaded it. An observed callback does not prove every equivalent write/effect surface is enforced.

Evidence should bind to host/version, adapter/runtime identity, host session/execution namespace, configuration hash, observation time, and invalidation/freshness information where relevant.

## S0–S3

S0–S3 are workflow/risk summaries, not authorization levels.

- **S0** — read/query.
- **S1** — ordinary reversible local change.
- **S2** — additional evidence/coordination.
- **S3** — high-impact/sensitive action.

Authorization still derives from concrete action/resource/policy/grant/coverage facts.

## Evidence and trace

Heli keeps a governance trace, not a universal event-sourced copy of the agent runtime.

High-value records include:

- authority transitions;
- grant issuance/revocation/consumption;
- governance decisions;
- capability observations;
- required verifier results;
- work-record transitions.

Host transcripts and executor logs remain owned by those systems and may be correlated by ID.

Portable evidence may move. **Authorization does not move with evidence.**

## Adapters

Adapters translate actual host semantics.

An adapter should truthfully declare/test the surfaces it can observe or enforce, such as:

- session start;
- pre-tool interception;
- post-tool/result visibility;
- approval request integration;
- subagent lifecycle identity;
- structured tool input;
- sandbox/executor evidence;
- worktree isolation;
- completion/stop lifecycle.

Unknown or unsupported surfaces stay unknown/unsupported.

Current host claims live in the [Adapter Support Matrix](../ADAPTER_SUPPORT_MATRIX.md).

## Embedded compatibility

The historical `.heli-harness/` workspace layout remains supported for compatibility and hermetic/offline use.

It includes embedded task/session/lease/index/target concepts from earlier releases. Those compatibility records must not override the current linked v0.10 rules when a project has `.heli/workspace.json`.

First linked cutover fails closed while active embedded writer authority exists.

## Historical documents

Older v0.5–v0.9 architecture/design records are preserved for provenance. They are not current authority.

Use the [architecture index](README.md) to distinguish current from historical/experimental documents.
