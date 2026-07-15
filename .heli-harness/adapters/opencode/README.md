# OpenCode Adapter

Pointer adapter + local JS plugin for [OpenCode](https://opencode.ai/).

| Piece | Path |
|-------|------|
| Instructions | `OPENCODE.md` |
| Install notes | `install.md` |
| Plugin | `../opencode-plugin/heli-harness.mjs` -> `.opencode/plugins/heli-harness.mjs` |

**Status:** `enforced` (synthetic import smoke; no live OpenCode CLI denial proof yet). OpenCode auto-loads project plugins from `.opencode/plugins/` and global plugins from `~/.config/opencode/plugins/`.
