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

v0.5.10 verifies Codex adapter wiring with `node scripts/smoke-codex-adapter.mjs`. v0.5.11 adds a real plugin marketplace manifest and live-verifies install/trust with `node scripts/live-verify-codex-plugin-install.mjs`. v0.5.12 live-verifies the PreToolUse hook itself with `node scripts/live-verify-codex-plugin-hook.mjs` against a real Codex session — Codex is now `enforced`.

Windows shell patterns for agents: `.heli-harness/templates/windows-shell-recipes.md`.

### Native plugin install

**Recommended (Git marketplace — upgradeable, Ponytail parity):**

```bash
codex plugin marketplace add KJ-AIML/heli-harness
codex plugin add heli-harness@heli-harness
codex plugin marketplace upgrade heli-harness
```

The repo-root `.agents/plugins/marketplace.json` indexes `./.heli-harness/adapters/codex-plugin`.

**Workspace-local dogfood** (after `heli install`; not upgradeable). Use `./` or an absolute path — bare `.heli-harness/…` is an invalid Codex marketplace source:

```bash
codex plugin marketplace add ./.heli-harness/adapters/codex-plugin
codex plugin add heli-harness@heli-harness
```
