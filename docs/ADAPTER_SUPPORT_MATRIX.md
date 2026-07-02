# Adapter Support Matrix

This document provides an evidence-based assessment of Heli-Harness adapter support.

## Adapter Status Taxonomy

| Status | Meaning | Evidence Required |
|--------|---------|-------------------|
| **enforced** | Runtime hook/tool-call guard is verified and tested | Runtime hook proof and smoke or interactive test |
| **verified-plugin-wired** | Native plugin artifacts are shipped and smoke-tested | Plugin manifest, hook config, plugin smoke test |
| **plugin-wired** | Native plugin artifacts exist but lack smoke tests | Plugin manifest or host-native package files |
| **verified-wired** | Instruction/pointer adapter artifacts are smoke-tested | Adapter smoke test validates generated artifacts |
| **wired** | Instruction/pointer files and install paths exist | Adapter files and install wiring |
| **documented** | Documentation exists only | README/docs |
| **planned** | Roadmap only | Roadmap entry |
| **unsupported** | Explicitly unsupported | Clear non-support statement |

## Current Adapter Status

| Adapter | Status | Evidence | Enforcement Surface | Verification Command | Limitations |
|---------|--------|----------|---------------------|----------------------|-------------|
| **Pi** | enforced | `extensions/pi-extension.js`, `scripts/smoke-extension-load.mjs` | `tool_call`, `before_agent_start`, `session_start` hooks | `node scripts/smoke-extension-load.mjs` | Host hook support required; not a sandbox |
| **Claude Code** | enforced | `.heli-harness/adapters/claude/CLAUDE.md`, `.heli-harness/adapters/claude-plugin/.claude-plugin/plugin.json`, `.heli-harness/adapters/claude-plugin/hooks/hooks.json`, `scripts/smoke-claude-plugin.mjs`, `scripts/live-verify-claude-plugin.mjs` | Workspace `CLAUDE.md` pointer; native plugin manifest; synthetic SessionStart/PreToolUse hook smokes; live-verified PreToolUse denial in a real Claude Code session | `node scripts/smoke-claude-adapter.mjs`; `node scripts/smoke-claude-plugin.mjs`; `node scripts/live-verify-claude-plugin.mjs` | Live proof used `--plugin-dir` session loading, not marketplace install/trust; guard rules cover only git push and .env-style writes; not a sandbox; plugin skill surface is heli-governance + heli-target + heli-install only (Pi/AXGA ships 23 skills) |
| **Codex** | enforced | `.heli-harness/adapters/codex/AGENTS.md`, `.heli-harness/adapters/codex-plugin/.codex-plugin/plugin.json`, `.heli-harness/adapters/codex-plugin/.agents/plugins/marketplace.json`, `.heli-harness/adapters/codex-plugin/hooks/hooks.json`, `scripts/smoke-codex-plugin.mjs`, `scripts/live-verify-codex-plugin-install.mjs`, `scripts/live-verify-codex-plugin-hook.mjs` | Workspace `AGENTS.md` pointer; native plugin manifest; synthetic SessionStart and PreToolUse hook smokes; live-verified marketplace add/install/trust; live-verified PreToolUse denial in a real Codex session | `node scripts/smoke-codex-adapter.mjs`; `node scripts/smoke-codex-plugin.mjs`; `node scripts/live-verify-codex-plugin-install.mjs`; `node scripts/live-verify-codex-plugin-hook.mjs` | Live proof requires `--dangerously-bypass-hook-trust`; normal interactive hook-trust prompt flow not separately verified; guard rules cover only git push and .env-style writes; plugin skill surface is heli-governance + heli-target + heli-install only (Pi/AXGA ships 23 skills) |
| **Cursor** | wired | `.heli-harness/adapters/cursor/CURSOR.md`, `install.sh`, `install.ps1` | Workspace `.cursorrules` or `.cursor/rules/` pointer | `node scripts/verify-adapters.mjs` | No runtime hook enforcement |
| **AXGA** | documented | `.heli-harness/adapters/pi/README.md` | Shares Pi extension if compatible | Manual verification | No dedicated AXGA smoke test |
| **Generic** | documented | `.heli-harness/adapters/generic/AGENT_INSTRUCTIONS.md` | Manual instructions | `node scripts/verify-adapters.mjs` | No install automation or runtime enforcement |
| **OpenCode** | planned | Roadmap entry | None | N/A | Analysis only in v0.5.10 |
| **Windsurf** | planned | Roadmap entry | None | N/A | No implementation |
| **Cline** | planned | Roadmap entry | None | N/A | No implementation |
| **Gemini** | planned | Roadmap entry | None | N/A | Analysis only in v0.5.10 |
| **OpenClaw** | planned | Roadmap entry | None | N/A | No implementation |

