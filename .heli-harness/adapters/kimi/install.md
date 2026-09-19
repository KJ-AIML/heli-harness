# Kimi Code CLI Install — Heli v0.10.0

## Project setup

```bash
npm install -g github:KJ-AIML/heli-harness#v0.10.0
heli setup
cd /path/to/project
heli link
```

## Hooks

From a package/source/embedded adapter tree:

```bash
node .heli-harness/adapters/kimi-plugin/install-user-hooks.mjs
kimi doctor config
```

The installer writes host configuration with absolute hook-script paths. Project binding does not prove those hooks loaded; use current runtime/capability evidence.

Current support/evidence: `docs/ADAPTER_SUPPORT_MATRIX.md`.
