# `gh` CLI patterns — gh-write

Copy-pasteable `gh` invocations for posting drafted text. All bodies use HEREDOC because flag-as-string corrupts newlines and quotes.

## Open a PR (HQ Desktop profile)

```bash
gh pr create \
  --title "Fix StreamCompleted session-mixing race" \
  --assignee @me \
  --reviewer amagdum-iron \
  --body "$(cat <<'EOF'
## Why
StreamCompleted from a previous session could credit cost to the new session
when the user switched mid-stream. Reported by @user in #142.

## Approach
- Tag each `StreamCompleted` event with the originating session ID
- Drop the event in the receiver if the session ID doesn't match
- Pinned by `StreamingStateViewModel_DroppedWhenSessionChanges`

Closes #142.
EOF
)"
```

## Open a PR (generic profile)

```bash
gh pr create \
  --title "<short, imperative, describes the change>" \
  --assignee @me \
  --body "$(cat <<'EOF'
<body>
EOF
)"
```

If the repo has `.github/PULL_REQUEST_TEMPLATE.md`, `gh pr create` will pre-fill from it when `--body` is omitted; in that case, edit the resulting buffer instead of passing `--body`.

## Comment on a PR

```bash
gh pr comment 311 --body "$(cat <<'EOF'
<body>
EOF
)"
```

## Comment on an issue

```bash
gh issue comment 142 --body "$(cat <<'EOF'
<body>
EOF
)"
```

## Post an evidence comment (console logs / raw output)

When the body contains console output, stack traces, or a test log, **do not use HEREDOC** — `<<'EOF'` breaks if the output happens to contain a line that collides with the delimiter, and shell-escaping raw logs is fragile. Write the comment to a temp file and post with `--body-file`:

````bash
# Build the body once (drafted in chat first), write it to a temp file
cat > /tmp/audit-820.md <<'BODY'
## Independent audit

**PASS.**
... prose ...

<details>
<summary>Console output</summary>

```text
<paste the curated log here — safe, it's a file, not a shell string>
```
</details>
BODY

gh pr comment 820 --body-file /tmp/audit-820.md
gh issue comment 811 --body-file /tmp/audit-820.md   # same flag for issues
````

`--body-file -` reads from stdin if you'd rather pipe. The point: the raw log lives in a file, so nothing in it has to survive shell quoting.

## Reply to a specific PR review thread (per-thread)

PR threads use the *comments* endpoint, not the top-level `gh pr comment`. Use `gh api`:

```bash
# Reply to a specific review comment by its comment ID
gh api -X POST repos/:owner/:repo/pulls/311/comments \
  -f body="Fixed in abc1234. <one-line>." \
  -f in_reply_to=<comment_id>
```

Get the comment IDs first:

```bash
gh api repos/:owner/:repo/pulls/311/comments --jq '.[] | {id, path, line, body: .body[0:80]}'
```

## Open an issue

```bash
gh issue create \
  --title "..." \
  --assignee @me \
  --body "$(cat <<'EOF'
<body>
EOF
)"
```

## Open an issue with labels and a milestone

```bash
gh issue create \
  --title "..." \
  --assignee @me \
  --label "bug,p2" \
  --milestone "2026-Q2" \
  --body "$(cat <<'EOF'
<body>
EOF
)"
```

## Convert a draft PR to ready-for-review

```bash
gh pr ready <PR number>
```

## Common follow-ups after posting

```bash
gh pr view <N>                 # confirm the body rendered correctly
gh pr view <N> --json url      # grab the URL
gh pr checks <N>               # CI status
gh pr comments <N>             # see review comments after a review pass
```

## Honest notes

- `gh` requires `gh auth login` to be done once per machine. If a command returns "not authenticated", surface that instead of retrying.
- `gh pr create --reviewer <user>` silently no-ops if the user isn't a collaborator on the repo. Don't assume success.
- Multi-line bodies passed via `-f body=` in `gh api` work but escape awkwardly — prefer `-F body=@file.md` if writing more than a few lines via the API.
