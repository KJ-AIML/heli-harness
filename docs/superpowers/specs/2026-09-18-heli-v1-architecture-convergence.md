# Heli v1 Architecture Convergence RFC

**Status:** Proposed convergence contract  
**Date:** 2026-09-18  
**Scope:** Architecture only; no implementation plan in this document  
**Applies to:** Heli v0.9 stabilization and the path to v1.0

## 1. Decision summary

Heli will evolve into a **portable governance kernel for heterogeneous coding agents**.

Heli resolves resource scope, policy, authority, grants, and evidence-backed decisions across host agents without owning the agent loop or execution plane.

The convergence architecture makes the following decisions:

1. **Global Heli means global distribution and user configuration, not a global mutable authority singleton.**
2. **Authority is scoped to resources, not narrative tasks.**
3. **Human CLI, machine API, hooks, and explain use one canonical evaluator and one canonical transition layer.**
4. **Project binding is explicit and reproducible through a small workspace manifest plus a runtime/policy lock.**
5. **Operational authority state is execution-local or authority-domain-local; it is never portable project state.**
6. **Scoped grants replace broad bypass semantics for normal use.**
7. **Durable task/work records are optional governance records, not prerequisites for ordinary reversible coding.**
8. **S0-S3 remain useful UX summaries, but are not an authorization lattice.**
9. **Capability claims are evidence-backed and surface-specific; observed callback activity is not equivalent to enforcement.**
10. **Explain is a projection of canonical evaluation and historical decision receipts, never a separate policy engine.**

This RFC intentionally does not define an implementation backlog. The next implementation plan must derive from this contract after its conformance scenarios are accepted.

---

## 2. Why this RFC exists

Heli v0.8.x established useful governance primitives:

- explicit target and worktree identity,
- task/session coordination,
- writer leases,
- diagnosis and evidence,
- host adapters and hooks,
- portable workspace state,
- local-first recovery and handoff.

The v0.9 branch adds a machine-readable protocol, structured decisions, capability observations, explainability, workflow profiles, hierarchical sessions, trace/scoring support, ACP experiments, and learning suggestions.

That work contains important foundations, but it also exposes architectural ambiguity:

- lifecycle semantics differ between human and machine surfaces,
- enforcement coverage differs across equivalent tool surfaces,
- task identity is overloaded as an authority boundary,
- explain can disagree with actual guard behavior,
- capability observations do not yet establish enforcement coverage,
- global installation and workspace-local runtime concerns are mixed,
- hierarchy and fast-path behavior are not mature enough to freeze as stable authority contracts.

The purpose of this RFC is to preserve the strongest v0.9 work while correcting the underlying ownership model before Heli expands further.

---

## 3. Product identity

### 3.1 Canonical identity

> **Heli is a portable governance and coordination layer for coding agents, implemented around a small policy/authority kernel with evidence-backed host integrations.**

A shorter product phrase may use **agent governance control plane**, but the implementation boundary is deliberately narrower than a general control plane platform.

### 3.2 Heli owns

Heli owns:

- policy resolution,
- normalized governance decisions,
- trusted authority composition,
- scoped grants,
- resource-scoped coordination authority where Heli is designated as owner,
- project/workspace binding resolution,
- capability-evidence interpretation,
- optional durable work/evidence records,
- decision receipts,
- governance trace,
- deterministic explanation of its own decisions.

### 3.3 Heli explicitly does not own

Heli does not own:

- agent loops,
- model calls or model routing,
- conversation transcripts,
- host compaction,
- general prompt assembly,
- general skill loading,
- sandbox implementation,
- filesystem or shell tool implementation,
- durable process execution or recovery,
- general memory,
- autonomous policy learning,
- subagent creation or scheduling,
- remote workflow orchestration.

Heli may reference these systems and consume their evidence, but it does not duplicate their state machines.

---

## 4. Ownership model

