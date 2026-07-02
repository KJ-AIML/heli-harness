---
name: heli-governance
description: Use when working in a Heli-Harness parent workspace.
---

# Heli Governance

Read `.heli-harness/HARNESS.md`, identify the target repo, preserve dirty user work, and run evidence-backed validation before claiming completion. If the repo the user describes differs from `.heli-harness/workspace/target.json`'s `targetRepo`, warn about the mismatch and confirm before proceeding — see the `heli-target` skill for the set/confirm workflow — rather than silently overriding or silently proceeding against the wrong repo.

Do not claim enforcement unless a runtime hook or local smoke proves it. Pointer adapters are context. Plugin hooks are guardrails, not a sandbox.
