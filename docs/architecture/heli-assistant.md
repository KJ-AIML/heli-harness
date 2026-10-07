# Heli Assistant and Skill Refresh

Status: implementation design for the Heli v0.11 skill refresh.

## Goal

Make Heli easier to operate without weakening its governance model.

This change has two parts:

1. modernize and consolidate the existing skill set around the v0.11 linked-project topology;
2. add `heli-assistant`, a user-facing situational guide that understands the user's goal and current Heli state, then recommends the smallest supported path.

## Product role

`heli-assistant` is the "housemate who knows how Heli works."

It answers questions such as:

- What should I do next?
- Why can this host not write?
- Codex ran out of usage; how do I continue in Grok?
- This workspace is still on an old embedded Heli version; how do I migrate it?
- Do I need a durable task here?
- Why is a host integration stale?
- Which Heli command or specialist skill applies to this situation?

It is not a coding agent, scheduler, task allocator, or authority owner.

## Locked semantics

`heli-assistant` follows:

```text
Understand goal
  -> inspect only relevant Heli state
  -> explain the situation
  -> recommend the smallest supported path
  -> route to a specialist skill when needed
```

It MAY:

- use Heli CLI/state as authoritative facts;
- inspect Heli version, layout, workspace health, resume context, host lifecycle, runtime capabilities, tasks, handoffs, target/resource authority, and Git context when relevant;
- explain version or topology mismatch;
- recommend exact next commands;
- route to existing specialist skills.

It MUST NOT:

- spawn or select an agent;
- automatically assign work;
- acquire, transfer, or take over writer authority;
- issue grants or enable YOLO;
- push/sync/publish/deploy automatically;
- infer linked authority from stale embedded files;
- silently mutate project or Heli state merely to diagnose a situation.

When a requested action itself is authorized and the user explicitly asks for it, the normal specialist workflow and governance still apply.

## Sources of truth

Prefer Heli query surfaces over direct state-file inference when those surfaces exist.

Typical situational queries:

```bash
heli --version
heli status
heli doctor
heli resume --json
heli explain authority
heli explain capabilities
heli host status
heli task ...
heli handoff ...
heli target ...
```

Do not run all queries by default. Select the smallest set that answers the user's goal.

## Output model

A useful answer should normally expose:

```text
Heli Assistant

Goal:
<user's intended outcome>

Environment:
<version/layout/host facts that matter>

State:
<task/git/authority/capability facts that matter>

Diagnosis:
<short explanation>

Recommended path:
1. ...
2. ...

Avoid:
- ...

Specialist:
<skill or command family, if needed>
```

The exact shape may be compressed for simple situations.

## Skill architecture

The intended layers are:

```text
heli-assistant        user-facing situational guide
       |
using-heli-skills     workflow/protocol selector
       |
flow                  ambiguous-work router
       |
specialist skills     methodology
       |
Heli CLI/state        authoritative facts
```

`heli-assistant` is not a replacement for specialist skills.

## Existing skill refresh

### Foundation

- `heli-help`: describe the current CLI and linked v0.11 topology, including `resume`, host lifecycle, task/handoff, target, grants, and explain surfaces.
- `heli-install`: make the public npm package the normal install path; keep Git/source install as fallback or compatibility paths.
- `flow`: remove the requirement to update legacy `state/current-task.md` before ordinary linked edits; durable tasks are optional and purpose-driven.
- `debug` / `evidence-gates`: prefer canonical global CLI forms such as `heli diagnosis ...`, with embedded invocation documented only as a compatibility fallback.

### Wrapper consolidation

Keep ergonomic `/heli-*` entry points, but make them thin compositions rather than parallel methodologies:

- `heli-review` -> `audit` for focused change verification, `workflow` for broad sweeps.
- `heli-audit` -> composition of `workflow`, `deps`, `test-coverage`, and `impact` as triggered.
- `heli-impact` -> `impact`.
- `heli-validate` -> `test-validation` and the repo's actual verification profile.

All wrappers must resolve linked vs embedded layout instead of assuming `.heli-harness/`.

### Release

Strengthen `release` post-release evidence around:

- main/release SHA;
- annotated tag;
- package version;
- exact npm version visibility;
- npm dist-tag;
- fresh `npx`/installed CLI version;
- artifact or registry verification appropriate to the repo.

## Routing integration

Update `using-heli-skills`, `flow`, and `heli-help` so situational Heli questions route to `heli-assistant`.

Examples:

- "what should I do next with Heli?"
- "why can't Grok write?"
- "how do I continue after Codex?"
- "this repo is still Heli 0.8.x"
- "do I need a task?"
- "host status says stale"

## Compatibility

- Linked v0.11 is the primary topology.
- Embedded `.heli-harness/` remains a supported compatibility/hermetic topology.
- Skill guidance must not erase embedded compatibility where it is still intentional.
- Migration guidance must preserve the fail-closed authority boundary.

## Validation

The final change should prove:

- 31 canonical skill frontmatters are valid;
- plugin/host mirrors remain in sync with the canonical skill set;
- install and update flows include the new skill;
- obsolete linked-default assumptions are removed from the refreshed wrappers;
- no skill claims that installed files prove runtime enforcement;
- existing adapter/release validation remains green.
