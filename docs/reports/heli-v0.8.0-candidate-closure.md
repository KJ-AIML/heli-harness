# Heli Track A — v0.8.0 Candidate Final Closure

## Starting SHA

`2d5cc7449b7149d673a4ce3efa0ed5b8b83cbaf2` on local `main`; `origin/main`
resolved to the same local object. No fetch, push, tag, or remote mutation was
performed during closure.

## Final Candidate SHA

The exact post-commit SHA is recorded in the parent Heli task closure report
after the local commit. This source report is the pre-commit freeze record;
the implementation is not changed after this point except for commit metadata.

## Candidate Version

Heli-Harness `0.8.0` candidate. The candidate is explicitly local-only and is
not a published release.

## Diff Summary

The audited candidate contains 151 expected paths at freeze: shared diagnosis
state/gates and CLI surfaces, Pi and six generated plugin mirrors, evidence-gate
skill parity (30/30), safety defaults and migration, docs/matrices, the
12-scenario benchmark, release validation, fresh-install coverage, and the
0.7.3-compatible upgrade fixture. No unrelated product repository was touched.

## Architecture Review

Independent read-only review mapped the requested A–X behaviors to the
canonical diagnosis core, task-local event/state paths, CLI transitions,
supported hook/tool-call consumers, Pi integration, safety policy, generated
mirrors, update migration, docs, and deterministic tests. Review 1 was
PASS-with-findings; review 2 was PASS after the focused corrections below.

## Adversarial Review

The first read-only pass reproduced two real bypasses: malformed diagnosis JSON
was treated as absent, and a changed source SHA alone could justify an expensive
retry. The second independent pass passed forged-FACT, contradiction/reroute,
malformed-state, SHA-only, stale-verification, mirror-parity, and documentation
surface probes.

## Findings Resolved

- `readDiagnosis` now distinguishes a missing sidecar from malformed JSON and
  returns an explicit invalid state that blocks material writes and completion
  while preserving the file for repair/audit.
- Expensive retry materiality now requires a relevant file, config/environment
  change, or explicit change reference plus summary and predicted effect;
  source SHA is retained as evidence but is not sufficient by itself.
- Regression coverage and all generated shared mirrors were updated.

## Root-Cause Convergence

The diagnosis record stores the symptom, closest proven boundary, normalized
failure signature/class, hypothesis, evidence, falsifier, causal change,
prediction, run history, and next smallest action. Root-cause establishment is
evidence-gated and preserves append-only events.

## Evidence-Gated Autonomy

S0/S1 simple success remains lightweight. Active S2/S3 material work requires
current diagnosis evidence and root cause; S2 exposes structured independent
review; S3 and production/destructive/irreversible work require human evidence.

## Failure-Class Rerouting

Same normalized class preserves class-specific attempts and prior failure
context. A new stage/subsystem/error class creates `NEW_FAILURE_CLASS`, keeps
historical context, resets current hypothesis/evidence, and requires rerouting.

## Hypothesis Invalidation

Unsupported `FACT`/supported classifications are rejected without current
supporting evidence. Contradicting evidence marks the hypothesis
`CONTRADICTED`, retains the event, and blocks material implementation until a
new route earns current evidence.

## Subsystem Checkpoints

Changing the responsible subsystem requires a structured checkpoint recording
what is known, what changed, why the previous boundary is no longer primary,
the new closest boundary, and the next discriminating action.

## Expensive Retry Gates

The first expensive action is recorded. Repeated actions require a relevant
material change, new discriminating evidence after cheaper checks, a bounded
transient policy, or explicit human override. No-change and SHA-only retries
are denied; prior action/run/signature/boundary/change/prediction/count/cost
context is retained.

## S0–S3 / Human Authority

S0 autonomous; S1 autonomous with self-checkpoints; S2 evidence plus
independent-review metadata; S3 human-controlled. Production mutation,
security-boundary changes, destructive/irreversible actions, credentials or
policy authority, unresolved business intent, and unbounded cost remain human
authority boundaries.

## YOLO

