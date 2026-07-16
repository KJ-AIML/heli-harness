# Sources — impact

## Chesterton's Fence

- **G.K. Chesterton, *The Thing* (1929)** — "don't remove a fence until you know why it was put up." The software form: don't change code that looks wrong until you know why it's the way it is. `git blame` + the linked commit/PR is the five-minute version of finding out.

## Change impact analysis

- **Bohner & Arnold, *Software Change Impact Analysis* (IEEE, 1996)** — the founding compilation: impact analysis as identifying the ripple effects of a proposed change *before* making it; the gap between the estimated and actual impact set is where regressions live.
- **Michael Feathers, *Working Effectively with Legacy Code* (2004)** — the *seam* concept (step 7: pick the narrowest place to change that covers all callers) and the practice of characterizing/baselining behavior before modifying it (step 6).

## Observable behavior is the contract

- **Hyrum's Law** — "with a sufficient number of users, all observable behaviors of your system will be depended on by somebody." Why step 3 classifies *observed behavior* (null vs empty, ordering, error shape), not just signatures, and why "it's internal" requires proof.
  https://www.hyrumslaw.com/

## Incomplete fixes (the siblings problem)

- **Park, Kim, et al., "An Empirical Study of Supplementary Bug Fixes" (MSR 2012)** — in large projects studied, roughly a fifth to a quarter of bugs required more than one fix attempt; a major cause was fixing one location while the same flaw lived in others. Step 4 exists because the data says first fixes are routinely incomplete.

## Honest notes

- The "five minutes of grep" calibration is for the harness's typical repo sizes; on very large codebases impact analysis is genuinely harder and tooling-dependent (LSP, code search), and the skill's escalation valve (growing map → S2 → design) is the honest answer rather than pretending grep scales forever.
- The supplementary-fix percentages vary by project and methodology across replications; the durable point — single-site fixes for multi-site flaws are a measured, common failure mode — survives the variance.
