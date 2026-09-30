# Heli-Harness full review — 2026-09-30 (v0.10.3 + PR #29)

**Status:** point-in-time review snapshot (historical record). Current architecture lives in [docs/architecture/README.md](../architecture/README.md).
**Method:** five parallel reviewers — three code reviewers (enforcement kernel; CLI, host adapters and cloud; tests, architecture and docs) running experiments in temp workspaces, and two web researchers (governance landscape and standards; per-host enforcement surfaces). Critical findings were confirmed by experiment; the self-approval gap, rule ordering, cloud login flow and npm state were re-checked independently.
**Follow-up:** [Phase 0 hardening plan](../superpowers/plans/2026-09-30-heli-phase-0-hardening.md).

## Overall: 4/10 at review time (the idea itself: 8/10)

Heli fills a real gap, and its docs are unusually honest. But at review time the agent it governs could switch it off, and hooks let the tool call through when anything went wrong, so it could not yet be relied on as a guardrail. Most of the top problems are small, contained fixes; Phases 0–1 below should bring it to about 7/10.

| Area | Score | Why |
| --- | --- | --- |
| Idea & positioning | **8** | No other tool reviewed combines one writer per worktree across hosts, proof of what each host enforces, and scoped approvals |
| Enforcement & bypass resistance | **2** | The agent can approve itself, hooks fail open, and hard-deny rules are easy to bypass |
| Write authority (leases) | **4** | Linked mode held up in race tests; embedded mode lets two writers in; delegation is ignored |
| Host integrations & status | **4** | Status trusts Heli's own receipts instead of asking the host; Pi runs a separate, drifted guard |
| Cloud sync security | **3** | A login can be hijacked with one click, and pulled rules are trusted |
| Tests & CI | **5** | 65 real-behavior tests on Ubuntu and Windows, but they touch the real machine and branch coverage is 57% |
| Release & distribution | **4** | npm `latest` is still 0.8.3 |
| Architecture & simplicity | **4** | Thin wrappers over one kernel, but about half the repo is copies and there's a lot of surface area |
| Docs & onboarding | **5** | Honest and current, but full of jargon, and some claims run ahead of the evidence |

## Top findings

**Critical**
1. **The agent can approve itself.** `heli grant issue …` and `heli yolo on` pass the hook: no rule covers them, and `lib/cli/grant.mjs` never checks that a human is issuing the grant. In the reviewer's test, an observe-only session issued a grant and the next two `git push` calls were allowed.
2. **Heli's own state files are writable by the agent.** The task-state exemption (`hook-core.mjs:286-298`, `resolve.mjs:605-620`) let a read-only session write `tasks/*/yolo.json`. That turned on YOLO, after which `git push` and `.env` writes were allowed. Paths containing `..` also skip the ownership check.
3. **Hooks fail open.** Most hosts run the tool if the hook exits with any error.
   - `claude-style-pre-tool-use.mjs:32` parses its input without a try/catch.
   - Lines 42–46 write audit files *before* line 47 prints the deny.
   - A Windows file lock (EPERM), a bad `.heli/workspace.json`, or a missing `node` each let the tool run. In one test, 3 of 48 parallel hooks crashed.
4. **Cloud sync can switch off governance remotely.**
   - The OAuth `state` is just the device's user code (`cloud/core.mjs:159`), so a crafted `/activate` link can hijack someone's account with one click.
   - Pulls accept plaintext bundles (`cloud-bundle.mjs:154`) and restore `safety/` and `policies/`.
   - So an attacker can push empty rules and a YOLO task that the victim's next pull applies.
5. **Claude on Windows: shell commands aren't governed.** `Bash|Edit|Write` is an exact list of tool names. PowerShell (Windows' default shell), NotebookEdit, Monitor and MCP tools never reach Heli, and on a machine without Git Bash there's no Bash tool at all.

**High**

6. **Hard-deny (T6) rules are weak.**
   - The rule loop stops at the first match (`hook-core.mjs:639-657`), so a T5 rule that has a grant hides a T6 rule in the same command.
   - Setting `HELI_ALLOW_COMMAND` switches a T6 rule off (`:644`).
   - `rm -fr`, `rm -r -f`, `git clean -fdx`, `rd /s /q`, `Remove-Item -Recurse -Force` and `git -C . push` all get through.
   - A missing or broken rules file disables every T5/T6 rule.
