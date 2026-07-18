# Current Task

Target repo:

Task:

Mode:

Risk tier:

Plan: n/a

Step count: 0

Files expected to change:
- 

Dirty files observed:
- 

Planned verification:
- 

Relevant skills consulted:
- 

Current status:

Failed attempts count: 0

Command friction count: 0

Next smallest action:

## Resume card

Keep this block current after every verify or blocker (one glance for handoff):

```text
Last verified: <sha / command / n/a>
Gate: READY | BLOCKED
Blocker: <none | typed code + one line>
Smoke/entry: <url or n/a>
Do not: <out-of-scope actions>
Next: <single next action>
```

## Gate packet (optional, S2/S3 ops)

When production/staging smoke or multi-gate launch work needs a single truth packet, fill or attach:

```text
READY | BLOCKED
blockers:
  - <TYPED_CODE>: <one line>
preflights: <summary>
identity: <live vs durable pins if any>
next_allowed: <none | named action>
```

## Closeout rules

- After a step/verify passes: update plan step Evidence + Status: complete in the **same turn**.
- After a discovery invalidates Next smallest action: rewrite it immediately (do not leave stale "await X" when X is done or impossible).
- Plan Evidence holds measured results only. Product-defect claims require a `verify-premise` pass first.
- Increment Failed attempts count only for failed **implementation/fix** attempts — not shell quoting, path, or host-syntax friction (use Command friction count for those).
