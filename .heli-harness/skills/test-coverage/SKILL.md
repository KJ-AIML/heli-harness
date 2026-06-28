---
name: test-coverage
description: Identify missing, weak, flaky, or misleading tests and propose focused coverage.
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

