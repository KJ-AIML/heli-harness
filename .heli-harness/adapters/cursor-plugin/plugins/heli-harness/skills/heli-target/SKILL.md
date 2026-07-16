---
name: heli-target
description: Use when listing, showing, setting, or clearing the active target repo in a Heli-Harness multi-repo parent workspace, or when target.json may not match the repo the user named.
---

# Heli Target

Manage the active target repo recorded in `.heli-harness/workspace/target.json`, using the
known-repo list in `.heli-harness/workspace/index.json`. This mirrors `/heli-target` in the
Pi/AXGA extension (`extensions/pi-extension.js`); you perform the same steps yourself with your
own file tools — there is no command runtime in this plugin.

**Preferred method:** if Node.js is available, `npx github:KJ-AIML/heli-harness target
list|show|set <repo>|clear` performs the same list/show/set/clear operations as a real,
deterministic command instead of you replicating the steps below by hand. Fall back to the manual
steps only when Node/npx isn't available.

Treat `.heli-harness/workspace/index.json` as reviewable metadata and `target.json` as current
state, not long-term memory. A missing or malformed file is a warning, not a hard failure (see
`.heli-harness/workspace/README.md`).

Parse the request into one of: `list`, `show` (default when no subcommand is given),
`set <repo>`, `clear`.

## list

1. Read `.heli-harness/workspace/index.json`.
2. If it is missing, unreadable, or `repos` is not an array:
   - Warn: "Workspace index is not configured"
   - Info: "Create .heli-harness/workspace/index.json to track repos"
   - Stop.
3. Otherwise print `Known repos: <count>`, then one line per entry in `repos[]`:
   `<name or "(unnamed)"> -> path=<path or "missing">; gitRoot=<gitRoot or "missing">; profile=<profile or "missing">`,
   appending `; default` when that entry's `defaultTarget` is true.

## show (default)

1. Read `.heli-harness/workspace/index.json` and `.heli-harness/workspace/target.json` (either
   may be absent).
2. Print, one line each:
   - "Workspace index: detected" or "Workspace index: not configured"
   - "Target repo: `<targetRepo>`" or "Target repo: not selected"
   - "Target git root: `<targetGitRoot>`" or "Target git root: not selected"
   - "Writes allowed under: `<writesAllowedUnder>`" or "Writes allowed under: not selected"
   - "Active profile: `<activeProfile>`" or "Active profile: not selected"
   - "Usage: /heli-target list | /heli-target show | /heli-target set <repo> | /heli-target clear"

## set \<repo\>

1. If no `<repo>` selector was given, warn "Usage: /heli-target set <repo-name-or-path>" and
   stop.
2. Read `.heli-harness/workspace/index.json`. Find the entry whose `name`, `path`, or `gitRoot`
   case-insensitively matches the selector. If nothing matches, warn
   `No workspace repo matched "<selector>"` and stop — do not guess.
3. **Target-mismatch check, before writing anything:** read the current `target.json`. If it
   already has a non-empty `targetRepo` that differs from the matched repo's `name`, do not
   overwrite silently. Tell the user:
   `Target mismatch: the active target is "<current targetRepo>", you're about to switch to "<new repo name>". Confirm the switch, or say no to keep the current target.`
   Wait for explicit confirmation before continuing to step 4.
4. Write `.heli-harness/workspace/target.json`:
   ```json
   {
     "schemaVersion": 1,
     "targetRepo": "<repo.name>",
     "targetGitRoot": "<repo.gitRoot, falling back to repo.path>",
     "writesAllowedUnder": "<repo.gitRoot, falling back to repo.path>",
     "activeProfile": "<repo.profile, or empty string>",
     "selectedAt": "<current ISO-8601 timestamp>",
     "selectedBy": "heli-target",
     "reason": "<the original selector text>"
   }
   ```
5. Confirm: `Target repo set: <repo.name>` then `Target git root: <targetGitRoot>`.

## clear

1. Write `.heli-harness/workspace/target.json`:
   ```json
   {
     "schemaVersion": 1,
     "targetRepo": "",
     "targetGitRoot": "",
     "writesAllowedUnder": "",
     "activeProfile": "",
     "selectedAt": "<current ISO-8601 timestamp>",
     "selectedBy": "heli-target",
     "reason": "cleared"
   }
   ```
2. Confirm: "Target repo cleared".

## General guidance

- Never guess a target repo silently when more than one repo is registered and none is
  selected — run `list` or ask first.
- If `.heli-harness/workspace/` itself is missing, warn and point at
  `.heli-harness/workspace/README.md` rather than failing hard.
- This skill only records intent in `target.json`; it is not a sandbox or enforcement boundary.
  Hooks and your own judgment still gate writes.
