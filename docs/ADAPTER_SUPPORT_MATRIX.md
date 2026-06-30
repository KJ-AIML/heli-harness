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
| **Claude Code** | verified-plugin-wired | `.heli-harness/adapters/claude/CLAUDE.md`, `.heli-harness/adapters/claude-plugin/.claude-plugin/plugin.json`, `.heli-harness/adapters/claude-plugin/hooks/hooks.json`, `scripts/smoke-claude-plugin.mjs` | Workspace `CLAUDE.md` pointer; native plugin manifest; synthetic SessionStart and PreToolUse hook smokes | `node scripts/smoke-claude-adapter.mjs`; `node scripts/smoke-claude-plugin.mjs` | No live Claude Code runtime hook enforcement has been proven; plugin hooks require host install/trust |
| **Codex** | verified-plugin-wired | `.heli-harness/adapters/codex/AGENTS.md`, `.heli-harness/adapters/codex-plugin/.codex-plugin/plugin.json`, `.heli-harness/adapters/codex-plugin/hooks/hooks.json`, `scripts/smoke-codex-plugin.mjs` | Workspace `AGENTS.md` pointer; native plugin manifest; synthetic SessionStart and PreToolUse hook smokes | `node scripts/smoke-codex-adapter.mjs`; `node scripts/smoke-codex-plugin.mjs` | No live Codex runtime hook enforcement has been proven; plugin hooks require host install/trust |
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

Heli ships `.heli-harness/adapters/claude-plugin/.claude-plugin/plugin.json`, root-level `hooks/hooks.json`, a `skills/heli-governance/SKILL.md`, and a plugin README. The smoke test parses those files, runs `node --check` on hook scripts, invokes synthetic SessionStart input, invokes synthetic PreToolUse input for `git push` and `.env` writes, and runs `claude plugin validate` when the local CLI is available.

This proves plugin artifacts are present and locally valid. It does not prove a live Claude Code session installed, trusted, or executed the hook.

### Codex

Heli ships `.heli-harness/adapters/codex-plugin/.codex-plugin/plugin.json`, root-level `hooks/hooks.json`, `skills/heli-governance/SKILL.md`, `AGENTS.md`, and a plugin README. The smoke test parses those files, runs `node --check` on hook scripts, invokes synthetic SessionStart input, and invokes synthetic PreToolUse input for `git push` and `.env` writes.

This proves plugin artifacts are present and locally valid. It does not prove a live Codex session installed, trusted, or executed the hook.

## Claims Policy

Claims require evidence.

- Do not claim `enforced` unless runtime hook/tool-call blocking is proven.
- Use `verified-plugin-wired` only when native plugin files and plugin smoke tests exist.
- Use `verified-wired` for smoke-tested pointer adapters.
- Use `wired` for pointer files without dedicated smoke coverage.
- Keep planned hosts planned until artifacts ship.

Run `node scripts/verify-adapters.mjs` and `node scripts/validate-release.mjs` before changing status claims.