| Concern | Primary owner | Heli boundary |
| --- | --- | --- |
| Agent loop | Host agent | Receives governance decisions through an adapter |
| Model call / routing | Host/provider | Heli does not call or select models |
| Prompt/context assembly | Host agent | Heli supplies a compact governance projection |
| Skill loading | Host agent | Heli exposes relevant governance skill metadata |
| Policy composition | Heli kernel | Resolves trusted ceilings, restrictions, grants, preferences |
| Decision evaluation | Heli kernel | One evaluator for hooks, CLI/API, and explain |
| User approval UI | Host UI or trusted user surface | Heli defines required scope and validates returned grant |
| Sandbox | Host/execution plane | Heli records required/observed coverage |
| Filesystem/shell execution | Execution plane | Heli evaluates normalized affected resources |
| Long-running operation | Execution plane | Heli stores references and obligations only |
| Durable operation recovery | Durable executor/workflow system | Heli reevaluates authority on continuation |
| Work record/task | Heli when needed | Cross-session scope/evidence/status only |
| Conversation session | Host | Heli stores actor binding, not transcript |
| Workspace identity | Project binding + resolver | Heli validates logical-to-execution mapping |
| Resource authority | Heli or designated authority service | Exactly one authority owner per resource domain |
| Evidence index | Heli | Producers own artifacts; Heli records provenance/digest |
| Verification | Independent verifier/host tools | Heli evaluates whether required evidence is satisfied |
| Governance trace | Heli | Host/executor traces remain separate but correlated |
| Memory | Host/external memory system | Heli is not a general memory store |
| Learning | External analyzer + human review | No self-modifying kernel policy |
| Subagent creation | Host/orchestrator | Heli receives identity/delegation requests |
| Subagent authority | Heli kernel | Narrowing, expiry, revocation, scope |
| Tool interception | Host | Adapter translates real lifecycle callbacks |
| Capability discovery | Adapter + evidence | Kernel determines whether evidence meets a policy requirement |
| Global config | Trusted user/admin source | Kernel resolves provenance |
| Workspace config | Project source | May narrow authority; cannot silently elevate trusted ceilings |

Shared ownership of one state machine is considered a design smell. When Heli is not the authority owner, it consumes the designated authority service result instead of keeping a competing local lease.

---

## 5. Canonical logical architecture

```text
                    Host Agent
                        |
                 Host Adapter
                        |
              normalized action
                        |
                        v
            +-------------------------+
            | Heli Governance Kernel  |
            |                         |
            | Context Resolver        |
            | Policy Resolver         |
            | Authority Engine        |
            | Decision Evaluator      |
            | Grant Engine            |
            | Receipt / Evidence      |
            +-----------+-------------+
                        |
            +-----------+-------------+
            |                         |
            v                         v
      Project Binding          Operational State
      workspace manifest       actor bindings
      runtime/policy lock      resource authority
      project policy           scoped grants
      typed profiles           capability evidence
      project skills           decision receipts
            |                         |
            +-----------+-------------+
                        |
                        v
              ALLOW / ASK / DENY
                  + obligations
                  + coverage
                  + provenance
```

The host keeps its native route to execution. An adapter may intercept that route only where the host provides a real lifecycle/enforcement surface.

In instruction-only integrations, Heli is advisory and must report that reduced coverage.

No mandatory daemon or network service is required by this architecture.

---

## 6. Global distribution is not global authority

### 6.1 Intended global UX

The normal developer UX may be:

```bash
npm install -g heli-harness
heli setup
```

Then, per project:

```bash
cd project
heli link
```

Host integrations should not require copying the full engine into every workspace under normal conditions.

### 6.2 Global layer responsibilities

The global/user layer may contain:

- immutable versioned Heli distributions,
- package cache,
- host adapter packages,
- user preferences,
- trusted user policy defaults,
- user-installed skills,
- credentials in an appropriate secret store,
- a rebuildable workspace locator/index,
- compatibility metadata.

A platform-native config/data/cache layout is preferred. `~/.heli` is an acceptable UX convention/fallback, not a requirement that every Heli byte live in one directory.

### 6.3 The global layer must not own

The global layer must not contain one mutable universal:

- active workspace,
- active target,
- active task,
- live lease namespace for unrelated execution domains,
- shared mutable conversation session,
- grant that becomes valid merely because a repository copied a workspace ID.

