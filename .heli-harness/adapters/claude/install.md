# Claude Code Install — Heli v0.10.3

## Current project setup

Use shared/global Heli distribution and link the project:

```bash
npm install -g github:KJ-AIML/heli-harness#v0.10.3
heli setup
cd /path/to/project
heli link
```

## Claude plugin

Recommended linked/global activation:

```bash
heli host install claude
heli host status
```

For embedded/local compatibility, the packaged plugin tree can still be installed directly:

```bash
claude plugin install .heli-harness/adapters/claude-plugin
```

Project binding does not by itself prove plugin activation. Use `heli explain capabilities` and the current support matrix to distinguish documented/loaded/observed/tested enforcement.

## Embedded compatibility

A self-contained `.heli-harness/` install remains supported for hermetic/offline use. In that layout, `CLAUDE.md` may point at the embedded adapter and `.heli-harness/HARNESS.md` is the compatibility protocol.

Current support status and exact evidence: `docs/ADAPTER_SUPPORT_MATRIX.md`.
