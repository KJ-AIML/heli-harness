# Embedded / Hermetic Install — v0.10.2

The primary v0.10 model is **global/shared distribution + `heli setup` + `heli link`**. See the root [INSTALL.md](../INSTALL.md).

This document covers the self-contained `.heli-harness/` compatibility path.

## Current primary path

```bash
npm install -g github:KJ-AIML/heli-harness#v0.10.2
heli setup
cd /path/to/project
heli link
```

## Deliberate embedded compatibility install

```bash
npx github:KJ-AIML/heli-harness#v0.10.2 install /path/to/workspace
```

The embedded install copies distribution assets and seeds idle local state. It must not copy package-dogfood sessions, tasks, bindings, locks, grants, capability observations, or YOLO state into the destination.

## Existing embedded workspace → linked project

Update the embedded runtime to v0.10.2, ensure no active embedded writer authority remains, then run:

```bash
heli link /path/to/workspace
```

The cutover fails closed while active embedded write authority exists. Portable work/evidence may migrate; authorization does not.

## Host adapters

Host activation is separate from project binding. See [Adapter Support Matrix](../docs/ADAPTER_SUPPORT_MATRIX.md) and the root install guide for current host-specific commands.
