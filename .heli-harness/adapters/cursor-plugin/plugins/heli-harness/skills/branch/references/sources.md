# Sources — branch

## Branch model

The user's conventions are not pure git-flow, not pure trunk-based — they're a hybrid. The relevant published models for context:

- **git-flow (Vincent Driessen, 2010)** — origin of the `develop` / `feature/*` / `main` separation. Heavyweight by modern standards, but the develop/main split is what the user keeps.
  https://nvie.com/posts/a-successful-git-branching-model/
- **GitHub Flow** — single-trunk model with short-lived branches. User does not use this directly but `feat/*-yo` lifespans are short, matching the spirit.
  https://docs.github.com/en/get-started/using-github/github-flow
- **Trunk-Based Development** — long-running branches discouraged. User has long-running `experimental/*` and one consolidated `experiment/automated-test-docs` branch, so this is *not* the user's model — included for contrast.
  https://trunkbaseddevelopment.com/

## Pre-PR readiness

- **Google "How to write a CL description"** — diff scope sanity, imperative-mood commit subjects, body-explains-why.
  https://google.github.io/eng-practices/review/developer/cl-descriptions.html
- **Chris Beams, "How to Write a Git Commit Message"** — the 7 rules; covers items 3 and 4 of the readiness checklist.
  https://cbea.ms/git-commit/

## User-memory anchors

The hard-coded rules in this skill come from:

- `project_experimental_branch_convention.md` — `experimental/*` reference-only
- `project_llm_tester_branch.md` — `experiment/automated-test-docs` exception
- `feedback_no_coauthor.md` — no Co-Authored-By / Claude mentions
- `feedback_pr_template.md` — PR template / reviewer convention (consumed by `gh-write`)

## Honest notes

- The "rebase, don't merge" preference on linear history is not explicitly in the user's memory — it's the modal preference for repos that use `develop` as integration. If the user's repo prefers merge commits, this skill should defer to repo convention. Currently encoded as rebase; revisit if the user corrects.
- The pre-PR checklist's "0 build errors / 0 test failures" is universal; the specific commands depend on the project and live in the project's CLAUDE.md, not here.
