---
name: heli-install
description: Use when installing, upgrading, linking, or migrating Heli. Prefer the public npm package plus heli setup/host install/link; embedded .heli-harness installs are compatibility/hermetic mode.
---

# Heli Install

## Normal v0.10 path

Use the published npm package:

```bash
npm install -g heli-harness@latest
heli --version
heli setup
heli host install all
heli host status

cd /path/to/project
heli link
heli doctor
heli status
```

This is the primary topology:

```text
global Heli distribution
  -> machine-level host integration
  -> project .heli/ binding
  -> execution-local runtime authority
```

Expected linked project files include:

```text
.heli/workspace.json
.heli/heli.lock
.heli/policies/
.heli/profiles/
.heli/safety/
.heli/skills/
```

Live grants, sessions, writer/resource authority, runtime capability observations, credentials, YOLO state, and process handles are not portable project binding.

## Existing embedded workspace

If a project already contains an intentional `.heli-harness/` workspace, do not replace it with a fresh install and do not delete it before migration.

Use the current global CLI to update the embedded compatibility runtime first:

```bash
heli update /path/to/workspace
heli status /path/to/workspace
```

Then:

1. verify the embedded runtime is linked-workspace-capable;
2. quiesce active embedded writer authority;
3. run:

```bash
heli link /path/to/workspace
```

The first link fails closed while active embedded write authority exists.

After cutover, verify:

```bash
cd /path/to/workspace
heli doctor
heli status
heli resume
```

Portable project/work evidence may migrate. Live sessions, bindings, leases/resource authority, grants, YOLO, credentials, sync runtime state, and capability observations do not migrate as authorization.

## Embedded compatibility / hermetic install

Use this only when the user intentionally needs a self-contained workspace bundle:

```bash
npx -y heli-harness@0.10.11 install /path/to/workspace
```

A source checkout is a fallback for development/offline needs:

```bash
git clone https://github.com/KJ-AIML/heli-harness.git hh-source
cd hh-source
git checkout v0.10.11
./install.sh /path/to/workspace
# Windows:
# .\install.ps1 -Parent "C:\path\to\workspace"
```

Before an embedded install writes files, explain that it creates a local `.heli-harness/` compatibility tree and host pointer files, and follow the active approval policy.

## Host lifecycle is separate

Project linking and host activation are separate concerns:

```bash
heli host install all
heli host status
heli host update all
```

Use `heli explain capabilities` after launching a supported host when runtime callback evidence matters. Installed files alone do not prove that the host invoked Heli.

## Version-aware guidance

Do not assume the workspace and global CLI are the same version.

When migration or compatibility is relevant, inspect:

```bash
heli --version
heli status /path/to/workspace
heli host status
```

Use `heli-assistant` when the user needs help choosing the correct upgrade/migration path for the actual workspace state.

## Boundary

- npm is the normal public distribution path.
- Git/source installation is a fallback, not the default onboarding path.
- Do not erase embedded state before a successful cutover.
- Do not carry old runtime authorization into a new linked execution.
