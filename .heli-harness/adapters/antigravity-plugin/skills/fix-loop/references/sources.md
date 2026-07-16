# Sources — fix-loop

Primary-source citations for the claims in `SKILL.md`. Read once on setup; not needed on every invocation.

## Author/reviewer separation

- **Google Engineering Practices, "What is Code Review?"** — defines code review as examination of code "by someone other than the author."
  https://google.github.io/eng-practices/review/
- **Google "How to do a code review", What to look for** — the LGTM-from-someone-else expectation; also where the "tests in same CL" guidance lives. (Note: not `standard.html`, which is about overall-code-health; that page does not carry the non-author-approval claim.)
  https://google.github.io/eng-practices/review/reviewer/looking-for.html

## Small batches

- **Google "Small CLs"** — "100 lines is usually a reasonable size for a CL, and 1000 lines is usually too large." (Quote lives here, *not* on `speed.html` — easy mis-cite.)
  https://google.github.io/eng-practices/review/developer/small-cls.html
- **Forsgren, Humble, Kim — *Accelerate* (2018), and the DORA State of DevOps reports** — small batch size correlates with deployment frequency, lead time, and change-failure rate. Underlying dataset published annually.
  https://dora.dev/

## Done = independent verification

- **Google "The CL author's guide"** — LGTM is the gate. CI green is necessary but not sufficient.
  https://google.github.io/eng-practices/review/developer/

## Reading dominates the day

- **Minelli, Mocci, Lanza, "I Know What You Did Last Summer" (2015)** — empirical study: developers spend roughly ~58% of active programming time on comprehension activities (reading, navigating, understanding), not writing. The wider "up to 70%" framing that gets quoted in talks stitches in numbers from other studies — don't combine them without naming each.
  https://ieeexplore.ieee.org/document/7181439

## Severity rubrics (P0-P4 / SEV-1..SEV-5)

- **Google SRE Workbook, "Managing Incidents"** — severity-driven response model.
  https://sre.google/workbook/managing-incidents/
- **PagerDuty Incident Response** — SEV-1..SEV-5 framework, widely adopted across industry.
  https://response.pagerduty.com/before/severity_levels/

## Reversibility gate (Type 1 / Type 2 decisions)

- **Jeff Bezos, 2016 Letter to Shareholders** — the one-way-door / two-way-door framework. (Often misattributed to the 2015 letter; the framing actually appears in 2016.)
  https://www.aboutamazon.com/news/company-news/2016-letter-to-shareholders

## Blameless wrap-up

- **John Allspaw, "Blameless Post-Mortems and a Just Culture" (Etsy, 2012)** — origin of the blameless-postmortem norm.
  https://www.etsy.com/codeascraft/blameless-postmortems
- **Google SRE Book, "Postmortem Culture: Learning from Failure"** — Allspaw-derived postmortem template adopted at Google.
  https://sre.google/sre-book/postmortem-culture/

## Process hygiene (paraphrased, not direct quotes)

- **Kernighan & Pike, *The Practice of Programming* (1999)** — the general principle that simpler code beats clever code, paraphrased here from chapters on style and debugging. Not quoted verbatim.

## Honest note on agent loops

The "wave of 3-5 parallel agents" sizing is operational lore, not a published number. It comes from cost-of-context vs. throughput experience running multi-agent loops in practice. Treat as a starting heuristic, not a settled finding.
