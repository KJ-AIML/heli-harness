# Approved runs

Status: implemented (Claude Code keep-going; every host for the run grant).

## Problem

An agent working a plan unattended stopped for every approval Heli asked of the user. A push needed `heli grant issue` at the user's terminal each time, or a grant that also allowed `main`, or YOLO, which turned every other block off. And the agent ended its turn whenever it wanted to ask something, so the rest of the work waited for the user too.

## Decision

The user approves a plan once. Heli does not read or run the plan's steps (it is not a planner, ADR 0001): it reads a small `heli-run` block, binds the approval to the exact plan text, and answers the agent's tool calls accordingly.

- `heli run approve <plan>`: an interactive terminal only, and on the hooks' human-only command list. It shows what the run allows and what stays blocked, asks, and records the run in Heli's data directory (`<data>/runs/workspaces/<key>/<run-id>.json`, which agents cannot write).
- With `push: yes`, a `git.push` grant with a `git-push` constraint: it covers a remote git write only when every push lands, unforced, on the plan's branch of the plan's remote, and only while the plan's sha256 is unchanged. `main`, `master` and the remote's default branch are refused at approval. Tags, `--all`, deletions, other refs, `gh pr merge` and subtree pushes are never covered.
- The run binds to the agent session most recently active near the plan. On Claude Code, a Stop hook keeps that session working until it runs `heli run done` or `heli run blocked "<what it needs>"`, at most 40 times per run.
- `done` and `stop` revoke the run's grants; `blocked` keeps them (the user may answer, then `heli run resume`); expiry ends everything.

## Unchanged

T6 hard denies, `.env` writes, publish/tag/deploy approvals, Heli's own state, the project's governance files, live write conflicts, and diagnosis gates apply inside a run exactly as outside it. Unconstrained grants behave as before.

## Not done

- Host-native approval (approving from the host's plan mode instead of a terminal).
- Keep-going for hosts other than Claude Code, which have no Stop hook wired.
- Recording every allowed call of a run as a receipt, and a morning report beyond `heli run status`.
- Path scope (`write: src/**`) and budgets beyond the continuation cap.

## Rollback

Revert the commits; runs and their grants expire on their own (at most 24 hours), and `heli run stop` ends one at once.