The workspace index is a convenience locator only. Deleting and rebuilding it must not change authority.

### 6.4 Immutable runtime selection

Active sessions resolve a coherent immutable runtime set. Runtime, protocol, schema, adapter, and policy identities are recorded independently.

An active session must not silently change behavior because a global package was upgraded.

A project can optionally use a self-contained pinned bundle for CI, air-gapped, regulated, or offline environments while preserving the same governance semantics.

---

## 7. Project binding and reproducibility

A linked project has a small committed binding surface.

Illustrative layout:

```text
project/
  .heli/
    workspace.json
    heli.lock
    policies/
    profiles/
    skills/
```

Exact filenames remain subject to schema design, but their responsibilities are normative.

### 7.1 `workspace.json`

The manifest describes logical project identity and relative resources.

Illustrative, not final schema:

```json
{
  "schemaVersion": 1,
  "workspaceId": "axtra-intellion",
  "resources": {
    "api": "./apps/api",
    "web": "./apps/web"
  },
  "policyProfile": "default"
}
```

It must not contain live authority.

Do not commit:

- absolute machine paths,
- active sessions,
- leases,
- temporary grants,
- runtime capability observations,
- credentials,
- process handles.

A committed workspace identifier is identity/provenance, not automatic trust.

### 7.2 `heli.lock`

The lock records the reproducibility inputs necessary to resolve compatible runtime semantics.

It may pin:

- runtime/package version or digest,
- protocol compatibility,
- state schema compatibility,
- adapter versions/digests,
- policy schema/version,
- selected package/skill digests where behavior depends on them.

The lock must not contain secrets.

### 7.3 Identity semantics

- Moving a directory preserves logical identity but revalidates local execution mapping.
- Cloning onto another machine preserves project policy identity but creates a new checkout/execution identity.
- Copying/forking a repository must not copy grants or trusted execution authority.
- Separate worktrees have separate mutable working-tree resources.
- Shared Git metadata is a separate resource class when operations can conflict through it.
- Remote execution uses authority colocated with, or explicitly designated for, that remote resource domain.

Paths are locators, not trust anchors.

---

## 8. Resource model

Authority is evaluated against **resources that can actually conflict or produce side effects**.

Initial resource classes should remain conservative and understandable:

- working tree,
- repository shared Git state,
- filesystem path set where reliably known,
- environment/configuration target,
- remote repository/ref mutation,
- deployment target,
- external account/service,
- credential/secret resource,
- other explicitly modeled external side effects.

### 8.1 Resource identity rule

A narrative task name is never sufficient to define authority.

Two tasks operating on one worktree share an authority domain even if their names differ.

Two agents operating in isolated worktrees may proceed independently unless they touch a shared mutable resource.

### 8.2 Shell limitation

Arbitrary shell commands can affect resources that static text classification cannot reliably discover.

Heli must not claim OS-level containment from command parsing.

Where exact resource impact is unknown, policy may:

- require a stronger host/executor sandbox,
- narrow allowed commands,
- request user approval,
- mark enforcement coverage as partial/advisory.

---

## 9. Actor and execution identity

A governance decision must resolve at least:

- logical workspace/project,
- checkout/worktree resource,
- execution namespace/instance,
- host name and version where known,
- adapter identity/digest,
- host session identity where available,
- Heli actor binding,
- optional durable work record.

External host session IDs must be namespaced by host/runtime identity.

A host restart, adapter upgrade, incompatible resume, or execution-instance replacement may invalidate capability observations and grants according to their scope.

Identity fallback must never silently increase authority.

---

## 10. Authority model

### 10.1 Resource-scoped authority

Heli transitions from **task-scoped one-writer** to **resource-scoped authority**.

For a local mutable worktree, one active writer is a reasonable conservative default when concurrent conflicting writers are possible.

Authority rules must not unnecessarily serialize independent worktrees.

### 10.2 Atomic transitions

Where Heli is the authority owner, it provides canonical transitions:

- acquire,
- renew,
- transfer,
- revoke/release,
- inspect.

Renewing expired authority is a new conflict check, not an unconditional refresh.

