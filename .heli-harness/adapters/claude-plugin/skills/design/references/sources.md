# Sources — design

## Design docs

- **"Design Docs at Google" (Malte Ubl, industrialempathy.com, 2020)** — the canonical public description of Google's design-doc culture: docs are short, written before implementation, centered on tradeoffs and alternatives, and their main value is the *review* they enable, not the documentation they leave behind.
  https://www.industrialempathy.com/posts/design-docs-at-google/
- **Google eng-practices** — the CL review guide assumes approach-level questions were settled before the CL; design review is the mechanism that settles them.
  https://google.github.io/eng-practices/

## ADRs

- **Michael Nygard, "Documenting Architecture Decisions" (2011)** — the original ADR post; the Context/Decision/Consequences format and the immutability + supersession rule come straight from it.
  https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions
- **adr.github.io** — the community home for ADR formats and tooling (adr-tools, MADR).
  https://adr.github.io/

## Why review the design, not just the diff

- **Boehm's cost-of-change curve** (*Software Engineering Economics*, 1981) — defects cost more the later they're found. The exact multipliers are contested in modern contexts; the durable point is the *ordering*: an approach objection at design time costs a page rewrite, the same objection at PR time costs the implementation.
- **Sunk-cost dynamics in review** — by PR time reviewers polish the chosen approach rather than question it; moving approach review earlier is the only structural fix. This is the same author-framing bias the harness's audit cites (reviewers rate identical work differently given the author's framing).

## Honest notes

- The "one page target, three page ceiling" is a deliberate tightening of Google practice (where docs are often longer) to fit solo/agentic work — the failure mode being guarded is docs nobody reads, not docs that are too short.
- Boehm's 10x-100x numbers should not be quoted as settled fact; see Laurent Bossavit, *The Leprechauns of Software Engineering*, on their provenance. The skill relies only on "earlier is cheaper", which survives the critique.
