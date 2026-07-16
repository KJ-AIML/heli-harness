# Sources — debug

## The scientific method applied to debugging

- **Andreas Zeller, *Why Programs Fail: A Guide to Systematic Debugging* (2nd ed., 2009)** — the academic backbone: the TRAFFIC method (track, reproduce, automate, find origins, focus, isolate, correct), and **delta debugging** — systematically shrinking failing input to a minimal repro. Step 1's "shrink it" is delta debugging by hand.
- **David J. Agans, *Debugging: The 9 Indispensable Rules* (2002)** — the practitioner classic. The skill's steps map to his rules: "Make It Fail" (deterministic repro), "Quit Thinking and Look" (instrument, don't stare), "Change One Thing at a Time", "Keep an Audit Trail", "If You Didn't Fix It, It Ain't Fixed" (never fix what you can't explain).

## Bisect

- **git-bisect documentation** — `git bisect run` automates the binary search over history given a runnable repro.
  https://git-scm.com/docs/git-bisect
- The pack's own small-commit discipline (branch unit mapping) is what makes bisect's answer actionable — a Google-CL-guide-sized commit is readable; a mega-commit is not.

## "Select isn't broken"

- **Hunt & Thomas, *The Pragmatic Programmer* (1999, 20th-anniversary ed. 2019)** — "select is not broken": the bug is overwhelmingly in your code, not the platform. Encoded in the anti-patterns.

## Honest notes

- The "two failed fixes → stop and re-frame" threshold is a working heuristic, not an empirical finding. The durable point is that repeated failed fixes are evidence the *framing* is wrong, which more fixing cannot repair.
- Rubber-duck explanation (step 6's written causal chain) is folklore-supported rather than study-supported, but the cost is one paragraph and it doubles as the commit-message body and the audit handoff.
