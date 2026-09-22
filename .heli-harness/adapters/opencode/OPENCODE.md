# OpenCode Adapter

## Heli-Harness identity

Heli v0.10.3 uses canonical governance semantics shared by CLI/machine/hooks/explain. In linked mode, project identity/config is under `.heli/` and live authority is execution-local; `.heli-harness/HARNESS.md` is authoritative only for the embedded compatibility protocol. This adapter translates those semantics into host-facing startup behavior.

## Read first

1. Start from the linked project root; for embedded compatibility, start from the workspace root.
2. Run `heli status` (and `heli doctor` when needed) to resolve linked vs embedded layout and current target/authority context.
3. In linked mode, use `.heli/` plus CLI/explain surfaces; do not treat embedded `.heli-harness/workspace/*` or shared `current-task.md` as current authority.
4. Identify the target resource/repo before editing.
5. Read the matching project profile from `.heli/profiles/` when linked, or `.heli-harness/profiles/` when embedded.
6. Read repo-local `AGENTS.md`, `CLAUDE.md`, `README*`, package/build/test files, and relevant docs.
7. Use a durable task/work record when work spans sessions, needs handoff/coordination, or carries significant verification/diagnosis obligations; ordinary reversible linked work does not require a task.
8. Load only relevant project/Heli skills.

## Enforcement self-check

OpenCode enforcement uses a local JS/TS plugin (`tool.execute.before`), not Claude-style SessionStart injection. Confirm the Heli plugin is loaded from `.opencode/plugins/` or `opencode.json` before treating guardrails as live. If the plugin is absent, every rule in this file is advisory only — say so explicitly before S2/S3 work.

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

- This OpenCode adapter is instruction + local plugin based.
- OpenCode plugins are JS/TS modules (`tool.execute.before` throws to block); they are not Claude-style stdin command hooks.
- Auto-discovery requires the plugin tree in `.opencode/plugins/` with a `.js`/`.ts` entry file (`heli-harness.js`); OpenCode does not auto-discover `.mjs`, and a single-file copy breaks the plugin's `./shared/hook-core.mjs` import. Explicit `opencode.json` registration is the fallback for other layouts.
- Live denial proof ships as `scripts/live-verify-opencode-plugin.mjs` (maintainer-only; real `opencode run` turn).
- Session context injection uses `experimental.session.compacting` when available; it is not a full SessionStart equivalent.

OpenCode-specific behavior belongs here. Core harness files must remain tool-neutral.
