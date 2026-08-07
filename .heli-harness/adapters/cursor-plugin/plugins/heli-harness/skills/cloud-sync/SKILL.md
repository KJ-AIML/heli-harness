---
name: cloud-sync
description: Use when any heli auth/ws/push/pull/sync/init command is about to run, when sync state or auto-push output appears in a session, or when the user asks about syncing workspace context across devices.
---

# cloud-sync

Trigger: any `heli auth|ws|push|pull|sync|init` command, sync state (`state/sync.json`) or auto-push output in a session, or user questions about cross-device workspace context.

Scope:
- Cloud sync carries the portable workspace subset (profiles, policies, safety overlays, tasks, workspace index) between devices via the user's sync server. Machine-local state (`sessions/`, `locks/`, `bindings/`, YOLO, `state/sync.json`) and `repos/` never sync.
- Local-only is the default. No login + no linked workspace = nothing leaves the machine. `heli ws unlink` returns a linked workspace to local-only.
- `heli sync auto on` makes `heli task complete` auto-push (best-effort; failures warn, never block completion). `heli sync e2e on` + `HELI_E2E_PASSPHRASE` encrypts bundles client-side; the server stores ciphertext only.

Rules:
- Do not run auth/link/push/pull/sync/init unless the user explicitly requested that sync action. Push and sync upload workspace context — treat as T5 egress needing explicit approval, like `git push`.
- Do not hand-edit `state/sync.json` or `~/.heli/credentials.json`; they are CLI-owned control-plane state.
- Do not change `sync auto` / `sync e2e` settings on your own initiative, and never set or guess `HELI_E2E_PASSPHRASE` for the user.
- A secret-scan-blocked push is a finding to report, not an obstacle to bypass; `--allow-secrets` is the user's call only.
- On version conflict (409) or dirty-pull refusal, explain the divergence and let the user pick `pull`/`push`/`--force`; `--force` overwrites are recoverable via `heli ws versions` + `heli pull --version N`.
- Auto-push output after task completion is informational; a skipped push is not a task failure.
