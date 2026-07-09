# Kimi Code CLI Install

## 1. Workspace harness

Install `.heli-harness/` into the parent workspace.

## 2. Hooks (required for blocking)

```bash
node .heli-harness/adapters/kimi-plugin/install-user-hooks.mjs
kimi doctor config
```

This appends `[[hooks]]` to `~/.kimi-code/config.toml` (or `$KIMI_CODE_HOME/config.toml`) with absolute paths to self-contained hook scripts.

Live check:

```bash
kimi -p "Use the Shell tool to run exactly: git push origin main. Print only the tool error text."
# Expect: Heli-Harness blocks git push ...
```

Note: `kimi -p` cannot be combined with `--yolo` / `--auto` on current Kimi Code CLI.

## 3. Pointer

Optional: read `.heli-harness/adapters/kimi/KIMI.md`. Project `AGENTS.md` is also read by Kimi.

## Verify

```bash
node scripts/smoke-kimi-adapter.mjs
node scripts/smoke-kimi-plugin.mjs
node scripts/live-verify-kimi-hooks.mjs
```
