# Codex Install

Use the workspace installer from the repo checkout:

```powershell
.\install.ps1 -Parent "C:\your\workspace"
```

or:

```bash
./install.sh /path/to/workspace
```

The installer creates `AGENTS.md` in the parent workspace only when that file does not already exist:

```text
Read .heli-harness/adapters/codex/AGENTS.md first.
```

Updates do not modify the parent workspace `AGENTS.md`; keep local Codex notes there if needed.

Do not copy Heli-Harness into `%USERPROFILE%\.codex\skills` by default. This harness is intended to live with the parent workspace.

v0.5.10 verifies Codex adapter wiring with `node scripts/smoke-codex-adapter.mjs`. v0.5.11 adds a real plugin marketplace manifest and live-verifies install/trust with `node scripts/live-verify-codex-plugin-install.mjs`, but it does not yet claim live Codex hook enforcement.
