---
name: test-coverage
description: Use when a bug fix, risky refactor, weak suite, coverage question, or regression-prevention need requires identifying missing, weak, flaky, or misleading tests.
---

# test-coverage

Trigger: bug fix, risky refactor, weak test suite, coverage question, or regression prevention.

Scope:
- Read existing tests before adding new ones.
- Prefer behavior or regression tests over implementation assertions.
- Identify what would fail before the fix.
- Classify flakes instead of retrying blindly.

Rules:
- Do not add coverage theater.
- Do not mock the system under test.
- If a path cannot be tested, state why and document the residual risk.
