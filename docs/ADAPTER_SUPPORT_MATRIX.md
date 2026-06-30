# Adapter Support Matrix

This document provides an honest, evidence-based assessment of Heli-Harness adapter support.

## Adapter Status Taxonomy

| Status | Meaning | Evidence Required |
|--------|---------|-------------------|
| **enforced** | Runtime hook/tool-call guard is verified and tested | Smoke test or interactive test exists, runtime enforcement proven |
| **verified-wired** | Adapter files, install/update wiring, generated pointer files, and config examples are validated by smoke tests, but runtime enforcement is not proven | Adapter smoke test exists and validates generated artifacts |
| **wired** | Files/config/install paths exist and are validated | Adapter files present, install/update wires them, but runtime enforcement may not be proven |
| **documented** | Documentation exists, but no verified wiring or runtime enforcement | README/docs exist, but no smoke tests or runtime verification |
| **planned** | Roadmap item exists, but no shipped adapter wiring yet | Mentioned in ROADMAP.md, no implementation |
| **unsupported** | Explicitly not supported | Clear statement of non-support |

## Current Adapter Status

| Adapter | Status | Evidence | Enforcement Surface | Files Checked | Verification Command | Limitations | Next Milestone |
|---------|--------|----------|---------------------|---------------|---------------------|-------------|----------------|
| **Pi** | enforced | Extension file, smoke tests, hook guards | `tool_call` hook, `before_agent_start` hook | `extensions/pi-extension.js`, `scripts/smoke-extension-load.mjs` | `node scripts/smoke-extension-load.mjs` | Requires host-compatible `tool_call` hooks; not a sandbox | N/A (baseline) |
| **AXGA** | documented | README exists, shares Pi extension | Same as Pi if hooks available | `.heli-harness/adapters/pi/README.md` | Manual verification | No dedicated AXGA smoke test; relies on Pi extension compatibility | v0.5.9+ |
| **Codex** | wired | Adapter files exist, install creates pointer | Workspace `AGENTS.md` pointer | `.heli-harness/adapters/codex/AGENTS.md`, `install.sh`/`install.ps1` | `node scripts/verify-adapters.mjs` | No runtime hook enforcement; relies on Codex reading `AGENTS.md` | v0.5.9+ |
| **Claude Code** | verified-wired | Adapter files, settings example, installer-created pointer, update preservation smoke | Workspace `CLAUDE.md` pointer; optional SessionStart context example | `.heli-harness/adapters/claude/CLAUDE.md`, `.heli-harness/adapters/claude/settings.local.json.example`, `scripts/smoke-claude-adapter.mjs`, `install.sh`/`install.ps1`, `update.sh`/`update.ps1` | `node scripts/smoke-claude-adapter.mjs` | No runtime hook enforcement proven; adapter is instruction/config/pointer based | v0.5.9+ runtime hook investigation |
| **Cursor** | wired | Adapter files exist, install creates pointer | Workspace `.cursorrules` or `.cursor/rules/` | `.heli-harness/adapters/cursor/CURSOR.md`, `install.sh`/`install.ps1` | `node scripts/verify-adapters.mjs` | No runtime hook enforcement; relies on Cursor reading adapter file | v0.5.9+ |
| **Generic** | documented | Adapter instructions exist | None (manual setup) | `.heli-harness/adapters/generic/AGENT_INSTRUCTIONS.md` | `node scripts/verify-adapters.mjs` | No install automation; no runtime enforcement | N/A |
| **OpenCode** | planned | Mentioned in ROADMAP.md | None | None | N/A | No implementation | v0.5.9+ |
| **Windsurf** | planned | Mentioned in ROADMAP.md | None | None | N/A | No implementation | Post-v0.5 |
| **Cline** | planned | Mentioned in ROADMAP.md | None | None | N/A | No implementation | Post-v0.5 |
| **Gemini** | planned | Mentioned in ROADMAP.md | None | None | N/A | No implementation | Post-v0.5 |
| **OpenClaw** | planned | Mentioned in ROADMAP.md | None | None | N/A | No implementation | Post-v0.5 |

## Evidence Definitions

### Pi Adapter (enforced)

**Evidence:**
- `extensions/pi-extension.js` — 1500+ line extension with hooks, guards, commands
- `scripts/smoke-extension-load.mjs` — Comprehensive smoke test covering:
  - Session start hook
  - Before-agent-start hook
  - Tool-call guard (command blocking, file path blocking)
  - Command registration
  - Hook observability probes
  - Multi-repo targeting