Transfer is atomic at the authority level.

### 10.3 Fencing truthfulness

A JSON lease cannot stop an already-running arbitrary process.

Heli may claim:

- cooperative conflict detection, or
- enforced fencing only when the execution layer validates lease generations/tokens.

The enforcement class must be explicit.

### 10.4 Remote authority

A laptop-local authority store must not pretend to govern remote execution that can mutate independently.

For remote resources, exactly one designated authority domain is authoritative.

---

## 11. Delegation and hierarchy

Heli does not become an agent hierarchy/orchestration manager.

Hierarchy is retained only as **authority provenance**.

Delegation is modeled as a restricted grant relationship:

- child scope cannot exceed the delegable ceiling,
- expiry/revocation semantics are explicit,
- ancestor revocation propagates unless authority was deliberately reissued by an independent trusted principal,
- holding the current writer lease is separate from the permission ceiling to receive or delegate authority.

Do not infer authority from parent/child labels alone.

Hierarchical session APIs remain provisional until these semantics pass conformance tests.

---

## 12. Policy composition and scoped grants

Preferences and authority use different merge semantics.

### 12.1 Preferences

Preferences may use ordinary nearest/explicit override semantics.

Examples:

- report style,
- default verbosity,
- preferred profile,
- presentation preferences.

### 12.2 Authority

Authority uses constrained composition:

> **Permitted action = trusted ceiling ∩ applicable grant/scope ∩ current resource authority ∩ required enforcement/evidence**

Rules:

1. Hard denies/ceilings cannot be bypassed by a normal temporary grant.
2. Repository/project policy may narrow trusted authority.
3. Untrusted repository content cannot promote itself above user/admin ceilings.
4. A user/admin change to a ceiling is a policy change, not an `allow once` grant.
5. Missing enforcement capability is a coverage condition or blocker, not an implicit allow.

### 12.3 Decision vocabulary

The user-facing decision vocabulary remains small:

- `ALLOW`
- `ASK`
- `DENY`

Obligations are represented separately.

Examples of obligations:

- acquire resource authority,
- verify target identity,
- obtain a bounded grant,
- run a required verifier,
- use a supported enforcement path,
- provide required evidence.

### 12.4 Grant contract

A grant includes:

- grant ID,
- issuer,
- subject/actor,
- action selector,
- resource selector,
- execution scope,
- creation time,
- expiry/end condition,
- revocation state,
- delegation ceiling if applicable,
- approval interaction/receipt provenance.

Agent-editable project files are not proof of human approval.

Supported UX concepts may include:

- allow once,
- allow this work record,
- allow this host session,
- allow this workspace/resource,
- allow for N minutes.

Each remains bounded by action and resource scope.

A time limit alone is never sufficient scope.

---

## 13. Canonical evaluator and transition layer

This is a hard architectural requirement.

```text
                    Canonical Heli Core
                   /        |        \
                  /         |         \
             Human CLI   Machine API   Hooks
                              |
                           Explain
```

There must not be independent authority semantics in:

- human CLI,
- machine API,
- host adapter,
- explain command.

### 13.1 Kernel functions

The kernel exposes conceptual operations equivalent to:

1. **resolveContext**
2. **resolvePolicy**
3. **evaluate**
4. **transitionAuthority**
5. **recordDecision/evidence**
6. **explainCurrent**
7. **explainDecision**

These do not require a long-running application server. They may be library functions, one-shot commands, or another transport.

### 13.2 Machine protocol

Protocol v1 remains valuable, but it is a transport/contract over canonical semantics.

A machine command must not invent a second task/lease lifecycle.

Human and machine mutation surfaces must produce equivalent state transitions for equivalent inputs.

---

## 14. Decision receipts and explain

`explain` is first-class, but it never owns a policy evaluator.

Two modes are required:

### 14.1 Evaluate now

Examples:

```bash
heli explain git.push
heli explain write path/to/file
heli explain authority
heli explain capabilities
heli explain config
```

This evaluates current state without mutating session/lease state.

### 14.2 Explain historical decision

Illustrative:

```bash
heli explain decision dec_123
```

