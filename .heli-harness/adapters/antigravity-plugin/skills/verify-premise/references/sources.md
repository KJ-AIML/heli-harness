# Sources — verify-premise

## The "read before acting" discipline

- **John Ousterhout, *A Philosophy of Software Design* (2018, 2nd ed. 2021)** — chapter on "Strategic vs. Tactical Programming" makes the case that the most expensive errors are caused by *not understanding the existing code* before changing it.
- **Microsoft empirical study on developer time** — developers spend ~58% of active time on comprehension, not writing. Reading IS the work. (Minelli, Mocci, Lanza 2015.)
  https://ieeexplore.ieee.org/document/7181439

## The "bug report is often wrong" finding

- **Bettenburg et al., "What makes a good bug report?" (FSE 2008)** — empirical study of bug-report quality showed roughly 1 in 3 bug reports is incomplete, mislocated, or describes a symptom of a different bug than the one named.
  https://dl.acm.org/doi/10.1145/1453101.1453146
- **Simon Tatham, "How to Report Bugs Effectively"** — canonical essay; reverse-side useful for verifying bug reports the reader receives.
  https://www.chiark.greenend.org.uk/~sgtatham/bugs.html

## User memory anchor

This skill encodes the user's stated rule in `feedback_verify_issue_premise.md`:

> Before implementing any fix, read cited files and trace behavior to confirm the bug exists as claimed. Token cost is not a reason to skip.

The skill makes that rule callable as its own capability, instead of being one paragraph inside `fix-loop` Phase 0 that only fires on multi-finding waves.

## Honest notes

- The "1 in 3 bug reports is incomplete or mislocated" framing of Bettenburg et al. is a paraphrase of their findings; the paper reports a more nuanced breakdown by quality dimension. The takeaway — bug reports are wrong often enough that verifying is non-optional — is the durable point.
