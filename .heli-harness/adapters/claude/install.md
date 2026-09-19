# Claude Code Install — Heli v0.10.0

## Current project setup

Use shared/global Heli distribution and link the project:

```bash
npm install -g github:KJ-AIML/heli-harness#v0.10.0
heli setup
cd /path/to/project
heli link
```

## Claude plugin

For the packaged/local plugin tree:

```bash
claude plugin install .heli-harness/adapters/claude-plugin
```

Project binding does not by itself prove plugin activation. Use `heli explain capabilities` and the current support matrix to distinguish documented/loaded/observed/tested enforcement.

## Embedded compatibility

A self-contained `.heli-harness/` install remains supported for hermetic/offline use. In that layout, `CLAUDE.md` may point at the embedded adapter and `.heli-harness/HARNESS.md` is the compatibility protocol.

Current support status and exact evidence: `docs/ADAPTER_SUPPORT_MATRIX.md`.
