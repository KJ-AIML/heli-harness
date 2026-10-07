# Flow-First Governance

Status: implementation design for issue #39.

## Problem

Heli can currently deny safe development repeatedly in embedded/concurrent compatibility mode when a valid session/task has no active writer lease. The denial is correct under the old ownership model but produces a bad operating loop:

```text
normal work
  -> NO_LEASE
  -> agent retries
  -> NO_LEASE
  -> usage burns
```

A user should not need `heli yolo on` to make normal S0/S1 work usable.

## Product principle

Normal safe work should flow. Heli should intervene when there is a real resource conflict, dangerous/irreversible operation, or required human decision.

## Locked invariants

1. `strict` keeps the linked resource-authority gate. `flow`, the default, recovers stale authority and blocks only a proven live path overlap.
2. A durable task is coordination/provenance, not the root write permission primitive.
3. A free worktree plus a valid active host session may establish writer authority automatically.
4. Another live writer remains a hard ownership conflict.
5. Foreign stale authority does not silently transfer to a different actor.
6. Recovery/control-plane operations must remain available when they are needed to inspect or repair governance state.
7. Same denial plus unchanged authority state must not invite an unbounded retry loop.
8. YOLO does not bypass real writer/resource conflicts and must not be required for ordinary development.

## Recovery model

Guard outcomes should classify blocked actions as one of:

- `AUTO_RECOVERABLE`: Heli can safely repair the missing authority and continue the original operation.
- `SELF_RECOVERABLE`: the current agent can run one explicit safe recovery action.
- `HUMAN_REQUIRED`: a human choice/approval is required before continuing.
- `HARD_DENY`: no retry is useful without changing the requested operation or policy.

A denial may also provide:

- stable `code`;
- `retryable`;
- `nextAction`;
- a blocker fingerprint derived from code + resource + holder/session identity where available.

## Compatibility writer happy path

In embedded/concurrent mode, when:

- a valid active session exists;
- the session is bound to a durable task;
- the session worktree is known;
- no conflicting live writer owns that worktree;
- no malformed/corrupt authority state exists;

then a normal write may automatically establish or renew that session's writer lease.

This is a compatibility-path convergence toward linked resource authority behavior. It is not task orchestration and does not select work for the agent.

## Recovery-safe control plane

Heli command execution used to inspect or repair Heli state must not be rejected merely because the coding session lacks writer authority.

At minimum the guard should recognize safe Heli control-plane intent for:

- status / doctor / resume;
- explain;
- task claim / release / takeover;
- session status / start / attach / close;
- other explicitly read-only or authority-recovery commands as validated by tests.

This exception is narrow: it does not make arbitrary shell commands safe, and it does not weaken dangerous command policy.

## Repeated-denial behavior

The runtime guard should make repeated identical denials machine-readable and host-facing context should instruct:

```text
same blocker + unchanged authority state
  -> do not retry the denied operation
  -> perform the single recovery action if SELF_RECOVERABLE
  -> otherwise stop and ask the human
```

The guard itself must stay deterministic and fail-closed. It must not depend on model memory to avoid loops.

## Human escalation

Human-required examples include:

- another live writer owns the worktree and takeover would replace it;
- explicit ownership takeover;
- destructive or irreversible operations;
- publish/deploy/production boundaries where existing policy requires approval;
- credential/policy authority changes.

The denial should say that the agent must stop and ask the user rather than repeatedly trying alternate commands.

## heli-assistant integration

`heli-assistant` explains the structured recovery outcome and routes to the smallest next step. It does not acquire extra authority merely because it is the assistant.

## Acceptance

- compatibility no-lease/free-worktree write flows without manual claim;
- expired own lease with no conflict renews/reacquires and flows;
- live writer conflict denies with HUMAN_REQUIRED and exact holder/resource;
- recovery commands remain usable during blocked state;
- repeated blocker emits no-retry guidance;
- YOLO remains unnecessary for normal safe work;
- linked v0.11 tests remain green;
- malformed/corrupt authority state remains fail-closed.
