# Changelog

## v0.3.2 - Hook Observability Probes

### Added
- `/heli-hooks probe`
- One-shot `before_agent_start` canary with `HELI_HOOK_OK`
- `/heli-hooks test-guard`
- One-shot `tool_call` guard canary with `HELI_GUARD_OK`
- Probe behavior stays opt-in and one-shot

### Changed
- Normal hook behavior is unchanged
- Extension smoke coverage now verifies probe and test-guard paths

## v0.3.1 - AXGA extension loader compatibility hotfix

### Fixed
- Fixed `tool_call` handler structure so `event` is only read inside the callback.
- Ensured AXGA can load `extensions/pi-extension.js` with plain loader-friendly JavaScript.
- Kept v0.3.0 safe auto hooks behavior, including `/heli-hooks`.
- Added extension load smoke validation for event hooks and commands.

## v0.3.0 - Safe Auto Hooks

### Added
- **session_start hook**: Detects workspace harness and shows status (active/package-only)
- **before_agent_start hook**: Injects compact safety rules when workspace exists
  - Instructs agent to read HARNESS.md, profiles, preserve dirty work
  - Prevents accidental mutating/release/push operations without approval
- **tool_call safety guard**: Blocks or confirms dangerous operations
  - Bash: `npm publish`, `git push`, `rm -rf`, release commands, API-credit-consuming commands
  - Files: `.env`, `.pem`, `.key`, credential files, legacy runtime folders
- **input shortcuts**: `/review`, `/audit`, `/validate`, `/impact` → `/heli-*` commands
- **/heli-hooks command**: Show auto hooks status
- Status bar integration: `heli: active` or `heli: package-only`

### Safety Guarantees
- No auto install
- No auto tests
- No auto commits
- No auto pushes
- No destructive automation
- All hooks respect workspace detection (only activate when `.heli-harness/HARNESS.md` exists)
- tool_call guard uses `ctx.ui.confirm()` when available, otherwise blocks by default

### Implementation Details
- Hooks only activate when workspace harness is detected
- before_agent_start appends compact rules to system prompt (does not override)
- tool_call guard checks both bash commands and file write/edit operations
- input shortcuts only transform exact matches, not natural language
- Status bar shows current workspace state
## v0.2.0 - Pi workflow commands

### Added
- `/heli-help` - Show Heli-Harness commands and what they do
- `/heli-init` - Bootstrap repo profile for a target repo
- `/heli-review` - Review current repo/diff/task safely
- `/heli-audit` - Repo-wide audit for issues and risks
- `/heli-validate` - Run test-validation workflow safely
- `/heli-impact` - Impact analysis for planned changes

### Changed
- All workflow commands are workspace-aware: check for `.heli-harness/HARNESS.md` before proceeding
- Commands suggest `/heli-install` if workspace harness is missing
- Added 6 namespaced wrapper skills to avoid skill name collisions
- Commands preserve safe, opt-in behavior
- Commands avoid legacy names.

### Notes
- No breaking changes
- No migration support added
- All commands are non-destructive by default
## 0.1.2 - 2026-06-28

### Docs-only polish

- Updated all install examples from v0.1.0 to v0.1.1
- Removed outdated "experimental" label from Pi adapter section
- Updated status notes to reflect verified Pi remote install for v0.1.1+
- No behavior changes
- No migration support added

## 0.1.1 - 2026-06-28

### Clean reference hotfix

- Fixed Claude hook example path to `.heli-harness` in `settings.local.json.example`
- Fixed `.gitignore` patterns to `.heli-harness`
- Confirmed zero legacy references in codebase
- No behavior changes
- No migration support added

## 0.1.0 - 2026-06-28

### Initial Heli-Harness release

- Parent-workspace harness for multi-repo, multi-agent engineering work
- 17 skills: audit, branch, debug, deps, design, engineering, feature, fix-loop, flow, gh-write, impact, incident, release, test-coverage, test-validation, verify-premise, workflow
- Pi package with skills + lightweight extension
- `/heli-install` and `/hh-install` commands for workspace setup
- `/hh-status` command for harness status reporting
- Safe opt-in workspace install (no auto-install on startup)
- Codex, Claude Code, Cursor, and Generic agent adapters
- Repo profiles, state tracking, task protocol
- Optional lifecycle hooks
- Profile templates
- Install, update, and uninstall scripts for Windows and macOS/Linux