This explains why that recorded decision occurred under its historical inputs.

A later policy change must not rewrite the historical explanation.

### 14.3 Decision receipt minimum contract

A receipt records or content-addresses:

- decision ID,
- evaluator version,
- protocol/schema versions,
- normalized action,
- affected resources,
- cwd/execution namespace,
- safe input digest,
- actor/host/execution identity,
- policy/profile snapshot hashes,
- rule provenance,
- matched/rejected rules,
- applicable grant IDs,
- authority resource/generation/state revision,
- relevant capability evidence/coverage,
- evaluation time as explicit input,
- decision,
- reason codes,
- obligations,
- approval/execution/verifier correlation IDs where available.

Secrets are not copied merely to improve replay.

If redaction prevents exact replay, Heli reports the replay limitation instead of inventing missing inputs.

---

## 15. Capability evidence

Capability evidence is surface-specific.

Do not reduce all host capability into one monotonic score.

Distinguish at minimum:

1. **declared** — adapter contract says support exists,
2. **loaded** — integration is registered/loaded,
3. **observed** — callback/lifecycle event was seen,
4. **tested enforcement** — a denial was shown to stop execution for a defined surface,
5. **execution containment** — sandbox/executor protects a defined resource class.

A host can have `pre_tool` observed while shell-mediated writes remain uncovered.

Capability evidence should bind to relevant identity such as:

- host name/version,
- adapter version/digest,
- runtime instance,
- host session identity,
- execution namespace,
- relevant configuration hash,
- observation time,
- expiry/invalidation rule,
- observed outcome.

Use the term **runtime observation** unless there is a stronger authenticated attestation mechanism.

---

## 16. Work records replace mandatory task workflow

Heli keeps durable work identity, but stops requiring a named task for every ordinary action.

### 16.1 Ordinary work

A local read requires no task directory or writer lease.

A normal coding session needs:

- project/resource resolution,
- actor/execution binding,
- policy evaluation,
- resource authority only where concurrent conflict requires it.

It does not inherently require:

- `plan.md`,
- `decisions.md`,
- diagnosis,
- a manually named task,
- a second workflow language.

### 16.2 Durable work record

A work record becomes useful when:

- work spans sessions,
- handoff matters,
- multiple actors coordinate,
- verification obligations are significant,
- investigation/diagnosis must persist,
- evidence/reporting is required.

A work record stores governance-relevant facts:

- objective,
- resource scope,
- actor/authority references,
- required evidence,
- state,
- provenance,
- decision/evidence references.

Host plans remain host plans.

The external CLI may continue using the word `task` for compatibility, but its semantics become an optional durable work record rather than the root of all write authority.

---

## 17. Adaptive governance

S0-S3 remain a useful UX vocabulary:

- **S0** — low-impact query/read,
- **S1** — ordinary reversible local change,
- **S2** — work requiring additional evidence/coordination,
- **S3** — high-impact or sensitive action.

They are not privilege levels.

Hard authorization derives from action/resource facts.

The evaluator considers independent dimensions:

- side effect,
- resource sensitivity,
- scope,
- reversibility,
- evidence/uncertainty,
- actor authority,
- enforcement coverage.

A one-line authentication change may be higher risk than a large read-only investigation.

### 17.1 Escalation

Escalation occurs for explicit reasons such as:

- new resource,
- expanded side effects,
- sensitive target,
- missing required enforcement,
- changed user intent,
- repeated failure relevant to the attempted action,
- stale authority/capability evidence.

### 17.2 De-escalation

De-escalation means obligations were discharged or scope narrowed.

It never:

- clears an unresolved deny,
- widens a grant,
- converts uncertainty into privilege.

Model-estimated uncertainty may request more evidence. It must not grant more authority.

---

## 18. Evidence and trace

Heli preserves a governance trace, not a universal event-sourced copy of the whole agent runtime.

The trace must be explicit about completeness.

High-value durable records include:

- authority transitions,
- grant issuance/revocation/consumption,
- governance decisions,
- capability observations,
- required verifier results,
- work-record lifecycle transitions.

Host transcripts and execution logs remain owned by their systems and are correlated through IDs/references.