## Plugin Evidence

### Claude Code

Heli ships `.heli-harness/adapters/claude-plugin/.claude-plugin/plugin.json`, root-level `hooks/hooks.json`, a `skills/heli-governance/SKILL.md`, and a plugin README. `scripts/smoke-claude-plugin.mjs` parses those files, runs `node --check` on hook scripts, invokes synthetic SessionStart input, invokes synthetic PreToolUse input for `git push` and `.env` writes, and runs `claude plugin validate` when the local CLI is available.

`scripts/live-verify-claude-plugin.mjs` goes further: it copies the plugin into an isolated temp directory, drives a real `claude -p` session (`--plugin-dir`, isolated throwaway git repo, `--dangerously-skip-permissions`), asks it to run `git push origin main` and write a `.env` file, and asserts the session's own `permission_denials` result contains both denials. This is a live proof, not a synthetic one: it uses the actual installed Claude Code CLI, and confirms via the filesystem that neither action took effect. It does not cover the marketplace-installed-and-trusted flow (`claude plugin install`) — only `--plugin-dir` session loading.

The plugin's skill surface is limited to `heli-governance`, `heli-target`, and `heli-install`; it does not port the rest of Pi/AXGA's 23-skill library.

### Codex

Heli ships `.heli-harness/adapters/codex-plugin/.codex-plugin/plugin.json`, root-level `hooks/hooks.json`, `skills/heli-governance/SKILL.md`, `AGENTS.md`, a plugin README, and `.agents/plugins/marketplace.json` (required for `codex plugin marketplace add` to recognize the directory). `scripts/smoke-codex-plugin.mjs` parses those files, runs `node --check` on hook scripts, invokes synthetic SessionStart input, and invokes synthetic PreToolUse input for `git push` and `.env` writes.

`scripts/live-verify-codex-plugin-install.mjs` drives the real `codex` CLI (isolated `CODEX_HOME`) through `codex plugin marketplace add` and `codex plugin add`, then confirms `codex plugin list` reports the plugin installed and enabled. This proves the install/trust path works against the real Codex CLI.

`scripts/live-verify-codex-plugin-hook.mjs` goes further: it drives a real `codex exec` turn (isolated `CODEX_HOME`, throwaway git repo, `--dangerously-bypass-hook-trust`) asking it to run `git push origin main` and write a `.env` file, and asserts the CLI's own output shows the PreToolUse hook denying both — confirmed via the filesystem that `.env` was never created. This live test surfaced a real bug: Codex's `apply_patch` tool embeds the target path inside a patch-format string under `command` (e.g. `*** Add File: .env`), not a `path`/`file` field, so the hook's file-write guard never matched it. Fixed in `heli-pre-tool-use.mjs` for both the Codex and Claude Code plugin copies, with a synthetic regression test added to each plugin smoke test using the real captured payload shape.

The plugin's skill surface is limited to `heli-governance`, `heli-target`, and `heli-install`; it does not port the rest of Pi/AXGA's 23-skill library.

## Claims Policy

Claims require evidence.

- Do not claim `enforced` unless runtime hook/tool-call blocking is proven.
- Use `verified-plugin-wired` only when native plugin files and plugin smoke tests exist.
- Use `verified-wired` for smoke-tested pointer adapters.
- Use `wired` for pointer files without dedicated smoke coverage.
- Keep planned hosts planned until artifacts ship.

Run `node scripts/verify-adapters.mjs` and `node scripts/validate-release.mjs` before changing status claims.
