# Antigravity CLI Install — Heli v0.10.3

## Project setup

```bash
npm install -g github:KJ-AIML/heli-harness#v0.10.3
heli setup
cd /path/to/project
heli link
```

## Plugin

`heli host status` reports Antigravity as manual because its plugin directory is version-specific. Stage the packaged Heli Antigravity plugin in the host plugin directory appropriate to the installed Antigravity version. The packaged source tree is under:

```text
.heli-harness/adapters/antigravity-plugin/
```

Project-level host hooks may reference the same scripts.

Plugin presence/wiring is not equivalent to tested enforcement. Current evidence is authoritative in `docs/ADAPTER_SUPPORT_MATRIX.md`.
