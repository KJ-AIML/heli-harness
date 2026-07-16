# Sources — audit

## Author/reviewer separation

- **Google Engineering Practices, "What is Code Review?"** — defines code review as examination of code "by someone other than the author."
  https://google.github.io/eng-practices/review/
- **Google "How to do a code review", What to look for** — where the non-author-approval and tests-in-same-CL expectations actually live. (`standard.html` is about overall-code-health, not about non-author approval — easy to mis-cite.)
  https://google.github.io/eng-practices/review/reviewer/looking-for.html

## Review bias

- **Bacchelli & Bird, "Expectations, Outcomes, and Challenges of Modern Code Review" (ICSE 2013)** — qualitative survey of modern code-review practice and frictions across Microsoft teams; describes how reviewer context and author framing shape the review activity. The bias-by-author-identity finding specifically is more associated with later work (e.g., Murphy-Hill et al.); the skill grounds "brief the auditor cold" in the broader Bacchelli/Bird picture, not as a direct quoted finding.
  https://www.microsoft.com/en-us/research/publication/expectations-outcomes-and-challenges-of-modern-code-review/

## CI green ≠ done

- **Google Eng Practices, "How to do a code review"** — reviewer is the gate, not the test suite.
  https://google.github.io/eng-practices/review/reviewer/
- **DORA State of DevOps reports** — CI is a necessary precondition for healthy delivery, not the verification step itself.
  https://dora.dev/

## Honest note

The "under 200 words" cap is a writing-discipline heuristic, not an empirical finding. It exists because long audit reports correlate with unclear verdicts in practice — but that's craft observation, not measurement.
