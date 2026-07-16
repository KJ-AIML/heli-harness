# Sources — test-coverage

## Tests paired with the fix in the same CL

- **Google "How to do a code review", on tests** — "if the CL adds code that should be tested, the CL should also include tests. The author should add tests to the CL unless this is an emergency."
  https://google.github.io/eng-practices/review/reviewer/looking-for.html

(Note: this guidance lives in `looking-for.html`, not `standard.html`. The distinction matters if you go to cite it directly — pasting the wrong URL is the most common subtle-citation error on this topic.)

## TDD: mixed empirical record

- **Hillel Wayne, blog survey of the empirical TDD literature** — surveys the studies on TDD vs test-after. Conclusion: the evidence is mixed, often confounded by experience and project type, and does not establish TDD as dominant. Wayne *surveys*; he does not synthesize a "test-first is taste" position. Cite him for the survey, not the synthesis. (The `tdd-empirical-results` slug at hillelwayne.com 404s as of this writing — locate via author + title or Wayback Machine.)
- **"Is TDD Dead?" — Fowler / Beck / DHH series (2014)** — Beck and Fowler agreed with DHH that practiced TDD had drifted into dogma, while still endorsing tests-paired-with-code as a discipline.
  https://martinfowler.com/articles/is-tdd-dead/

The honest practitioner framing: test-first is a matter of taste; comprehensive automated testing, including a regression test paired with every bug fix, is non-negotiable. This skill picks the second, lower-controversy practice and doesn't pretend the first is settled.

## Characterization tests

- **Michael Feathers, *Working Effectively with Legacy Code* (2004)** — origin of the term "characterization test" for tests that pin existing behavior before a refactor, whether or not that behavior is correct.

## One assertion per test / test honesty

- **Kent Beck, *Test-Driven Development: By Example* (2002)** — "one assertion per test" framing originates here as a guideline, not a hard rule. The skill softens to "one proposition per test" because a single proposition sometimes requires multiple related assertions.

## Flaky-test policy

- **Google Testing Blog, "Flaky Tests at Google and How We Mitigate Them" (2016)** — empirical data on flake impact: even small flake rates lead to engineers ignoring failures. Source for the skill's "no flakiness budgets" line.
  https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html

## Honest note on "regression test must fail on parent commit"

This discipline (verifying the test fails before the fix) is not a published norm — it's craft. The skill teaches it because a test that passes on both sides of a bug doesn't lock anything in, which is logically obvious but routinely violated.
