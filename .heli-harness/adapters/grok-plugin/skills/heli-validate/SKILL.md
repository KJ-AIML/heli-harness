---
name: heli-validate
description: Use when invoking the ergonomic /heli-validate entry point. Resolve the repo's real verification context, then delegate safe command classification and execution to test-validation.
---

# Heli Validate

`heli-validate` is a thin entry point for the canonical `test-validation` protocol.

## Resolve context

When Heli manages the project, start with:

```bash
heli status
```

Use the active linked `.heli/` profile/overlays or embedded compatibility profile as appropriate. Do not assume `.heli-harness/HARNESS.md` exists in a normal linked v0.10 project.

Identify the repository's actual verification commands from its package/build files, repo docs, and current Heli profile facts.

## Delegate

Read and follow `test-validation`.

That protocol owns:

- command existence checks;
- read-only vs mutating vs destructive classification;
- dependency preflight;
- safe hydration constraints;
- execution of approved/safe verification;
- post-run Git status checks;
- failure classification;
- profile-correction routing.

Use `audit` when validating a completed change claim rather than the safety/correctness of the verification command itself.

## Rules

- Do not silently install dependencies.
- Do not run mutating, API-cost-bearing, publish/deploy, or destructive commands merely because this wrapper was invoked.
- Do not edit source while performing validation-only work.
- Do not claim a command is non-mutating without checking post-run repository state.
- Existing policy, authority, and human-approval rules remain in force.

## Output

Return the canonical `test-validation` result and identify the command/profile source used.
