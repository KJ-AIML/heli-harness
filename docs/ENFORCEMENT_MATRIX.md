# Heli v0.10.0 Enforcement Matrix

**Status:** Current  
**Architecture:** [docs/architecture/README.md](architecture/README.md)  
**Adapter evidence authority:** [ADAPTER_SUPPORT_MATRIX.md](ADAPTER_SUPPORT_MATRIX.md)

This matrix maps current governance behavior to its documented contract and reproducible evidence. It does **not** claim that Heli is a sandbox or that all hosts expose equivalent enforcement surfaces.

| Behavior | Canonical contract | Runtime / CLI surface | Evidence |
| --- | --- | --- | --- |
| Project binding | `.heli/workspace.json` + `.heli/heli.lock`; mutable authority forbidden in project binding | `heli setup`, `heli link`, `heli doctor` | `smoke-global-project-binding` |
| Clone/execution identity | logical workspace may persist; machine/execution identity is fresh | project-binding resolver | `smoke-global-project-binding`, linked portability smoke |
| Resource-scoped writer authority | resource/worktree, not task name, is the conflicting write boundary | shared authority engine; human/machine transitions | `smoke-resource-authority`, convergence authority smoke |
| Stale reacquisition safety | expired previous owner cannot silently coexist with a newer active owner | authority transition layer | resource/convergence authority smokes |
| Human/machine lifecycle parity | equivalent transitions use canonical semantics | CLI + machine JSON surfaces | protocol/decision/convergence smokes |
| Scoped grants | approvals bounded by action/resource/execution/time/use; project files cannot self-approve | `heli grant issue|list|revoke` + evaluator | `smoke-scoped-grants` |
| T6 hard deny | normal grants do not make hard-deny rules grantable | shared guard/evaluator | quality guard + scoped-grant smokes |
| Trusted policy composition | project policy may narrow trusted ceiling, not elevate it | policy resolver + guard/evaluator | scoped-grant/policy composition coverage in check chain |
| Canonical decision receipts | structured decision identity/provenance shared by runtime/machine/explain paths | protocol decisions + explain/trace | `smoke-protocol-decisions`, `smoke-cli-explain`, `smoke-trace` |
| Capability truthfulness | declared/observed evidence is identity/freshness bound; observation != containment | capability protocol/explain | `smoke-protocol-capabilities`, `smoke-runtime-attestation` |
| Host-session namespace | external session strings are host/runtime scoped | session/capability resolution | convergence/runtime smokes |
| Evidence portability | work/evidence may move while grants/sessions/authority/capabilities do not | linked cloud bundle | `smoke-linked-portability`, `smoke-cloud-sync` |
| Embedded → linked cutover | active embedded writer authority blocks first link | `heli link` | `smoke-global-project-binding` |
| Diagnosis/evidence gates | structured evidence can gate retries/material changes when active | diagnosis CLI + shared hooks where supported | vNext root-cause/hook smokes |
| Adapter enforcement claims | host status must match actual smoke/live evidence | host plugin/hook integrations | [Adapter Support Matrix](ADAPTER_SUPPORT_MATRIX.md) |
| Release/package truth | package metadata, generated mirrors, install/update, docs and release state must agree | `npm run check` + release workflow | release validator, pack smoke, docs-currentness gate |

## Coverage rule

A behavior is called **enforced** only for the specific host/surface backed by evidence.

Shell-mediated side effects that cannot be reliably normalized must not be described as fully contained. Heli reports partial/advisory coverage rather than converting uncertainty into authority.

## Historical terminology

Older documentation used task-scoped writer leases, workspace-global state, and v0.8 evidence-tier descriptions as the primary model. Those remain compatibility/history terms only.

The current v0.10 authority model is resource-scoped and execution-local for linked projects.