YOLO reduces friction only. Ownership, lease, reroute, checkpoint, root-cause,
expensive-action, S3, and production gates remain enforced in supported runtime
paths.

## CLI / Hooks

The embedded and package CLIs expose diagnosis init/show/record/route/gate and
completion checks. Supported PreToolUse/tool-call hooks and Pi consult the
shared evaluator. Hosts without a proven portable post-result contract use
the explicit structured `record run` transition.

## Host Enforcement Matrix

The adapter matrix distinguishes enforced/wired/plugin-wired/documented/planned
and advisory hosts. Supported native hooks received the shared diagnosis core;
Cursor/generic/unsupported surfaces remain explicitly advisory and are not
counted as runtime enforcement proof.

## 12 Scenario Results

`node scripts/smoke-vnext-root-cause.mjs` passed twice. All 12 scenarios pass:
false premise, contradicted hypothesis, same failure after change, new
downstream failure, subsystem checkpoint, denied expensive retry, material
retry, discriminating retry, bounded transient, S1 autonomy, S2 review, S3
human control, plus the lightweight successful-task assertion included by the
contract.

## Hard Guard Results

`quality-guard-strictness.mjs`: 310 hard assertions passed, 0 failed, with 12
documented soft gaps covering best-effort command-pattern obfuscation and the
trusted lease-holder boundary. These are not claimed as sandbox enforcement.

## Full Verification

Authoritative `npm run check` passed with loopback permission for the isolated
cloud-sync smoke. It also passed syntax checks, CLI smokes, concurrency,
plugin/adapter smokes, vNext hooks, pack artifact, adapter verification
(215/0), release validation (70/0), and all mirror checks. The initial sandbox
run was blocked only by `listen EPERM` on local loopback; no test logic failed.

## Fresh Install

`smoke-cli-diagnosis.mjs` passed on a clean install and exercised task create,
claim, diagnosis init, contradicted hypothesis, verify-premise reroute,
passing verification, expensive retry denial/justification, and completion.

## Upgrade from 0.7.3

`smoke-vnext-upgrade-0.7.3.mjs` passed using an isolated fixture with 0.7.3
metadata and vNext assets removed before update. The update restored the new
diagnosis/skill/CLI assets and upgraded the manifest to 0.8.0.

## Overlay / Safety Migration

The upgrade preserved profiles, workspace index/target, policies, current
task, tasks, sessions, bindings, and locks. Local safety entries survived;
new `heli-cloud-push` and expensive-action defaults were merged by stable id,
with `defaultsVersion` set to `0.8.0`.

## Version / Manifest Consistency

`package.json`, root `manifest.json`, embedded `.heli-harness/manifest.json`,
adapter metadata, plugin manifests, docs, and package checks report `0.8.0`;
canonical and plugin skill trees are 30/30.

## Changelog

`CHANGELOG.md` starts with the 0.8.0 candidate entry and explicitly records
that publication, tagging, release, and deployment were not performed.

## Candidate Commit

Pre-freeze commit subject: `feat: add root-cause convergence and evidence-gated autonomy`.
No `--no-verify` path is authorized or used.

## Post-Commit Verification

Pending the local commit. The parent Heli task report will record the exact
full SHA, commit identity, post-commit checks, and clean-tree result.

## Git Tree State

At pre-commit freeze, all 151 paths are intentional candidate changes listed
above. No unrelated or secret-bearing file was detected; `git diff --check`
passed.

## Known Non-blocking Boundaries

Live provider/host verification was not run. Unsupported hosts and arbitrary
log interpretation remain advisory. Command guards are best-effort pattern
guards, not a sandbox; a trusted lease holder is not treated as an adversary.

## External Release Actions NOT Performed

No fetch, push, force-push, tag, npm publish, GitHub release, deployment,
production mutation, marketplace publication, or external promotion was
performed.

## Track A Verdict

Implementation and verification are complete pending only the authorized local
commit and its post-commit clean-tree identity check. The exact final verdict
is recorded in the parent Heli task report after that check.
