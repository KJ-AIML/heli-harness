# Templates — gh-write

Copy-and-customize templates for the most common GH-text shapes. Load on demand; don't dump these into context unless the skill is actively writing one.

## PR body — HQ Desktop profile (Why / Approach)

```markdown
## Why
StreamCompleted from a previous session could credit cost to the new session
when the user switched mid-stream. Reported by @user in #142.

## Approach
- Tag each `StreamCompleted` event with the originating session ID at emit
  time (`NativeChatService.cs:184`)
- Drop the event in the receiver if `event.SessionId != _currentSession.Id`
  (`StreamingStateViewModel.cs:96`)
- Pinned by `StreamingStateViewModel_DroppedWhenSessionChanges` — verified
  fails on parent commit

Closes #142.
```

## PR body — generic profile (no repo template)

```markdown
## Summary
<1-3 sentences. What changed and why, in concrete terms.>

## Changes
- <decision-level bullet, not a file enumeration>
- <decision-level bullet>

## Test plan
- [ ] <verification step>
- [ ] <verification step>

<Closes #N if applicable.>
```

## Issue body — bug report

```markdown
## What happened
<one-paragraph, present tense. What the user saw / what the system did.>

## Expected
<one sentence.>

## Repro
1. <step>
2. <step>
3. <step>

## Notes
<File:line of the suspect code if known. Log excerpts in fenced blocks.
Skip this section if there's nothing concrete.>
```

## Issue body — task / chore

```markdown
## Scope
<one paragraph. The unit of work, clearly bounded.>

## Acceptance
- [ ] <verifiable check>
- [ ] <verifiable check>

## Notes
<context, links, anything that matters>
```

## PR/issue comment — wrap-up after a wave of fixes

Slack-tone. Not a changelog.

```markdown
Closed out the wave — 4 commits, 76 new tests, all audited. Pinned the
StreamCompleted race (#142) and the autoscroll regression (#147).

One thing worth surfacing: `MessageListViewModel.LoadAsync` /
`LoadMoreAsync` don't guard against overlapping calls. Audit caught it,
out of scope to fix here. Filed as #168.

Two skipped tests are honest skips (OAuth callback, drag events) —
reasons in the `[Fact(Skip=...)]` strings.
```

## Verification evidence — audit / post-fix proof comment

The comment that posts *proof* a change works: an audit PASS/FAIL, a post-fix verification, a feature-ship check. The reader gets the verdict in prose and the raw output one click away.

**Curate, don't dump.** Command → result line inline; full console output collapsed in `<details>` only when it earns the weight. Bind every log to the command that produced it AND the commit SHA it ran against — a pasted log that doesn't match the diff is the exact failure mode `audit` exists to catch. Post evidence bodies with `--body-file` (see `references/gh-cli.md`); HEREDOC collides with stack traces.

````markdown
## Independent audit

**PASS.**

Scope: PR #820 head is `7f0c95a` on `fix/811-sse-heartbeat-timeout`; diff scoped to
SSE/queue/tests plus `PROGRESS.md`.

Behavior: `generation-stream.ts` sets 15m prompt + 5m margin and 15s heartbeat;
`queue.ts` persists a visible action-running log before awaiting sandbox work.

Tests rerun by auditor (against `7f0c95a`):

- `bun test apps/api/src/services/generation-stream.test.ts` — 5/5 pass
- `bun test apps/api/src/services/queue.test.ts` — 28/28 pass

<details>
<summary>Console output — <code>bun test … queue.test.ts</code></summary>

```text
$ bun test apps/api/src/services/queue.test.ts
✓ persists action-running log before sandbox await [12ms]
✓ keeps action log in final payload [8ms]
... (28 pass, 0 fail)
 28 pass
 0 fail
Ran 28 tests across 1 file. [1.2s]
```
</details>

No file:line defect found.
````

Optional code-snapshot block — drop in the test body or the key diff hunk when the proof is "this now exists / now passes":

````markdown
<details>
<summary>Regression test that pins this</summary>

```ts
test("drops StreamCompleted from a stale session", async () => {
  // fails on parent commit 6b2a1f0, passes on 7f0c95a
  ...
});
```
</details>
````

For a FAIL, keep the same shape: `**FAIL.**`, the file:line defect in prose, and the failing run's output in the `<details>` block so the fixer sees the actual error, not a paraphrase.

## Per-thread review reply — "fixed in <SHA>"

For when responding to individual review threads after a fix-loop wave. One reply per thread, not one summary for all.

```markdown
Fixed in <SHA>. <one-line description of the actual change, not a restatement of the comment>.
```

Or, if the thread asked a question and the answer is "no change, here's why":

```markdown
Looked at this — leaving as-is because <one-line reason>. Happy to revisit if you'd rather change it.
```

## Review comment — blocker

```markdown
**Blocker.** The new `LoadMore` path skips the cancel-token check on
line 142, so a session switch mid-load will still credit the old session.
Same shape as #142 — easy to repro by switching sessions while the
"Loading more..." indicator is up.

Fix is probably: add the same `if (token.IsCancellationRequested) return;`
guard you put in `LoadAsync` at line 96.
```

## Review comment — suggestion (non-blocking)

```markdown
Suggestion: pull the `_sessionId` setter into a single method so the
invariant lives in one place. Non-blocking — could be a follow-up.
```

## Review comment — nitpick

```markdown
Nitpick (non-blocking): `_sessionId` is set in two places now (`OnLoad` and
`OnSessionChanged`). Minor consistency thing — happy to leave for later.
```

## Review comment — question

```markdown
Question: is the new `token.IsCancellationRequested` check redundant with
the `try/finally` cleanup on line 88? Asking because I'm not sure if the
finally already covers the early-return case.
```
