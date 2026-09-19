# Pi / AXGA Adapter — v0.10.0

**Current support evidence:** [docs/ADAPTER_SUPPORT_MATRIX.md](../../../docs/ADAPTER_SUPPORT_MATRIX.md)

## Package install

```bash
pi install git:github.com/KJ-AIML/heli-harness@v0.10.0
axga install git:github.com/KJ-AIML/heli-harness@v0.10.0
```

The package exposes the Heli skill library and Pi extension. Host package installation does not automatically make a project linked or prove that every hook surface is enforced.

## Recommended project setup

Use the current linked model:

```bash
npm install -g github:KJ-AIML/heli-harness#v0.10.0
heli setup
cd /path/to/project
heli link
heli doctor
```

Pi should start from the linked project root and use `heli status` / `heli explain` to resolve current project, resource authority, and capability evidence.

## Embedded compatibility commands

`/heli-install` and `/hh-install` remain available for a deliberate self-contained `.heli-harness/` install. That is a compatibility/hermetic path, not the primary v0.10 topology.

Useful extension commands include:

- `/hh-status`
- `/heli-help`
- `/heli-init`
- `/heli-review`
- `/heli-audit`
- `/heli-validate`
- `/heli-impact`
- `/heli-hooks`
- `/heli-target`

## Authority and safety

- Heli instructions are not a sandbox.
- Runtime guard claims depend on the host exposing the tested hook/tool-call surface.
- Resource authority and scoped grants come from current Heli state, not from an editable project Markdown file.
- T6 hard-deny rules remain non-grantable by normal temporary grants.
- Do not infer broad enforcement merely because the Pi package or skills are installed.

Use the support matrix for the exact current evidence and limitations.
