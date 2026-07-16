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

Rules:
- After two failed fix attempts on the same issue, stop coding and write diagnosis.
- Do not retry expensive loops hoping for green.
- Do not mix unrelated fixes unless the repo profile permits batching.

Loop:

```text
1. Confirm failure.
2. Isolate cause.
3. Apply smallest fix.
4. Verify.
5. Record evidence.
6. Continue or stop with diagnosis.
```