Recorded claims and independent verifier evidence must remain distinguishable.

Portable evidence may move between machines.

**Authorization does not move with evidence.**

Leases, session authority, and remembered grants are never transferred merely because a bundle or repository is copied.

---

## 19. Host adapter contract

An adapter is responsible for translating actual host semantics, not making Heli look uniformly capable.

For each supported host/release, the adapter declares and tests:

- session-start identity support,
- pre-tool interception,
- post-tool/result visibility,
- approval/permission request integration,
- subagent lifecycle identity,
- structured tool input,
- sandbox/execution evidence,
- worktree isolation evidence,
- stop/completion lifecycle,
- known uncovered write/effect surfaces.

An adapter must report unknown/unsupported rather than infer enforcement from installed files.

Where a host-native permission or sandbox semantic is reliable, Heli should consume it rather than emulate a weaker duplicate.

---

## 20. Disposition of v0.9 work

PR #17 remains valuable, but not every implemented feature becomes stable Protocol v1.

### 20.1 Preserve and consolidate

Preserve:

- protocol result envelope,
- JSON/machine-readable transport,
- structured decision vocabulary,
- capability schema/observations,
- explain interface,
- trace reader,
- lazy skill direction,
- workflow profile vocabulary,
- benchmark evidence collection infrastructure.

Consolidate all of these around the canonical evaluator and transition layer.

### 20.2 Fix before stable contract

Before v0.9 stable, resolve the following classes of defect:

1. stale authority renewal creating conflicting active writers,
2. equivalent write surfaces receiving inconsistent ownership enforcement,
3. hierarchy/delegation not propagating closure/revocation semantics correctly,
4. explain disagreeing with runtime guard behavior,
5. human and machine lifecycle transitions diverging,
6. capability declarations/observations not composing into a truthful current view,
7. split decision representations,
8. fast-path/package claims exceeding deployed integration,
9. trace completeness claims exceeding recorded decisions,
10. host session identity ambiguity.

### 20.3 Keep provisional

Do not freeze these as stable authority contracts until conformance proves them:

- hierarchical write delegation,
- adaptive workflow selection,
- effective capability enforcement claims.

### 20.4 Keep experimental/outside kernel

Keep outside stable kernel readiness:

- ACP proxy,
- learning candidates,
- autonomous learning,
- process lifecycle ownership,
- general memory.

ACP and analysis tooling may evolve independently.

### 20.5 Generated workspace copies

Generated workspace/plugin copies remain valid transitional or hermetic packaging artifacts.

They must derive from one canonical implementation and never become independently edited behavior.

Long term, the normal installation path uses immutable shared distribution plus project binding; an explicit self-contained bundle remains supported where valuable.

---

## 21. Migration path

Migration is incremental.

### Phase A — truthful current semantics

On the existing topology:

- fix reproduced authority/explain defects,
- narrow enforcement claims to tested surfaces,
- ensure current supported adapters report actual coverage.

### Phase B — canonical semantics

Unify:

- human CLI,
- machine API,
- hooks,
- explain,
- decision recording.

All use one evaluator and one transition layer.

### Phase C — distribution normalization

Make one implementation package canonical.

Continue generating existing embedded/offline artifacts as compatibility outputs.

Validate clean installed entrypoints, not only source-tree imports.

### Phase D — project binding contract

Introduce:

- logical project/resource binding,
- execution/check-out identity,
- runtime/policy lock,
- legacy workspace discovery migration.

No global authority migration yet.

### Phase E — global distribution and scoped authority

Add:

- immutable global runtime resolution,
- global host integration,
- trusted user config,
- rebuildable workspace index,
- scoped grants,
- resource authority state with explicit authority-domain ownership.

Existing embedded workspaces remain pinned until explicitly migrated.

### Phase F — exclusive authority cutover

When moving an existing workspace:

- quiesce writers,
- snapshot/validate state,
- migrate resource mappings,
- select exactly one active authority store,
- invalidate observations/grants that cannot safely preserve identity,
- never run old and new lease owners concurrently.

### Phase G — measured low-friction defaults

