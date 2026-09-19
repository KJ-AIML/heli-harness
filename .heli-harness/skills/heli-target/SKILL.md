---
name: heli-target
description: Use when resolving or changing the active target/resource context. Prefer Heli CLI in linked v0.10 projects; direct .heli-harness workspace files are embedded-compatibility only.
---

# Heli Target

## Resolve layout first

Run `heli status`.

### Linked v0.10 project

Use the CLI/machine surfaces as the canonical path:

```bash
heli target list
heli target show
heli target set <repo>
heli target clear
heli explain authority
```

Project identity/resources come from `.heli/workspace.json`; live target/resource authority is resolved by Heli from execution-local state.

Do not manually edit old `.heli-harness/workspace/target.json` and assume it controls a linked project.

When changing target/resource scope:

- do not silently switch away from an explicitly active user target;
- validate the selected resource against project binding/index facts;
- re-evaluate authority/grants if the resource scope changes;
- preserve dirty work.

### Embedded compatibility workspace

When no linked binding exists and the project deliberately uses the embedded layout, `.heli-harness/workspace/index.json` and `target.json` remain compatibility state.

Prefer the same `heli target ...` commands. If the CLI cannot run, manual file handling may be used only according to the embedded workspace schema.

## General guidance

- Never guess among multiple plausible targets.
- Target intent is not itself write authority.
- A task name is not the current linked authority boundary.
- Hooks/guards and the resource-authority evaluator determine the enforceable governance outcome on supported surfaces.
