# Install Matrix

Use the workspace harness for a parent workspace. Host-specific support status and proof live in [Adapter Support Matrix](ADAPTER_SUPPORT_MATRIX.md).

## Workspace harness

| Method | Command | What it installs |
| --- | --- | --- |
| Windows PowerShell | `.\install.ps1 -Parent "C:\your\workspace"` | Full harness and adapter pointers |
| macOS/Linux bash | `./install.sh /path/to/workspace` | Full harness and adapter pointers |
| CLI | `npx github:KJ-AIML/heli-harness install <path>` | Full harness and adapter pointers |
| Agent prompt | Ask an agent to install the repository into the current parent workspace | Full harness and adapter pointers |

## Host setup from an installed workspace

| Host | Command or path | Notes |
| --- | --- | --- |
| Pi / AXGA | `pi install git:github.com/KJ-AIML/heli-harness@v0.5.22` or `axga install git:github.com/KJ-AIML/heli-harness@v0.5.22` | Package install; run `/heli-install` for a workspace harness |
| Codex | `codex plugin marketplace add .heli-harness/adapters/codex-plugin`; `codex plugin add heli-harness@heli-harness` | `AGENTS.md` remains the workspace pointer |
| Claude Code | `claude plugin install .heli-harness/adapters/claude-plugin` | `CLAUDE.md` remains the workspace pointer |
| Cursor | `.heli-harness/adapters/cursor/CURSOR.md` | Requires workspace install first |
| Grok Build | `node .heli-harness/adapters/grok-plugin/install-user-hooks.mjs` | Optional skills: `grok plugin install .heli-harness/adapters/grok-plugin --trust` |
| OpenCode | Copy `.heli-harness/adapters/opencode-plugin/heli-harness.mjs` and register it in `opencode.json` | See `.heli-harness/adapters/opencode/install.md` |
| Kimi Code CLI | `node .heli-harness/adapters/kimi-plugin/install-user-hooks.mjs` | Then run `kimi doctor config` |
| Antigravity CLI | Stage `.heli-harness/adapters/antigravity-plugin/` in the host plugin directory | See `.heli-harness/adapters/antigravity/install.md` |
| Generic agents | `.heli-harness/adapters/generic/AGENT_INSTRUCTIONS.md` | Requires workspace install first |

## Lifecycle

| Action | CLI | Local checkout |
| --- | --- | --- |
| Update | `npx github:KJ-AIML/heli-harness update <path>` | `./update.sh /path/to/workspace` or `.\update.ps1 -Parent "C:\your\workspace"` |
| Uninstall | `npx github:KJ-AIML/heli-harness uninstall <path>` | `./uninstall.sh /path/to/workspace` or `.\uninstall.ps1 -Parent "C:\your\workspace"` |
