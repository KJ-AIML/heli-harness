# Evidence Notes — where popular narrative outruns the data

These are claims you hear constantly in software-engineering culture that the empirical record doesn't support as confidently as the speakers do. Listed here so future-you doesn't repeat the lore.

## "Test-first / TDD is mandatory for professionals"

The strong version of this claim — that TDD is empirically superior to test-after-development — is **not supported by the studies as cleanly as practitioners imply**.

- **Hillel Wayne's survey of the empirical TDD literature** (blog post at hillelwayne.com; the original `tdd-empirical-results` slug 404s, so cite by author + title and use the Wayback Machine snapshot if a working URL is needed) — concludes the studies are mixed, often confounded by experience and project type, and do not establish TDD as dominant. Wayne *surveys* the evidence; he does not synthesize a single replacement position.
- **The Fowler / Beck / DHH "Is TDD Dead?" series (2014)** — Beck (TDD's author) and Fowler agreed with DHH that TDD as practiced had drifted into dogma, while still endorsing tests-paired-with-code as a discipline.
  https://martinfowler.com/articles/is-tdd-dead/

The honest framing for this skill family: **test-first is a matter of taste; comprehensive automated testing, including a regression test paired with every bug fix, is non-negotiable.** The latter is the load-bearing practice. Don't pretend the former is settled science.

## "Senior engineers read more code than they write"

Often cited as a ratio (10:1, 20:1) sourced to "research." The research it gets traced to is usually the Minelli et al. comprehension study, which measured *time spent on comprehension activities* across all developers, not a writing-vs-reading ratio for seniors specifically.

The Minelli finding (58-70% comprehension time) is real and well-replicated. The "seniors read 10x more than they write" framing is folklore that hangs off it. The skill cites the underlying study, not the folklore.

## "Code review catches X% of bugs"

Various percentages float around (Fagan 60%, IBM 80%, etc.) sourced to studies from the 70s-80s on formal inspection of paper code. They are real numbers from real studies, but the studies are on a *very specific* form of structured inspection that almost nobody runs anymore. Modern PR review is a different activity; the old numbers don't generalize cleanly.

If you need to argue for review on evidence, prefer DORA's correlation work or recent industry surveys, not Fagan's 1976 numbers.

## "Small commits / small PRs are universally better"

This one is *mostly* well-supported (DORA's batch-size finding is robust) but the strong "always" form ignores that some changes are coherent only at a larger granularity — large mechanical refactors, schema migrations bundled with their callers, etc. Google's own guidance is "100 lines is usually reasonable" — note the *usually*. The skill copies this hedging language deliberately.

## "Agents need explicit verification because LLMs hallucinate"

True, but the underlying reason isn't unique to LLMs — it's the author/reviewer separation principle from Google's review norms. The skill grounds the verification step in that older, broader principle rather than in LLM-specific worries, because the practice is correct independent of whether the implementer is human or a model.
