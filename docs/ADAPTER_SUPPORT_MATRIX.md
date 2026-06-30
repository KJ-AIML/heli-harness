# Adapter Support Matrix

This document provides an honest, evidence-based assessment of Heli-Harness adapter support.

## Adapter Status Taxonomy

| Status | Meaning | Evidence Required |
|--------|---------|-------------------|
| **enforced** | Runtime hook/tool-call guard is verified and tested | Smoke test or interactive test exists, runtime enforcement proven |
| **wired** | Files/config/install paths exist and are validated | Adapter files present, install/update wires them, but runtime enforcement may not be proven |
| **documented** | Documentation exists, but no verified wiring or runtime enforcement | README/docs exist, but no smoke tests or runtime verification |
| **planned** | Roadmap item exists, but no shipped adapter wiring yet | Mentioned in ROADMAP.md, no implementation |
| **unsupported** | Explicitly not supported | Clear statement of non-support |

## Current Adapter Status

| Adapter | Status | Evidence | Enforcement Surface | Files Checked | Verification Command | Limitations | Next Milestone |
|---------|--------|----------|---------------------|---------------|---------------------|-------------|----------------|
| **Pi** | enforced | Extension file, smoke tests, hook guards | `tool_call` hook, `before_agent_start` hook | `extensions/pi-extension.js`, `scripts/smoke-extension-load.mjs` | `node scripts/smoke-extension-load.mjs` | Requires host-compatible `tool_call` hooks; not a sandbox | N/A (baseline) |
| **AXGA** | documented | README exists, shares Pi extension | Same as Pi if hooks available | `.heli-harness/adapters/pi/README.md` | Manual verification | No dedicated AXGA smoke test; relies on Pi extension compatibility | v0.5.8+ |
| **Codex** | wired | Adapter files exist, install creates pointer | Workspace `AGENTS.md` pointer | `.heli-harness/adapters/codex/AGENTS.md`, `install.sh`/`install.ps1` | `node scripts/verify-adapters.mjs` | No runtime hook enforcement; relies on Codex reading `AGENTS.md` | v0.5.8+ |
| **Claude Code** | wired | Adapter files exist, install creates pointer | Workspace `CLAUDE.md` pointer | `.heli-harness/adapters/claude/CLAUDE.md`, `install.sh`/`install.ps1` | `node scripts/verify-adapters.mjs` | No runtime hook enforcement; relies on Claude reading `CLAUDE.md` | v0.5.8+ |
| **Cursor** | wired | Adapter files exist, install creates pointer | Workspace `.cursorrules` or `.cursor/rules/` | `.heli-harness/adapters/cursor/CURSOR.md`, `install.sh`/`install.ps1` | `node scripts/verify-adapters.mjs` | No runtime hook enforcement; relies on Cursor reading adapter file | v0.5.8+ |
| **Generic** | documented | Adapter instructions exist | None (manual setup) | `.heli-harness/adapters/generic/AGENT_INSTRUCTIONS.md` | `node scripts/verify-adapters.mjs` | No install automation; no runtime enforcement | N/A |
| **OpenCode** | planned | Mentioned in ROADMAP.md | None | None | N/A | No implementation | v0.5.8+ |
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

### Codex/Claude/Cursor Adapters (wired)

**Evidence:**
- Adapter instruction files exist in `.heli-harness/adapters/<adapter>/`
- Install scripts (`install.sh`, `install.ps1`) create workspace pointer files:
  - Codex: `AGENTS.md` → `.heli-harness/adapters/codex/AGENTS.md`
  - Claude: `CLAUDE.md` → `.heli-harness/adapters/claude/CLAUDE.md`
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
- Do not claim an adapter is "wired" unless install scripts create the expected files.
- Do not claim an adapter is "documented" unless docs exist.
- If an adapter is "planned", say so explicitly.
- If an adapter is "unsupported", say so explicitly.

## Future Work

**v0.5.8+ — Real Adapter Implementation:**
- Add runtime hook support for Claude Code (if host supports it)
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
- "Wired" does not mean "enforced". Wired means files exist and install wires them.
- "Enforced" means runtime hooks are verified and tested.
