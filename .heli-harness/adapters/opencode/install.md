# OpenCode Install — Heli v0.10.0

## Project setup

Use current Heli project binding:

```bash
npm install -g github:KJ-AIML/heli-harness#v0.10.0
heli setup
cd /path/to/project
heli link
```

## Plugin activation

From a package/source/embedded adapter tree, copy the plugin tree into the project plugin directory:

```bash
mkdir -p .opencode/plugins
cp -R .heli-harness/adapters/opencode-plugin/. .opencode/plugins/
```

OpenCode auto-discovers `.js`/`.ts` entries. Keep `heli-harness.js` plus its relative `shared/` imports together.

A global host plugin copy may live under `~/.config/opencode/plugins/`. Global plugin installation is host integration; it does not make one project globally authoritative.

Use `opencode debug config` plus Heli capability evidence to confirm activation.

Current support/evidence: `docs/ADAPTER_SUPPORT_MATRIX.md`.
