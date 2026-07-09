# YOLO / unguarded mode (opt-in)

Default Heli PreToolUse is **strict** (blocks remote git write + `.env`-style secrets + stuck-task gates).

For large autonomous workflows that **must** push remotes or write secret files, enable **opt-in** unguarded mode. This is intentional and explicit — never the default.

## Enable (any one is enough)

### 1. CLI (recommended)

```bash
heli yolo on
heli yolo on . --hours 4   # optional expiry
heli yolo status
heli yolo off
```

Writes `.heli-harness/state/yolo.json` with `{ "enabled": true }`.

### 2. Environment (this shell only)

```powershell
$env:HELI_YOLO = "1"
# or
$env:HELI_GUARDS = "off"
```

```bash
export HELI_YOLO=1
# or
export HELI_GUARDS=off
```

Then start your agent in the **same** shell.

### 3. Task mode field

In `.heli-harness/state/current-task.md`:

```text
Mode: yolo
```

Also accepted: `unguarded`, `dangerous`.

### 4. Granular (strict stays on for other rules)

```powershell
$env:HELI_ALLOW_GIT_PUSH = "1"
$env:HELI_ALLOW_ENV_WRITE = "1"
```

## What YOLO skips

- Blanket remote git write block
- `.env`-style secret write block
- Stuck-task / plan-step write gates

## What YOLO is **not**

- Not a host sandbox bypass (`--dangerously-skip-permissions` etc. are separate)
- Not permanent unless you leave `yolo.json` / env set
- Not enabled by agent guesswork — user or explicit Mode/env/file only

## Host notes

| Host | Needs |
|------|--------|
| Grok | User hooks installed + yolo on (cwd must be the workspace with `yolo.json`) |
| Claude / Codex | Plugin hooks + yolo on |
| OpenCode | Plugin loaded + yolo on |
| Kimi | Hooks in config.toml + yolo on |

Always run the agent with **cwd = workspace root** that contains `.heli-harness/state/yolo.json`.
