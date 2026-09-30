# Heli-Harness Phase 2 — Defense in Depth Implementation Plan

> **For agentic workers:** this is a task-level plan. Before executing a task, expand it into bite-sized TDD steps against the then-current code with superpowers:writing-plans, then execute with superpowers:subagent-driven-development (or superpowers:executing-plans). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop relying on hooks alone: back every host with its native deny rules and managed settings, require sandboxing for relaxed modes, tighten policy after untrusted input, add enforced adapters for the hosts that now have blocking hooks, and add a kill switch.

**Architecture:** Heli keeps one policy source (the kernel's built-in floor plus trusted user/project policy) and projects it into each host's native controls at install time, alongside the PreToolUse hook. Session state gains a "tainted" flag fed by post-tool hooks. New hosts get thin adapters over `evaluatePreToolUse`, exactly like the Phase 1 parity-tested wrappers.

**Tech Stack:** Node.js ≥20 ES modules, zero npm dependencies, `node:test`, host CLIs/configs (Claude Code, Codex, Gemini CLI, Cursor, Copilot CLI, Devin Desktop, Cline, OpenCode, Kimi).

**Spec:** `docs/reports/2026-09-30-heli-full-review.md` (Improvement plan → Phase 2; Research section) and the per-host enforcement research summarized there.

**Prerequisite:** Phase 1 merged (one evaluator, parity suite, truthful host status, `node --test`).

## Global Constraints

- Everything from Phase 1's Global Constraints.
- Native rules written into host configs are merged idempotently, owned and removable by `heli host remove`, and never clobber unrelated user settings; tests use `scripts/lib/hermetic-env.mjs`.
- A native rule is a backstop, never the only enforcement: the hook stays, because text rules miss forms like `git -C . push`.
- New adapters start at "documented" in `docs/ADAPTER_SUPPORT_MATRIX.md` and move up only with recorded evidence (synthetic smoke → live-verify run).

## Review Focus

1. Installing native rules must not break a user's existing permissions/hooks (merge, not overwrite) and removal must restore the pre-install state.
2. A host whose hook fails (crash, timeout) must still be stopped by its native rule for the pinned high-risk actions (`git push`, `.env` writes, recursive force deletes).
3. Tainted-session escalation must not block ordinary edits after reading docs — only network egress and state-changing actions escalate.
4. The kill switch must be human-only and fail closed if its flag file is unreadable.
5. Each new adapter must deny with the host's own blocking contract (exit code / JSON field) — verified against the host's documented schema.

---

### Task 1: Native deny rules alongside hooks

**Files:** `lib/cli/host.mjs`, new `lib/cli/native-rules.mjs`, host adapter folders, tests.

- [ ] Derive a small native rule set from the built-in floor: `git push` (T5), recursive force deletes (T6), `.env` writes, writes to Heli state.
- [ ] Claude: merge `permissions.deny` (`Bash(git push *)`, `PowerShell(git push *)`, `Edit(**/.env*)`, …) into user settings on `heli host install claude`; remove on `heli host remove claude`.
- [ ] Codex: forbidden `prefix_rule` entries; Gemini CLI: policy TOML; Cursor/OpenCode/Kimi: their deny lists; Copilot: `--deny-tool` guidance.
- Acceptance: install→remove round-trips leave host configs byte-identical; with the hook disabled, the native rule still blocks the pinned actions (synthetic host fixtures).

### Task 2: Managed tier for teams

**Files:** new `docs/managed-deployment.md`, templates under `.heli-harness/templates/managed/`.

- [ ] Claude managed settings template: force-enable the Heli plugin, `allowManagedHooksOnly`, `disableBypassPermissionsMode`.
- [ ] Codex `requirements.toml` managed hooks; Cursor MDM `hooks.json`; Copilot `policy.d`; Gemini admin policy tier.
- [ ] `heli doctor` reports whether a managed tier is active per host.
- Acceptance: templates validate against each host's documented schema (`claude plugin validate`-style checks where available).

### Task 3: Sandbox evidence and requirements

**Files:** `lib/cli/doctor.mjs`, `concurrency/attestation.mjs`, `concurrency/yolo-scope.mjs`, docs.

- [ ] `heli doctor` checks the host sandbox (Claude sandbox settings — not available on native Windows; Codex sandbox mode) and records it as capability evidence.
- [ ] YOLO requires a sandboxed session unless a human overrides with an explicit, time-boxed flag.
- Acceptance: YOLO refused in an unsandboxed session with a clear reason; allowed when sandbox evidence is present.

### Task 4: Stricter mode after untrusted input ("Rule of Two")

**Files:** host hook configs (PostToolUse), `hook-core.mjs`, `concurrency/session.mjs`, `command-policy.mjs`.

- [ ] PostToolUse hooks mark the session tainted after WebFetch, MCP fetch/read of remote content, or issue/PR content.
- [ ] While tainted, network egress (curl/wget/Invoke-WebRequest, git push, package publish) and state-changing actions escalate to T5 approval; a human clears the taint.
- Acceptance: a tainted session needs a grant for `curl -X POST …` and `git push`; ordinary edits stay allowed.

### Task 5: Enforced adapters for hosts with blocking hooks

**Files:** new `.heli-harness/adapters/{cursor,copilot,gemini,devin,cline}-*` folders, `lib/cli/host.mjs`, support matrix, smokes + live-verify scripts.

- [ ] Cursor: ship `hooks/hooks.json` in the Cursor plugin (`preToolUse`, `beforeShellExecution`, `beforeMCPExecution`) with `failClosed: true`; strip the Windows UTF-8 BOM; take `cwd` from the payload.
- [ ] Copilot CLI: Claude-format `PreToolUse`, also emit a top-level `permissionDecision`.
- [ ] Gemini CLI: `BeforeTool` hook via an extension; exit 2 / `decision: "deny"`.
- [ ] Devin Desktop (ex-Windsurf): Claude-style `PreToolUse` adapter.
- [ ] Cline: one script per event, `{"cancel": true}` semantics, `.ps1` wrapper on Windows.
- [ ] Codex: widen the matcher to MCP tools and `spawn_agent`; never emit `ask`.
- Acceptance: each adapter passes the Phase 1 parity suite through its wrapper; support-matrix rows updated with evidence level.

### Task 6: Kill switch

**Files:** `bin/heli.mjs`, new `lib/cli/halt.mjs`, `hook-core.mjs`, built-in privileged-command rule.

- [ ] `heli halt` / `heli resume` (human-terminal only, agent-run forms hard-denied) toggle a flag checked first in `evaluatePreToolUse`; while halted every mutating tool call is denied on every host.
- [ ] Unreadable/corrupt flag file → treat as halted (fail closed).
- Acceptance: parity suite under halt denies every mutating payload on every wrapper.

### Task 7: Policy interop

**Files:** new `lib/cli/policy-export.mjs`, docs.

- [ ] `heli policy export --format rego|cedar` emitting the effective command rules and protected paths.
- [ ] Decide import scope after export is in use (record the decision in an ADR).
- Acceptance: exported Rego/Cedar evaluates the rule self-test examples from Phase 1 Task 2 with the same verdicts.
