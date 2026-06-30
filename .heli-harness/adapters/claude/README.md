# Claude Code Adapter

This folder connects Claude Code to Heli-Harness without making Claude the source of truth.

Status: pointer adapter `verified-wired`; native plugin artifacts `verified-plugin-wired`.

Evidence:

- `.heli-harness/adapters/claude/CLAUDE.md` is the Claude-facing entrypoint.
- `.heli-harness/adapters/claude/settings.local.json.example` parses as JSON.
- `install.sh` and `install.ps1` create a parent workspace `CLAUDE.md` pointer when one does not already exist.
- `update.sh` and `update.ps1` leave user-owned parent workspace `CLAUDE.md` untouched.
- `node scripts/smoke-claude-adapter.mjs` verifies those artifacts locally.

Recommended parent `CLAUDE.md`:

```text
Read .heli-harness/adapters/claude/CLAUDE.md first.
```

No live runtime hook enforcement is proven for Claude Code in this release. Optional hook examples are context-injection examples only unless a future smoke test proves blocking behavior.
