# Workspace Metadata

**Current release:** `v0.10.2`

## Linked projects

Current project identity/config lives under the project-root `.heli/` directory:

- `.heli/workspace.json` — logical workspace/project identity and resource declarations;
- `.heli/heli.lock` — runtime/protocol/schema pins.

These committed files are not allowed to contain mutable live authority.

Current target/resource/authority state should be resolved through Heli CLI/machine surfaces and execution-local state.

## Embedded compatibility

`.heli-harness/workspace/index.json` and `target.json` remain part of the embedded compatibility layout.

- `index.json` lists known repos for the embedded parent workspace.
- `target.json` records embedded current target state.
- advisory lock examples remain compatibility hints, not distributed locks.

When `.heli/workspace.json` exists, do not treat embedded workspace metadata as the current linked authority owner merely because compatibility files remain on disk.
