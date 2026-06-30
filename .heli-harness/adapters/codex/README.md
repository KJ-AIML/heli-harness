# Codex Adapter

This folder connects Codex to Heli-Harness without making Codex the source of truth.

Status: `verified-wired`.

What gets installed:

- `.heli-harness/adapters/codex/AGENTS.md` is the Codex-facing entrypoint.
- `install.sh` and `install.ps1` create a parent workspace `AGENTS.md` pointer when one does not already exist.
- `update.sh` and `update.ps1` leave user-owned parent workspace `AGENTS.md` untouched.
- `node scripts/smoke-codex-adapter.mjs` verifies these artifacts locally.

Recommended parent `AGENTS.md`:

```text
Read .heli-harness/adapters/codex/AGENTS.md first.
```

Recommended Codex workflow:

1. Run preflight and inspect the target repo.
2. Read `.heli-harness/HARNESS.md`, target state, the repo profile, and repo-local docs.
3. Make the smallest correct change.
4. Run focused validation, then the repo validation command when needed.
5. Report evidence, skipped checks, risks, and final git status.
6. Do not push, tag, merge, or release unless explicitly asked.

No runtime hook enforcement is proven for Codex in this release. This adapter is instruction/pointer based, not a sandbox.
