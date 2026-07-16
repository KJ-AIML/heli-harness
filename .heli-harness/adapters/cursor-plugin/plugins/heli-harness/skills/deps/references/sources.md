# Sources — deps

## Dependencies as liabilities

- **Russ Cox, "Our Software Dependency Problem" (2019)** — the foundational essay: depending on code is outsourcing development to an unvetted supplier; the vetting checklist (design, quality, testing, maintenance, security, license, transitive deps) is the direct ancestor of this skill's five checks.
  https://research.swtch.com/deps
- **OpenSSF Scorecard** — automated maintenance/security health checks for open-source projects; deps.dev exposes scores and transitive graphs.
  https://securityscorecards.dev/ · https://deps.dev/

## Supply-chain incidents the rules are scar tissue from

- **left-pad (2016)** — an 11-line package unpublished, breaking builds across the npm ecosystem; the origin of "write the 30 lines" for trivial slices.
- **event-stream (2018)** — a burned-out maintainer handed a popular package to a stranger who shipped a credential stealer in a *transitive* dep — the case for reading lockfile diffs and weighing bus factor.
- **Log4Shell (2021)** — reachability mattered enormously (many "affected" systems weren't exploitable); the basis for confirm-exposure-first on advisories, in both directions.

## Upgrade discipline

- **Semantic Versioning + Hyrum's Law** (shared with release) — majors signal intent to break, but minors can break you anyway via observed behavior; hence "green build ≠ safe upgrade."
- **Google, *Software Engineering at Google* (2020), ch. 21 "Dependency Management"** — "dependency management is one of the hardest problems in software engineering"; the live-at-head argument is the industrial-strength version of "don't hold majors forever."

## Honest notes

- The "~50 lines, write it yourself" threshold is a heuristic, not a measured constant; the durable point is that the decision should weigh the full liability surface against the used slice, not default to install.
- One-bump-per-commit conflicts with monorepo live-at-head practice at Google scale; for this pack's repo sizes, bisectability wins.