7. **Hooks get slower until they time out.** `resolve.mjs:140` reads every session file on every call, and old sessions are never deleted. At 2,000 sessions a check takes 8.7 s against a 5 s timeout, so the hook times out and the tool runs.
8. **Write-access holes.**
   - Embedded mode: both processes got the lease in 29 of 30 races.
   - Linked mode ignores session mode and delegation (`resolve.mjs:298-318`).
   - Lock folders left by a crash are never cleaned up.
   - The "atomic" file write isn't atomic on Windows.
9. **Pi uses a separate guard that has drifted.** It checks YOLO *before* hard-deny (`pi-extension.js:1619`), the user can click through a T6, and there are no grants.
10. **`heli host status` can be wrong.** On the review machine it reported Grok at 0.10.3 while Grok actually ran a v0.5.24 plugin from an old project copy. `heli host remove pi` always fails, and the Codex plugin source isn't pinned to a version.
11. **The test suite changes the real machine.** `smoke-integration-migration.mjs:116` calls `removeHost(grok)`, and `step()` (`host.mjs:245`) doesn't pass the test's fake environment, so `npm run check` on a machine with Grok installed runs the real `grok plugin uninstall heli-harness`.
12. **npm `latest` is 0.8.3** (verified). `release.yml` treats a missing `NPM_TOKEN` as success, so 0.10.x was never published.
13. **Windows: a folder name can run commands.** `shell:true` plus weak quoting means a folder named `x&calc&` launches calc. An `'` in a path also corrupts the Kimi config file.
14. **Decision records aren't tamper-evident.** Only denials are recorded, in plain JSON that any session can edit.
15. **Follow-up to PR #29:** the embedded and global setups both name the Claude plugin source `heli-harness`. Because "already exists" counts as success, a global install could quietly bind to one project's copy.

## Strengths
- **A real niche.** Orchestrators like Conductor, Claude Squad, Orca and Vibe Kanban isolate agents but don't decide who may write. A 2026 preprint found that gating writes raised integration success from 65.6% to 96.7% ([arXiv 2608.00947](https://arxiv.org/abs/2608.00947)).
- **Linked-mode write access is solid.** Zero double acquisitions in 30 races, taking over a stale lease requires `--confirm`, T6 is checked before YOLO, and malformed leases deny.
- **Honest docs.** They say plainly that Heli isn't a sandbox and that installing a hook isn't proof it runs, and historical docs are labeled as such.
- **Clean foundations:**
  - zero dependencies;
  - thin host wrappers over one kernel (except Pi);
  - CI on Ubuntu and Windows;
  - cloud basics done right: tenant isolation, hashed tokens, AES-256-GCM.

