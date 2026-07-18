# Adapter Support Matrix

This is the authoritative, evidence-based adapter-status reference. Statuses describe tested host behavior, not a security boundary; every hook remains a guardrail rather than a sandbox.

For end-user installation instructions, see the [INSTALL.md end-user installation guide](../INSTALL.md).

## Status taxonomy

| Status | Meaning |
| --- | --- |
| `enforced` | Runtime hook or tool-call guard behavior is tested; the row names the available live and/or smoke evidence for that host. |
| `verified-plugin-wired` | Native plugin artifacts are shipped and smoke-tested; runtime enforcement lacks live proof. |
| `verified-wired` | Pointer artifacts and install/update wiring are smoke-tested; runtime enforcement is not proven. |
| `wired` | Adapter files and install wiring exist. |
| `documented` | Instructions exist without verified wiring. |
| `planned` | Roadmap only. |

## Current support

| Adapter | Status | Evidence and verification | Limits |
| --- | --- | --- | --- |
| **Pi** | `enforced` | `extensions/pi-extension.js`; `node scripts/smoke-extension-load.mjs` | Named evidence is a local smoke; host-specific runtime scope requires compatible hooks; not a sandbox. |
| **Claude Code** | `enforced` | `.heli-harness/adapters/claude-plugin/`; `node scripts/smoke-claude-adapter.mjs`; `node scripts/smoke-claude-plugin.mjs`; `node scripts/smoke-plugin-skills.mjs`; `node scripts/live-verify-claude-plugin.mjs` | Full skill library packaged in plugin; live behavioral skill proof requires working API auth; `--plugin-dir` flow is the tested load path; not a sandbox. |
| **Codex** | `enforced` | `.agents/plugins/marketplace.json` (Git marketplace root); `.heli-harness/adapters/codex-plugin/`; `node scripts/smoke-codex-adapter.mjs`; `node scripts/smoke-codex-plugin.mjs`; `node scripts/smoke-plugin-skills.mjs`; `node scripts/live-verify-codex-plugin-install.mjs`; `node scripts/live-verify-codex-plugin-hook.mjs` | Full skill library packaged in plugin; preferred host activation is `codex plugin marketplace add KJ-AIML/heli-harness` (upgradeable); workspace-local nested path is dogfood-only; not a sandbox. |
| Cursor | `plugin-wired` | `.heli-harness/adapters/cursor-plugin/` marketplace; `node scripts/smoke-cursor-plugin.mjs`; `scripts/verify-adapters.mjs` | Marketplace indexes nested plugin with full skill library mirror; no runtime guard. |
| Grok Build | `enforced` | `.heli-harness/adapters/grok-plugin/`; smoke scripts; `scripts/live-verify-grok-hooks.mjs` | User-hook installation is required; plugin inventory alone does not wire runtime hooks. |
| OpenCode | `enforced` | `.heli-harness/adapters/opencode-plugin/`; smoke scripts; `scripts/live-verify-opencode-plugin.mjs` | Copy into `.opencode/plugins/` for automatic project discovery; not a sandbox. |
| Kimi Code CLI | `enforced` | `.heli-harness/adapters/kimi-plugin/`; smoke scripts; `scripts/live-verify-kimi-hooks.mjs` | Requires hook installation in Kimi configuration; not a sandbox. |
| Antigravity CLI | `verified-plugin-wired` | `.heli-harness/adapters/antigravity-plugin/`; synthetic smoke scripts | No live host proof yet. |
| AXGA | `documented` | `.heli-harness/adapters/pi/README.md` | No dedicated AXGA smoke test. |
| Generic | `documented` | `.heli-harness/adapters/generic/AGENT_INSTRUCTIONS.md` | Manual setup; no runtime enforcement. |
| Windsurf, Cline, Gemini, OpenClaw | `planned` | `ROADMAP.md` | No implementation. |

## Hook scope

Live checks for supported native hooks exercise remote-push denial and environment-file-write denial in isolated workspaces. They also cover stuck or target-mismatched task-state write gates where listed in the adapter artifacts. This is deliberately limited coverage, not host permission enforcement or sandboxing.

## Maintainer verification

Run local smoke checks before changing evidence claims. The `scripts/live-verify-*.mjs` commands may use isolated credentials, make API calls, and consume provider usage; they are maintainer-only release proof, not user setup.
