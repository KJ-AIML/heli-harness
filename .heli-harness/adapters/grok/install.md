# Grok Build Install — Heli v0.10.1

## Project setup

Use the current linked model first:

```bash
npm install -g github:KJ-AIML/heli-harness#v0.10.1
heli setup
cd /path/to/project
heli link
```

An embedded `.heli-harness/` install remains available for local/hermetic compatibility and supplies the packaged adapter files used below.

## Runtime hooks

Recommended linked/global activation:

```bash
heli host install grok
heli host status
```

Grok blocking is proven through user hooks loaded from `~/.grok/hooks/*.json`. For source/embedded compatibility, the underlying installer remains:

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
