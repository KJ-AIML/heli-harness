---
name: heli-target
description: Show, list, set, or clear the active target repo in a Heli-Harness parent workspace
---

# Heli Target

Read `.heli-harness/workspace/index.json` and `.heli-harness/workspace/target.json` to show or list targets. Before edits in a multi-repo workspace, require an explicit selected target and ensure it matches the requested repository. Do not guess a target when none is selected.
