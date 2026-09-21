# Pi / AXGA Adapter — v0.10.2

**Current lifecycle evidence:** [docs/ADAPTER_SUPPORT_MATRIX.md](../../../docs/ADAPTER_SUPPORT_MATRIX.md)

## Machine-level package activation

Recommended:

```bash
heli host install pi
heli host status
```

AXGA uses the same package model:

```bash
heli host install axga
heli host status
```

Host package installation is separate from project binding and separate again from live runtime evidence.

## Project setup

For a normal project:

```bash
npm install -g github:KJ-AIML/heli-harness#v0.10.2
heli setup
heli host install pi
cd /path/to/project
heli link
heli doctor
```

Inside Pi, `/heli-install` performs the same architectural action as `heli link`: it creates lightweight `.heli/` binding/state for the current project. It must not normally propose or create `./heli-harness` or `.heli-harness/`.

Useful Pi commands:

- `/heli-install` — link current project to global Heli
- `/heli-update` — show the machine-level global/Pi host update path
- `/hh-status` — report linked or compatibility status
- `/heli-help`
- `/heli-review`
- `/heli-audit`
- `/heli-validate`
- `/heli-impact`
- `/heli-hooks`
- `/heli-target`

## Embedded compatibility

A self-contained workspace remains available only by explicit legacy naming:

- `/heli-legacy-install` — create a local `.heli-harness/` compatibility tree
- `/heli-legacy-update` — refresh that compatibility tree

These commands are for hermetic/offline compatibility and dogfood. They are not the primary install recommendation.

## Version and update behavior

The Pi extension reports the Heli package version from root `package.json`. The host manager installs the version matching the global Heli distribution and records machine-level integration state for stale/current detection.

If an older Pi package/catalog copy is already published or installed, a new Heli release must refresh that external distribution; source HEAD alone is not treated as proof that users received the new package.

## Authority and safety

- Heli instructions are not a sandbox.
- Runtime guard claims depend on Pi exposing the tested hook/tool-call surface.
- Linked projects resolve authority and runtime state through the installed Heli package and `.heli/` binding.
- A local `.heli-harness/` tree is not required in normal linked mode.
- T6 hard-deny rules remain non-grantable by normal temporary grants.

Use the support matrix for exact current lifecycle and live-host evidence.
