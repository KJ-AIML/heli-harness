# Decisions

Durable harness-level decisions go here.

## 2026-09-19 — v0.10 architecture baseline

- Heli is a portable governance and coordination layer around a small policy/authority kernel.
- Shared/global installation is distribution + trusted user configuration, not one global mutable active-workspace authority.
- Linked project identity/config lives under `.heli/`; live authority is execution-local or authority-domain-local.
- Authority is resource-scoped; task identity is optional durable work/provenance.
- Scoped grants are the preferred temporary-approval model.
- Evidence may be portable; authorization does not move merely because a repository or bundle is copied.
- Current architecture: `docs/architecture/README.md` and ADR 0002.

## 2026-06-21 — historical, superseded in part

- Historical decision: Heli-Harness was parent-workspace scoped and not a global user-level install by default.
- Historical decision: `.heli-harness/HARNESS.md` was the workspace source of truth.
- Tool-specific setup belonged only in `adapters/`.

The first two bullets are superseded for current v0.10 linked topology by the 2026-09-19 decision. They remain here for provenance.
