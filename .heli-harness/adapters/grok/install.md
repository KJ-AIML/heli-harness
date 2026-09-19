# Grok Build Install — Heli v0.10.0

## Project setup

Use the current linked model first:

```bash
npm install -g github:KJ-AIML/heli-harness#v0.10.0
heli setup
cd /path/to/project
heli link
```

An embedded `.heli-harness/` install remains available for local/hermetic compatibility and supplies the packaged adapter files used below.

## Runtime hooks

Grok blocking is proven through user hooks loaded from `~/.grok/hooks/*.json`. From a package/source/embedded adapter tree:

```bash
node .heli-harness/adapters/grok-plugin/install-user-hooks.mjs
grok inspect
```

Plugin inventory alone does not prove hook enforcement.

Optional skill plugin:

```bash
grok plugin validate .heli-harness/adapters/grok-plugin
grok plugin install .heli-harness/adapters/grok-plugin --trust
```

Current support/evidence: `docs/ADAPTER_SUPPORT_MATRIX.md`.
