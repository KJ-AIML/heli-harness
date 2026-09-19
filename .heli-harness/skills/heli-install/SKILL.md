---
name: heli-install
description: Use when setting up Heli. For v0.10 prefer global/shared distribution plus heli setup and heli link; /heli-install remains an embedded compatibility/hermetic install path.
---

# Heli Install

## Current v0.10 path

For normal projects, prefer:

```bash
npm install -g github:KJ-AIML/heli-harness#v0.10.0
heli setup
cd /path/to/project
heli link
heli doctor
```

This separates shared distribution from project binding and execution-local authority.

Expected linked project files:

```text
.heli/workspace.json
.heli/heli.lock
.heli/policies/
.heli/profiles/
.heli/safety/
.heli/skills/
```

Live grants, sessions, resource authority, credentials, capability observations, YOLO state, and process handles must not be committed as project binding.

## Existing embedded workspace

If `.heli-harness/HARNESS.md` already exists, do not overwrite it with a fresh installer.

To migrate:

1. update the embedded runtime to v0.10.0;
2. run `heli status`;
3. quiesce active embedded writer authority;
4. run `heli link <path>`.

The first link fails closed while active embedded writer authority exists.

## Embedded compatibility / hermetic install

The `/heli-install` command and installer scripts remain supported when the user intentionally wants a self-contained `.heli-harness/` workspace.

Preferred pinned command:

```bash
npx github:KJ-AIML/heli-harness#v0.10.0 install <path>
```

Manual source checkout is a fallback:

```bash
git clone https://github.com/KJ-AIML/heli-harness.git hh-source-tmp
cd hh-source-tmp
git checkout v0.10.0
./install.sh /path/to/workspace
# Windows:
# .\install.ps1 -Parent "C:\path\to\workspace"
```

Before writing, tell the user that the compatibility install creates `.heli-harness/` and host pointer files and obtain the approval required by the host/workflow.

Verify the embedded install with:

- `.heli-harness/HARNESS.md`
- `.heli-harness/manifest.json`
- `.heli-harness/skills/test-validation/SKILL.md`
- `AGENTS.md`
- `CLAUDE.md`

## Boundary

Host plugin activation is separate from project linking/embedded installation. Files on disk do not prove runtime enforcement.

Use `heli explain capabilities` and `docs/ADAPTER_SUPPORT_MATRIX.md` for current evidence.
