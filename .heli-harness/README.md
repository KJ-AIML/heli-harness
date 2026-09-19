# Heli-Harness Embedded Distribution

**Current release:** `v0.10.0`  
**Current architecture:** [../docs/architecture/README.md](../docs/architecture/README.md)

This directory is the shipped **embedded compatibility/hermetic distribution** for Heli. It contains portable skills, policies, safety defaults, adapter assets, the embedded CLI mirror, and compatibility state schemas.

It is **not** the primary v0.10 project-binding topology.

For a normal linked project:

- shared/global Heli distribution provides the CLI/runtime;
- `heli setup` initializes trusted user/global state;
- `heli link` creates committed project binding under `.heli/`;
- live grants, sessions, resource authority, credentials, and capability observations remain execution-local.

When a project contains `.heli/workspace.json`, do not treat legacy `.heli-harness/state/`, `.heli-harness/workspace/`, task leases, or advisory locks as the current authority owner merely because those compatibility files exist.

Use this directory directly when:

- maintaining Heli itself;
- testing generated/packaged embedded assets;
- running a deliberate self-contained/offline install;
- migrating an older embedded workspace.

Canonical docs:

- root `README.md`
- root `INSTALL.md`
- `docs/architecture/README.md`
- `docs/architecture/governance-model.md`
- `docs/ADAPTER_SUPPORT_MATRIX.md`