Only after semantics are coherent:

- auto-bind ordinary sessions,
- auto-acquire required local resource authority,
- make durable work records optional,
- lazy-load governance instructions,
- compare against v0.8/v0.9 baselines.

### Phase H — retire redundant artifacts

Remove workspace-local runtime copies only when the linked project no longer depends on them.

Keep a documented hermetic bundle mode.

---

## 22. Proposed release sequence

Version numbers are guidance; gates matter more than labels.

### v0.8.4 — Stabilization

Scope:

- current integration/portability fixes,
- reproduced authority fixes,
- truthful enforcement claims.

Gate:

- no new topology,
- current invariants are correct on supported surfaces.

### v0.9 alpha/beta — Canonical governance semantics

Scope:

- one evaluator,
- one transition layer,
- protocol envelope,
- decision receipts,
- capability evidence,
- explain parity,
- trace semantics,
- low-friction foundation.

Gate:

- human/machine/hook/explain conformance,
- clean-install entrypoint verification.

### v0.9 stable — Governance kernel foundation

Scope:

- only contracts demonstrated by deterministic conformance and supported-host tests.

Gate:

- hierarchy/adaptive/effective-capability claims remain provisional unless proven,
- baseline friction measured.

### v0.10 — Global distribution, project binding, and scoped authority

Scope:

- immutable shared distribution,
- project binding,
- runtime/policy lock,
- execution identity,
- resource-scoped authority,
- scoped grants,
- trusted config composition,
- migration.

Gate:

- no global active-project singleton,
- reproducible resolution,
- safe exclusive authority cutover.

### v0.11 — Adaptive defaults, only if evidence warrants

Scope:

- measured auto-binding,
- measured automatic resource authority,
- broader adapter coverage,
- evidence-driven friction reduction.

Do not schedule a generic “runtime intelligence” milestone without a demonstrated need.

### v1.0 — Portable governance contract

Gate:

- compatibility,
- recovery,
- authority correctness,
- enforcement truthfulness,
- usability,
- declared host support demonstrated across a defined support set.

---

## 23. Normative conformance scenarios

These scenarios must be executable before the corresponding contracts are declared stable.

### C1 — stale renewal cannot create two active writers

Given:

- actor A previously held worktree resource W,
- A expires,
- B acquires W,

When A attempts renewal,

Then:

- renewal is a fresh conflict-checked acquisition,
- A does not become active while B owns W.

### C2 — equivalent write surfaces do not silently bypass authority

Given an observe-only actor,

Equivalent source mutations through supported intercepted surfaces must produce equivalent governance outcomes.

If shell effects cannot be determined/enforced, coverage is explicitly partial rather than falsely reported as enforced.

### C3 — delegation/revocation is transitive by contract

Closing/revoking an ancestor or grant changes descendants according to explicit delegation semantics.

Writer lease possession and delegable permission ceiling remain separate.

### C4 — explain parity

For a fixed state snapshot and normalized action:

`evaluate(action).decision == explainCurrent(action).decision`

Explain performs no lease/session mutation.

### C5 — machine/human lifecycle parity

Equivalent mutation requests through human CLI and machine API invoke the same canonical transition and produce equivalent authoritative state.

### C6 — truthful capability view

`explain capabilities` combines declared contract plus current valid runtime evidence.

Expired or identity-mismatched observations do not count as current enforcement.

### C7 — one decision model

Runtime decisions and protocol decisions are one canonical receipt shape or lossless projections of it.

### C8 — packaging truth

A capability/workflow advertised as installed must be reachable through the real packaged entrypoint used by that host.

Tests importing an unused source file are insufficient.

### C9 — trace completeness is declared

The trace exposes its completeness class.

If allows/denials or unbound-task decisions are omitted, it must not claim canonical audit replay.

### C10 — host session identity is namespaced

Two hosts or runtime instances with the same external session string cannot collide into one Heli actor binding.

### C11 — project clone does not clone authority

Cloning/copying a bound project preserves project policy identity but transfers no:

- active lease,
- temporary grant,
- persistent trusted execution grant,
- runtime capability observation.

