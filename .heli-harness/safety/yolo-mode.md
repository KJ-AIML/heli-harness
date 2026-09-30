# YOLO / unguarded mode (opt-in)

Default Heli PreToolUse is **strict** (blocks remote git write + `.env`-style secrets + stuck-task gates).

For large autonomous workflows that **must** push remotes or write secret files, a **human** can enable opt-in unguarded mode. This is intentional and explicit — never the default, and never something the governed agent can switch on for itself.

## Enable (any one is enough)

### 1. CLI (recommended)

Run these yourself in an interactive terminal. `heli yolo on` refuses to run without a TTY, and Heli's hooks hard-deny it when a coding agent runs it:

```bash
heli yolo on
heli yolo on . --hours 4   # optional expiry
heli yolo status
heli yolo off
```

Writes `.heli-harness/state/yolo.json` with `{ "enabled": true }`. That file is protected Heli state: agents cannot write it.

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

### 3. Granular (strict stays on for other rules)

```powershell
$env:HELI_ALLOW_GIT_PUSH = "1"
$env:HELI_ALLOW_ENV_WRITE = "1"
```

`current-task.md` has no YOLO switch: its `Mode:` field is narrative text the agent can edit, so it never enables YOLO.

## What YOLO skips

- Blanket remote git write block
- `.env`-style secret write block
- T5 approval rules (for example `npm publish`, `git push --force`)
- Stuck-task / plan-step write gates

## What YOLO never skips

- T6 hard-deny rules, including Heli's built-in floor (recursive forced deletes, `git reset --hard`, `git clean -f` with `-d`/`-x`)
- Heli self-protection: agent-run `heli grant issue` / `heli yolo on` / takeovers / any Heli command that carries `--accept-policy-changes` (accepting governance changes a sync server sent), and agent writes to Heli's own state, or to Claude settings that turn hooks off or set `HELI_` variables in `env`
- Ownership / write-authority gates

## What YOLO is **not**

- Not a host sandbox bypass (`--dangerously-skip-permissions` etc. are separate)
- Not permanent unless you leave `yolo.json` / env set
- Not enabled by agent guesswork — only by a human (terminal, environment, or the file written by `heli yolo on`)
- Not a sandbox: Heli's checks read the commands an agent runs and the file paths its tools name. Code the agent runs itself (`python -c`, `node -e`, a script it wrote earlier) is outside them, so keep real secrets and remotes out of its reach as well

## Host notes

| Host | Needs |
|------|--------|
| Grok | User hooks installed + yolo on (cwd must be the workspace with `yolo.json`) |
| Claude / Codex | Plugin hooks + yolo on |
| OpenCode | Plugin loaded + yolo on |
| Kimi | Hooks in config.toml + yolo on |

Always run the agent with **cwd = workspace root** that contains `.heli-harness/state/yolo.json`.
