# Heli v0.11.2 Enforcement Matrix

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
| Scoped grants | approvals bounded by action/resource/execution/time/use; project files cannot self-approve; issued only by a human at an interactive terminal; consumed only when the call is finally allowed | `heli grant issue|list|revoke` + evaluator | `smoke-scoped-grants`, `smoke-command-rules`, `smoke-self-protection` |
| Approved runs (unreleased) | a human approves a plan once at an interactive terminal; its `git.push` grant covers only unforced pushes to the plan's branch of its remote while the plan text is unchanged; default branches refused at approval; tags, deletions and merges never covered; `done`/`stop` revoke it | `heli run approve|status|done|blocked|resume|stop` + grant constraint in the evaluator | `smoke-approved-runs`, `smoke-constrained-push` |
| Approved-run keep-going (Claude Code) | the session bound to an active run is kept working until it reports `heli run done` or `heli run blocked`; at most 40 continuations per run; other sessions and ended runs stop normally; fails open | Claude plugin Stop hook | `smoke-run-stop-hook` |
| Remote git writes | `git push`, `git subtree push`, `gh pr merge` and `glab mr merge` all need the `git.push` approval | shared guard push gate | `smoke-remote-writes`, `smoke-command-rules` |
| T6 hard deny | every rule is evaluated; any T6 match wins over grants, YOLO and `HELI_ALLOW_COMMAND`; a non-removable built-in floor survives empty rules files; a missing/unreadable rules file denies shell commands | shared guard/evaluator | `smoke-command-rules`, quality guard + scoped-grant smokes |
| Fail-closed hooks | a hook that cannot evaluate a call denies it; the decision is emitted before audit side effects; 30 s PreToolUse timeouts | shared PreToolUse wrappers + host hook configs | `smoke-hook-fail-closed`, `smoke-hook-configs` |
| Heli self-protection | agents cannot issue grants, enable YOLO, approve a run, set the governance profile, take over or transfer write authority, remove Heli, write Heli authority state or disable Claude Code hooks | shared guard + CLI terminal gate | `smoke-self-protection`, `smoke-policy-protection`, `smoke-approved-runs` |
| Project governance files | agent writes to `.heli/safety/**`, `.heli/policies/**`, `.heli/workspace.json`, `.heli/heli.lock`, or moving/removing `.heli`, are refused (`HELI_POLICY_PROTECTED`), under YOLO too | shared guard (file tools, shell, MCP) | `smoke-policy-protection` |
| Deny recovery | every PreToolUse deny carries `recoverability` (`SELF_RECOVERABLE`, `HUMAN_REQUIRED`, `HARD_DENY`), `nextAction` and the conduct for its class; a write conflict whose lease lapses within a minute is `SELF_RECOVERABLE` with `retryAfterSeconds` | shared guard | `smoke-deny-recovery` |
| YOLO expiry | `heli yolo on` expires after 8 hours unless `--hours`/`--no-expiry` says otherwise; every linked SessionStart says when YOLO is on | YOLO CLI + SessionStart context | `smoke-yolo-expiry` |
| Claude Code tool coverage | Bash, PowerShell, Monitor, Edit, Write, NotebookEdit and MCP tools reach the guard | Claude plugin PreToolUse matcher | `smoke-claude-windows-coverage` |
| Trusted policy composition | project policy may narrow trusted ceiling, not elevate it | policy resolver + guard/evaluator | scoped-grant/policy composition coverage in check chain |
| Canonical decision receipts | structured decision identity/provenance shared by runtime/machine/explain paths | protocol decisions + explain/trace | `smoke-protocol-decisions`, `smoke-cli-explain`, `smoke-trace` |
| Capability truthfulness | declared/observed evidence is identity/freshness bound; observation != containment | capability protocol/explain | `smoke-protocol-capabilities`, `smoke-runtime-attestation` |
| Host-session namespace | external session strings are host/runtime scoped | session/capability resolution | convergence/runtime smokes |
| Evidence portability | work/evidence may move while grants/sessions/authority/capabilities do not | linked cloud bundle | `smoke-linked-portability`, `smoke-cloud-sync` |
| Cloud sync integrity (experimental) | pulls refuse plaintext under E2E, rollbacks, relabeled ciphertext and unaccepted governance changes; activation needs an explicit confirmation | `heli pull`, `heli init`, sync API | `smoke-cloud-sync` |
| Embedded → linked cutover | active embedded writer authority blocks first link | `heli link` | `smoke-global-project-binding` |
| Diagnosis/evidence gates | structured evidence can gate retries/material changes when active | diagnosis CLI + shared hooks where supported | vNext root-cause/hook smokes |
| Adapter enforcement claims | host status must match actual smoke/live evidence | host plugin/hook integrations | [Adapter Support Matrix](ADAPTER_SUPPORT_MATRIX.md) |
| Release/package truth | package metadata, generated mirrors, install/update, docs and release state must agree | `npm run check` + release workflow | release validator, pack smoke, docs-currentness gate |

## Coverage rule

A behavior is called **enforced** only for the specific host/surface backed by evidence.

Shell-mediated side effects that cannot be reliably normalized must not be described as fully contained. Heli reports partial/advisory coverage rather than converting uncertainty into authority.

## Historical terminology

Older documentation used task-scoped writer leases, workspace-global state, and v0.8 evidence-tier descriptions as the primary model. Those remain compatibility/history terms only.

The current v0.11 authority model is resource-scoped and execution-local for linked projects.
