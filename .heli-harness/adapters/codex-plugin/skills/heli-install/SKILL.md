---
name: heli-install
description: Bootstrap the Heli-Harness workspace harness into the current folder (parity with Pi/AXGA's /heli-install)
triggers:
  - /heli-install
  - /hh-install
  - heli install
  - bootstrap workspace harness
  - install heli-harness
---

# Heli Install

Bootstrap `.heli-harness/` plus the `AGENTS.md`/`CLAUDE.md` pointer files into the current
working directory, turning it into a Heli-Harness parent workspace. This mirrors Pi/AXGA's
`/heli-install` (`extensions/pi-extension.js`), which shells out to `install.ps1`/`install.sh`.
This plugin has no JS runtime, so you run those same scripts yourself with your own shell tool —
this skill does not reimplement install logic, it just tells you how to drive the existing one
safely.

## 1. Check whether this folder is already a workspace

Check whether `.heli-harness/HARNESS.md` already exists in the current directory.

- If it exists: **stop**. Warn "Workspace harness already installed in this folder." Do not run
  the installer — `install.ps1`/`install.sh` have no preserve-local-state logic (that only exists
  in `update.ps1`/`update.sh`), so re-running the installer over an existing workspace would
  silently overwrite `profiles/`, `workspace/`, `policies/`, `safety/`, and `state/`. If the goal
  is to bring an existing workspace up to a newer release, that's an update, not an install — use
  `update.ps1 -Parent <workspace>` / `update.sh <workspace>` from a checkout of the new version
  instead, which preserves those directories by design.
- If it does not exist: continue.

## 2. Confirm before writing

This creates real files (`.heli-harness/`, `AGENTS.md`, `CLAUDE.md`) in the current directory.
Tell the user exactly what will be created and where, and get explicit confirmation before
running the installer — do not run it silently.

## 3. Get a source checkout of Heli-Harness

You need a local checkout containing `install.ps1` (Windows) / `install.sh` (macOS/Linux) and the
full `.heli-harness/` source tree to install from. Two cases:

- **You already have one** (for example, this very plugin was loaded via `--plugin-dir` from a
  local checkout — in that case the repo root containing `install.ps1` is the directory three
  levels above this plugin's `skills/heli-install/` folder). If you can locate it, use it directly
  — no need to clone again.
- **You don't have one** (the common case when bootstrapping a brand-new workspace): clone a
  fresh, disposable checkout:
  ```bash
  git clone https://github.com/KJ-AIML/heli-harness.git hh-source-tmp
  cd hh-source-tmp
  git checkout "$(git tag --sort=-creatordate | head -1)"
  ```
  Do not hardcode a version tag in this skill — always resolve "the latest tag" at run time so
  this instruction doesn't go stale after future releases (see the `git tag --sort=-creatordate`
  line above).

## 4. Run the installer

From inside the source checkout, targeting the original workspace directory:

```bash
# macOS/Linux
./install.sh /path/to/workspace

# Windows
.\install.ps1 -Parent "C:\path\to\workspace"
```

## 5. Verify

Check that all of these now exist in the workspace directory — this is the same checklist Pi's
`verifyInstall` uses:

- `.heli-harness/HARNESS.md`
- `.heli-harness/manifest.json`
- `.heli-harness/skills/test-validation/SKILL.md`
- `AGENTS.md`
- `CLAUDE.md`

If any are missing, report exactly which ones and stop — do not claim success.

## 6. Clean up and report

- If you cloned a temporary checkout in step 3, remove it now (`hh-source-tmp`) — it was only
  needed to run the installer from.
- Report what was created: `.heli-harness/`, `AGENTS.md`, `CLAUDE.md`.
- Suggest next steps (from `INSTALL.md`'s "What next after install?"):
  1. Map repos in `.heli-harness/workspace/index.json`.
  2. Select the active target repo with the `heli-target` skill (`set <repo>`) before write
     workflows in a multi-repo workspace.
  3. Add a repo profile under `.heli-harness/profiles/<repo>.md`.
  4. Validate the repo profile's test commands in audit-only mode before relying on them.

## General guidance

- This skill only bootstraps the workspace files; it does not itself change which skills or hooks
  are loaded in the current session.
- Not a sandbox — running the installer performs real filesystem writes at the path you confirm
  with the user; treat it like any other write outside the currently-loaded plugin's own files.