### C12 — global upgrade does not mutate active semantics

An active session pinned to runtime/policy set R continues under R until an explicit compatible transition.

### C13 — workspace registry is non-authoritative

Deleting/rebuilding the global locator index cannot grant, revoke, or change project authority.

### C14 — resource isolation

Two isolated worktrees can hold independent write authority unless they request the same modeled shared resource.

### C15 — remote authority has one owner

For a remote execution resource, Heli never treats a local JSON lease and a remote authority service as simultaneously authoritative.

---

## 24. Rejected alternatives

### 24.1 Mandatory mutable `~/.heli` global brain

Rejected because it creates hidden state, upgrade coupling, and split-brain risk.

Global distribution remains preferred UX; global authority does not.

### 24.2 Full self-contained workspace as the only mode

Rejected as the default because it repeats installation/runtime payload and host setup across projects.

Retained as an optional hermetic/offline packaging mode.

### 24.3 Task = write authority

Rejected because narrative work identity is not the same as the mutable resource that can conflict.

### 24.4 S0-S3 = permission levels

Rejected because workflow labels mix impact, uncertainty, and task type.

They remain UX summaries.

### 24.5 Explain as separate diagnostics logic

Rejected because it can diverge from real enforcement.

### 24.6 Broad YOLO as normal exception handling

Rejected for stable authority.

Bounded scoped grants become the normal exception mechanism. Emergency/debug bypass behavior, if retained, must have an explicitly limited threat model and provenance.

### 24.7 Heli-owned agent runtime/orchestrator

Rejected.

The differentiated value is cross-host governance, not duplicating Codex/Claude/Pi/OpenCode execution loops.

---

## 25. Benchmark requirement

Architecture acceptance requires controlled evidence, not only passing mechanism tests.

Compare within each supported host:

- host alone,
- host + v0.8.3,
- host + inspected v0.9,
- host + future candidate.

Measure separately:

### Capability

- independently verified task completion,
- first-attempt acceptance,
- validation quality.

### Governance

- unauthorized effects prevented,
- false-positive blocks,
- resource authority correctness,
- grant correctness,
- decision determinism,
- resume/recovery correctness.

### Friction

- unnecessary prompts,
- additional tool calls,
- token/context overhead,
- wall-clock overhead,
- Heli-caused retries,
- benign friction rate.

### Reproducibility

- runtime/config identity,
- clean clone behavior,
- isolated global state,
- host/version compatibility,
- decision replay/explanation consistency.

Reduced prompts are not a win if enforcement disappeared.

More evidence is not a win if ordinary coding success materially regresses.

Global distribution should be credited as installation/maintenance improvement unless controlled results show behavioral improvement.

---

## 26. Open design questions

These remain intentionally unresolved and should be answered before implementation planning for the relevant phase:

1. Which minimum resource classes are stable enough for v0.10?
2. When is local worktree authority mandatory in a single-agent trusted workspace versus optional?
3. Which supported hosts can return an approval/grant receipt with sufficient trusted identity?
4. Which execution environments can support real fencing after authority loss?
5. What exact compatibility relationship binds runtime, protocol, schema, adapter, and policy versions?
6. What portable evidence subset may be committed/exported without leaking sensitive operands?
7. Should the external term remain `task`, or migrate to `work record` while keeping CLI aliases?

None of these questions justify delaying v0.9 semantic unification.

---

## 27. Acceptance criteria for this RFC

This RFC is ready to become the basis for an implementation plan when the maintainers agree that:

- Heli's ownership boundary is correct,
- global distribution versus execution-local authority is explicit,
- project binding versus trust is explicit,
- resource-scoped authority replaces task-scoped authority as the target model,
- grant composition rules are acceptable,
- the canonical evaluator/transition requirement is accepted,
- decision receipt/explain semantics are accepted,
- work records are optional for ordinary work,
- v0.9 stable scope is narrowed accordingly,
- C1-C15 are accepted as the minimum conformance set.

After acceptance, produce a **separate implementation plan** with small migratable slices and explicit tests for each conformance scenario.

Do not expand this RFC into an implementation backlog before those decisions are frozen.
