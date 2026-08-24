# OpenCode Adapter

Pointer adapter + local JS plugin for [OpenCode](https://opencode.ai/).

| Piece | Path |
|-------|------|
| Instructions | `OPENCODE.md` |
| Install notes | `install.md` |
| Plugin | `../opencode-plugin/` (whole tree) -> `.opencode/plugins/` |

**Status:** `enforced` (synthetic import smoke + live OpenCode CLI denial proof via `scripts/live-verify-opencode-plugin.mjs`). OpenCode auto-loads `.js`/`.ts` project plugins from `.opencode/plugins/` and global plugins from `~/.config/opencode/plugins/`; `.mjs` files are not auto-discovered, so copy the tree and keep the `heli-harness.js` entry name.
