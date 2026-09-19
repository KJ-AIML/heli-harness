# Codex Install — Heli v0.10.0

## Current project setup

Use shared/global Heli distribution and link the project first:

```bash
npm install -g github:KJ-AIML/heli-harness#v0.10.0
heli setup
cd /path/to/project
heli link
```

## Codex plugin

Recommended Git marketplace:

```bash
codex plugin marketplace add KJ-AIML/heli-harness
codex plugin add heli-harness@heli-harness
codex plugin marketplace upgrade heli-harness
```

The repository-root `.agents/plugins/marketplace.json` indexes the packaged Codex plugin.

Use `heli status` / `heli explain capabilities` to distinguish installed files from proven live activation.

## Embedded compatibility / local dogfood

For an intentional self-contained `.heli-harness/` install, the workspace-local marketplace remains available:

```bash
codex plugin marketplace add ./.heli-harness/adapters/codex-plugin
codex plugin add heli-harness@heli-harness
```

Bare `.heli-harness/...` without `./` is not a valid local marketplace source.

Current support status and evidence: `docs/ADAPTER_SUPPORT_MATRIX.md`.
