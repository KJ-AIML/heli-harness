# Documentation Overhaul Design

## Goal

Make Heli-Harness easy to understand, safe to evaluate, and accurate to install for developers, agent users, and people sharing it with their audiences.

## Scope

This is a documentation-only S2 change. It covers the public README, installation and support documentation, roadmap and contribution guidance, and the benchmark methodology. It does not change product behavior, release a version, or add dependencies.

## Public README

The README will use plain-text UTF-8-safe headings and retain the existing hero artwork with accurate alt text. Its order will be:

1. One-sentence promise and two calls to action: install and view supported agents.
2. A short before/after explanation of the multi-repo agent problem.
3. What Heli-Harness provides: target identity, durable task state, policies, and guardrails.
4. A three-step workflow and copy-paste quickstart.
5. A compact, evidence-qualified support summary that links to the support matrix.
6. Clear boundaries: Heli-Harness is not an agent runtime or a sandbox; live-tested hooks cover only named actions.
7. Benchmark methodology and documentation links.

Detailed adapter commands, status taxonomy, verification caveats, and release history will remain in linked documents rather than the first-read path.

## Operational Documentation

`INSTALL.md` becomes the single end-user installation guide. It will show actual installation commands for supported adapters and mark maintainer-only verification commands as such. `docs/INSTALL_MATRIX.md` and `docs/ADAPTER_SUPPORT_MATRIX.md` will use valid `.heli-harness/adapters/...` paths and link to the detail guide instead of duplicating it.

The adapter support matrix remains the status source of truth. Architecture documentation will avoid frozen host-status claims and link to that matrix. `SECURITY.md` will accurately distinguish narrowly scoped hook blocking from sandboxing. `CONTRIBUTING.md` will name the project correctly and direct contributors to `npm run check`.

`ROADMAP.md` will become a concise current plan with `Now`, `Next`, and `Not doing` sections. Historical release detail stays in `CHANGELOG.md`; no release claim will be deleted without a durable replacement.

## Benchmark Methodology

Benchmarks will never instruct an agent to execute a real publish, push, or destructive command. Unsafe-command evaluation will use explicit simulation or interception requirements. All benchmark materials will use the repository's T0-T6 safety taxonomy.

Scoring will define when a metric is applicable, how N/A scores are excluded, and how category and overall scores are calculated. A report-quality score applies only if every compared mode receives the same report requirement or an evaluator supplies an equivalent transcript. Comparison language will record observed outcomes rather than presume Heli-Harness prevented drift or overbuilding.

Benchmarks remain an illustrative local methodology until measured runs with reproducibility metadata exist. The README will state that limit directly.

## Validation

- Scan all Markdown files using strict UTF-8 decoding and reject literal mojibake sequences.
- Check every local Markdown link and referenced adapter path touched by this change.
- Run `npm run check`.
- Review the final diff for unsupported claims, accidental release changes, and edits outside the declared scope.

## Rollback

All changes are Markdown-only. Reverting the documentation commit restores the prior text without affecting installed harness behavior or user workspace state.
