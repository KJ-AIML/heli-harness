---
name: fix-loop
description: Use when tests fail, CI fails, fixes keep failing, or a wave of findings needs triage and one-cause-at-a-time closure.
---

# fix-loop

Trigger: test failures, CI failures, repeated failed fixes, or multiple findings that need closure.

Scope:
- Triage findings by severity and dependency order.
- Verify the premise for each item before editing.
- Fix one cause at a time.
- Run the smallest relevant check after each fix.
- Track failed attempts.

## Failure classes (do not conflate)

| Class | Examples | Task state |
|-------|----------|------------|
| **Command friction** | PowerShell `&&`, bad quoting, wrong `-chdir`, module resolution outside package root, dotenv banner breaking JSON | Increment `Command friction count`. Fix the command. **Do not** burn Failed attempts / two-strike stop. |
| **Implementation failure** | Tests fail after a real code change; logic bug; wrong API | Increment `Failed attempts count`. After **two** on the same issue → stop and diagnose. |
| **Environment / capability** | Missing creds, unsupported control-plane action, pin drift | Typed blocker / gate packet. Not a "failed fix" until an implementation attempt exists. |

Rules:
- After two failed **implementation** attempts on the same issue, stop coding and write diagnosis.
- Do not retry expensive loops hoping for green.
- Do not mix unrelated fixes unless the repo profile permits batching.
- Prefer script files over complex inline shell when friction repeats (see `.heli-harness/templates/windows-shell-recipes.md`).

Loop:

```text
1. Confirm failure class (friction vs implementation vs capability).
2. Confirm failure still present.
3. Isolate cause.
4. Apply smallest fix (or rewrite command if friction).
5. Verify.
6. Record evidence.
7. Continue or stop with diagnosis.
```
