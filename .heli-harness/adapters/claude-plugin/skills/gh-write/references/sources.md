# Sources — gh-write

## Github-flavored markdown

- **GitHub Docs, "Basic writing and formatting syntax"** — task lists, fenced code, details/summary, tables, autolinking.
  https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax
- **GitHub Docs, "Linking a pull request to an issue"** — `Closes #N` / `Fixes #N` / `Resolves #N` keywords that auto-close the linked issue on merge.
  https://docs.github.com/en/issues/tracking-your-work-with-issues/linking-a-pull-request-to-an-issue

## PR and commit conventions

- **Google Engineering Practices, "How to write a CL description"** — first line ≤50 chars imperative; body answers *why*. The single most-distilled CL-writing guide.
  https://google.github.io/eng-practices/review/developer/cl-descriptions.html
- **Chris Beams, "How to Write a Git Commit Message"** — 7 rules, widely adopted. Subject in imperative mood, body wraps at 72, separate subject from body with a blank line.
  https://cbea.ms/git-commit/
- **Conventional Commits 1.0.0** — `type(scope): summary` style. Optional in this user's house style but worth knowing for OSS contributions.
  https://www.conventionalcommits.org/en/v1.0.0/

## Issue / bug-report writing

- **Mozilla, "Bug writing guidelines"** — repro steps + expected vs actual is the load-bearing structure for every bug report.
  https://bugzilla.mozilla.org/page.cgi?id=bug-writing.html
- **Simon Tatham, "How to Report Bugs Effectively"** — the canonical essay on writing reports developers can act on.
  https://www.chiark.greenend.org.uk/~sgtatham/bugs.html

## Code review comment style

- **Google Engineering Practices, "How to write code review comments"** — courtesy, specificity, suggestion-vs-blocker labeling.
  https://google.github.io/eng-practices/review/reviewer/comments.html
- **Conventional Comments** — `nitpick:` / `suggestion:` / `issue:` / `praise:` / `question:` prefixes that disambiguate intent. (Site spells it `nitpick:` not `nit:` — common cosmetic mismatch.)
  https://conventionalcomments.org/

## House-style anchors

- User memory `feedback_pr_template.md` — HQ Desktop uses Why/Approach sections, assign self, request `@amagdum-iron`
- User memory `feedback_no_coauthor.md` — no `Co-Authored-By` or "Claude" mentions
- User memory `feedback_pr_comment_tone.md` — Slack to a teammate, not changelog; draft non-trivial comments in chat first
- User memory `feedback_writing_style_humanizer.md` — strip AI-slop, vary rhythm, use "I"

## `gh` CLI

- **GitHub CLI manual** — `gh pr create`, `gh issue create`, `gh pr comment`, `gh issue comment`. HEREDOC for multiline bodies is the only reliable way; flag-as-string corrupts newlines and quotes.
  https://cli.github.com/manual/

## Honest notes

- "Slack-tone, not changelog-tone" is a house preference, not a published norm. It tracks the way the user actually writes and is reinforced by their memory file `feedback_pr_comment_tone.md`. Other repos may want a more formal voice.
- The Conventional Comments standard is light-adoption but valuable as a shared vocabulary even if the team doesn't use the strict prefixes.