## Research
- **Direct competitors have appeared:**
  - [Microsoft Agent Governance Toolkit](https://github.com/microsoft/agent-governance-toolkit) (MIT, April 2026) supports OPA and Cedar policies and has a Merkle audit log and a kill switch. It covers Claude Code, Codex and Copilot, and since v4 also OpenCode and Antigravity.
  - [agentjail](https://github.com/LuD1161/agentjail) defines fail-open, degraded and fail-closed modes, protects itself from the agent, and adds an OS sandbox.
  - [Cupcake](https://github.com/eqtylab/cupcake) is a Rego-based hook policy engine.
- **Hosts have caught up.** Blocking pre-tool hooks now exist in [Cursor](https://cursor.com/docs/hooks) (with a `failClosed` option), Copilot CLI, Gemini CLI, Devin Desktop (formerly Windsurf) and Cline. Most of them fail open by default and offer managed admin tiers ([Claude hooks](https://code.claude.com/docs/en/hooks)).
- **Standards.** Checked against [OWASP Agentic Top 10 (2026)](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/), OWASP's Excessive Agency risk (LLM06), MITRE ATLAS and CoSAI:
  - Heli covers approval for high-impact actions (partly) and conflicts between agents.
  - It's missing tamper evidence, isolation, a kill switch, and stricter rules after the agent reads untrusted input ([Rule of Two](https://ai.meta.com/blog/practical-ai-agent-security/)).
- **Deny-lists alone don't hold.** A 2026 survey cites 69–98% failure rates for real command deny-lists ([arXiv 2607.05743](https://arxiv.org/abs/2607.05743)). The lesson: parse commands properly, fail closed, and pair with an OS sandbox.

## Improvement plan

**Phase 0: security hotfix, v0.10.4 → ~6/10**
1. **Fail closed.** Catch errors and deny, print the decision before any writes, retry on Windows file locks, and deny when `node` is missing.
2. **Protect Heli from the agent.** Built-in rules that can't be removed deny agent-run `heli grant`, `heli yolo` and takeover commands. They also deny writes to `.heli-harness/` state, `~/.heli/` and host hook configs. Only a human can issue grants or turn on YOLO.
3. **Evaluate every rule.** Any T6 match wins; one grant per T5 rule, used up only when the call is finally allowed; `HELI_ALLOW_COMMAND` can no longer override T6; a missing or broken rules file means deny; add the delete-command variants listed above.
4. **Claude coverage.** Match `PowerShell`, `Monitor`, `NotebookEdit` and MCP tools as well as `Bash|Edit|Write`, and teach the kernel PowerShell's write commands.
5. **Cloud.** Require encrypted bundles, reject older versions, ask before applying safety or policy changes, fix the OAuth `state`, and use `git clone --`. Mark cloud sync experimental.
6. **Make tests hermetic.** Pass the environment through `run()`/`step()`, use fake host CLIs, and never touch the real home folder.
7. **Publish 0.10.x to npm** (or deprecate 0.8.x), and fail the release when `NPM_TOKEN` is missing.

**Phase 1: trustworthy core, v0.11 → ~7/10**
- **One evaluator for every host.** Pi should call `evaluatePreToolUse`, and a test should check that the same input gets the same decision through every wrapper.
- **Parse commands properly.** Handle `sh -c`, `pwsh -Command`, `cmd /c`, command chains, `git -C`/`-c` and aliases, and ask when a command is too opaque to judge. Give each rule example commands it must and mustn't match.
- **Fix write access.** Embedded mode: lock per worktree. Linked mode: check session mode and delegation. Recover stale locks using process id and age. Index sessions by host id and prune old ones.
- **Evidence.** Record allows as well as denials, hash-chain the records, and export them to OpenTelemetry.
- **Truthful status.** Read state from `<host> plugin list --json`, pin Codex to a version and show whether its hooks are trusted, fix Kimi escaping and `pi remove`, and give the embedded Claude plugin source a distinct name.
- **Tests.** Move to `node --test` with a coverage floor on the write-access modules, and save live-verify results.

**Phase 2: defense in depth, v0.12 → 1.0 → 8+/10**
- **Native deny rules alongside the hooks:** Claude `permissions.deny`, Codex `prefix_rule`, the Gemini policy file, and Cursor, OpenCode and Kimi deny rules.
- **Managed tier for teams:** Claude `allowManagedHooksOnly`, Codex `requirements.toml`, Cursor MDM and Copilot `policy.d`.
- **Sandbox checks.** `heli doctor` checks the host's sandbox, and YOLO requires one. Claude's sandbox doesn't run on native Windows.
- **Stricter mode after untrusted input.** Once a session has read web, MCP or issue content, raise network and state-changing actions to T5.
- **New enforced adapters:** Cursor, Copilot CLI, Gemini CLI, Devin and Cline.
- **Kill switch:** a `heli halt` command that makes every host deny.
- **Policy interop:** import and export Rego or Cedar.

**Phase 3: simplify (ongoing)**
- Build plugin bundles at pack time instead of committing about 410 copies.
- Move cloud sync, the ACP proxy, benchmarks and learning out of the core, or label them experimental.
- Cut 30 skills to about 12.
- Add a "what gets blocked" demo to the README.
- Keep one source for the version number.
- Fill the support matrix only from recorded runs.
