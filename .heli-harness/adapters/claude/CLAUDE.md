# Claude Code Adapter

## Heli-Harness identity

Heli-Harness is the workspace governance source of truth. Claude Code must treat `.heli-harness/HARNESS.md` as authoritative for harness protocol, and this file only translates that protocol into Claude-facing startup behavior.

## Read first

1. Start from the parent workspace.
2. Read `.heli-harness/HARNESS.md`.
3. Read `.heli-harness/workspace/target.json` and `.heli-harness/workspace/index.json` when present.
4. Identify the target repo before editing.
5. Read the matching `.heli-harness/profiles/<repo>.md` if it exists.
6. Read repo-local `CLAUDE.md`, `AGENTS.md`, `README*`, package/build/test files, and relevant docs.
7. For non-trivial edits, update `.heli-harness/state/current-task.md`.
8. Load only relevant skill docs from `.heli-harness/skills/`.

## Enforcement self-check

Before treating any guardrail here as enforced rather than advisory, check whether the native plugin's `SessionStart` hook actually ran this session: look for injected context starting with "Heli-Harness plugin context:" at the start of the conversation. If it is absent, the plugin is not registered or loaded — `git push`/`.env`-write/task-state-gate denials will not fire, and every rule in this file is advisory only. Say so explicitly to the user before doing S2/S3 work, and rely on discipline rather than enforcement until the plugin is properly installed.

## Target repo discipline

- Do not modify unrelated repos.
- Do not hide dirty files; report them before working with them.
- Do not change roadmap or release scope beyond the requested task.
- In multi-repo workspaces, keep writes under the selected target root unless the user explicitly changes the target.

## Write boundaries

- Never use `git add .`.
- Do not revert or overwrite user changes unless explicitly requested.
- Do not modify adapter manifests except for evidence-backed version/status/changelog work.
- Do not publish, tag, push, or release without passing validation and explicit approval.

## Safety rules

- Load `.heli-harness/safety/command-tiers.md` and `.heli-harness/safety/command-rules.json` when present.
- Treat destructive commands, release commands, remote writes, secret reads/writes, and out-of-target writes as approval-gated or blocked according to safety policy.
- Instruction files are not a sandbox. Use host permissions and hooks when available.

## Command tiers

Use the harness command tiers:

- `T0`/`T1`: read-only inspection and non-mutating validation.
- `T2`: local target-repo edits after context is loaded.
- `T3`/`T4`: dependency, runtime, network, API, or cost-bearing work; ask or report as policy requires.
- `T5`/`T6`: release, remote write, destructive, secret-bearing, or outside-root actions; require explicit approval or block.

## Claims require evidence

Do not claim support, enforcement, validation, test results, release status, or runtime behavior without file evidence or command output. If evidence is missing, say what is missing.

## Validation before completion

Run the smallest relevant check first, then the repo profile validation command when needed. Record every validation command actually run and any skipped checks.

## Final reports

Final reports should include summary, files changed, validation, remaining risks, version/release status when relevant, and final git status.

## Limitations

- This Claude Code adapter is instruction/config/pointer based.
- v0.5.10 verifies adapter files, settings JSON, installer-created `CLAUDE.md`, and update preservation of user-owned workspace `CLAUDE.md`.
- v0.5.11 live-verifies the native plugin: a real `claude -p` session loading it via `--plugin-dir` in an isolated sandbox denies `git push` and a `.env` write, confirmed via the session's own `permission_denials` result. This is `enforced`, not just synthetic plugin hook behavior, but it covers `--plugin-dir` loading, not the marketplace-installed-and-trusted flow (`claude plugin install`).
- Claude Code and Pi are the `enforced` adapters in the current release.

Claude-specific behavior belongs here. Core harness files must remain tool-neutral.