- Remote install verified: `pi install git:github.com/KJ-AIML/heli-harness@v0.5.6`

**Enforcement surfaces:**
- `tool_call` hook blocks dangerous commands (`git push`, `npm publish`, `rm -rf`, etc.)
- `tool_call` hook blocks writes to secret paths (`.env`, `.pem`, `.key`, etc.)
- `before_agent_start` hook injects safety context
- `session_start` hook detects workspace harness

**Limitations:**
- Enforcement depends on host-compatible `tool_call` hooks
- Not a sandbox; best-effort local classification
- Does not replace host permissions or sandboxing

### Claude Code Adapter (verified-wired)

**Evidence:**
- `.heli-harness/adapters/claude/CLAUDE.md` is the Claude-facing entrypoint.
- `.heli-harness/adapters/claude/settings.local.json.example` parses as JSON.
- `install.sh` and `install.ps1` create workspace `CLAUDE.md` when absent.
- `update.sh` and `update.ps1` leave user-owned workspace `CLAUDE.md` untouched.
- `scripts/smoke-claude-adapter.mjs` verifies these artifacts locally.

**Enforcement surfaces:**
- Workspace `CLAUDE.md` pointer directs Claude Code to `.heli-harness/adapters/claude/CLAUDE.md`.
- Optional SessionStart example can inject context if the user enables it.
- No runtime hook enforcement proven.

**Limitations:**
- Adapter is instruction/config/pointer based.
- No tested Claude Code tool-call blocking hook is shipped.
- Enforcement depends on Claude Code hook support and future tested blocking hooks.

### Codex/Cursor Adapters (wired)

**Evidence:**
- Adapter instruction files exist in `.heli-harness/adapters/<adapter>/`
- Install scripts (`install.sh`, `install.ps1`) create workspace pointer files:
  - Codex: `AGENTS.md` → `.heli-harness/adapters/codex/AGENTS.md`
  - Cursor: `.cursorrules` or `.cursor/rules/harness.mdc` → `.heli-harness/adapters/cursor/CURSOR.md`
- `verify-adapters.mjs` validates file presence

**Enforcement surfaces:**
- Workspace pointer files direct agents to adapter instructions
- Agents read `.heli-harness/HARNESS.md` and follow protocols
- No runtime hook enforcement (agents must voluntarily follow instructions)

**Limitations:**
- No runtime enforcement; relies on agent reading and following instructions
- No smoke test proving agents actually read the pointer files
- No hook-based safety guards (unlike Pi)

### Generic Adapter (documented)

**Evidence:**
- `.heli-harness/adapters/generic/AGENT_INSTRUCTIONS.md` exists
- Provides instructions for any local coding agent

**Enforcement surfaces:**
- None (manual setup required)

**Limitations:**
- No install automation
- No runtime enforcement
- No smoke tests

## Verification

Run `node scripts/verify-adapters.mjs` to validate:
- Adapter manifest schema
- Evidence file presence
- Docs consistency
- No overclaims (e.g., claiming "enforced" without smoke tests)

## Claims Policy

**Claims require evidence.**

- Do not claim an adapter is "enforced" unless smoke tests prove runtime enforcement.
- Do not claim an adapter is "verified-wired" unless a smoke test validates generated adapter artifacts.
- Do not claim an adapter is "wired" unless install scripts create the expected files.
- Do not claim an adapter is "documented" unless docs exist.
- If an adapter is "planned", say so explicitly.
- If an adapter is "unsupported", say so explicitly.

## Future Work

**v0.5.9+ — Real Adapter Implementation:**
- Add runtime hook support for Claude Code if host support is confirmed and smoke-tested
- Add runtime hook support for Codex (if host supports it)
- Add runtime hook support for Cursor (if host supports it)
- Add dedicated smoke tests for each adapter
- Move adapters from "wired" to "enforced" when runtime enforcement is proven

**Post-v0.5 — Planned Adapters:**
- OpenCode adapter
- Windsurf adapter
- Cline adapter
- Gemini adapter
- OpenClaw adapter

## Notes

- This matrix is updated by `verify-adapters.mjs` during release validation.
- Adapter status is based on evidence, not aspirations.
- "Verified-wired" does not mean "enforced". It means generated adapter artifacts are smoke-tested.
- "Wired" does not mean "enforced". Wired means files exist and install wires them.
- "Enforced" means runtime hooks are verified and tested.
