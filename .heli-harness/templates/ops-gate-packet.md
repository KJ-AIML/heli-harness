# Ops gate packet

Use for S2/S3 staging/production smoke, launch, or multi-control-plane checks. Prefer a short packet over a long narrative when blocked.

```text
READY | BLOCKED
mission: <name or id>
target: <repo / worktree>
live_identity: <sha / revision / n/a>
durable_pin: <sha / n/a>
blockers:
  - <TYPED_CODE>: <one line evidence>
preflights:
  - <check>: pass|fail|skip — <evidence>
credentials_presence: <ok | missing KEY names only, never values>
entry_contract: <canonical URL/path or e2e spec path>
next_allowed: <none | action name>
do_not:
  - <forbidden action while blocked>
```

## Typed blocker examples

- `CREDS_MISSING`: required env keys absent (names only)
- `IDENTITY_PIN_DRIFT`: live identity ≠ durable pin
- `ACTION_UNSUPPORTED`: authorized request maps to no control-plane action
- `DNS_NOT_VERIFIED`: authoritative NS not ready
- `WRONG_ENTRY_PATH`: manual smoke path disagrees with e2e contract

## Rules

- Fail closed: BLOCKED means do not start the gated operation.
- One typed primary blocker is better than a multi-page report.
- Update this packet when evidence changes; mirror a one-line summary into the task Resume card.
