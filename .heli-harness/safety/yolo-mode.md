# YOLO / unguarded mode (opt-in)

Default Heli PreToolUse is **strict**: remote git writes (`git push`, `gh pr merge`, `git subtree push`), `.env`-style secret writes and T5 rules need an approval, and stuck-task gates apply.

For large autonomous workflows that **must** push remotes or write secret files, a **human** can enable opt-in unguarded mode. This is intentional and explicit — never the default, and never something the governed agent can switch on for itself. Prefer a scoped grant (`heli grant issue --action git.push --scope time --minutes 240`) when only one approval is in the way: it keeps every other block on.

## Enable (any one is enough)

### 1. CLI (recommended)

Run these yourself in an interactive terminal. `heli yolo on` refuses to run without a TTY, and Heli's hooks hard-deny it when a coding agent runs it:

```bash
heli yolo on                # expires after 8 hours
heli yolo on . --hours 4    # or after N hours
heli yolo on . --no-expiry  # stays on until heli yolo off
heli yolo status
heli yolo off
```

In a linked project it writes an execution-local file under your Heli data directory (`~/.heli/state/workspaces/<workspace-id>/executions/<execution-id>/heli/state/yolo.json`; `heli yolo status` prints the path). In an embedded workspace it writes `.heli-harness/state/yolo.json`. Either way the file is protected Heli state: agents cannot write it. While it is on, every SessionStart says so, with its expiry.

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

A session or task can also carry YOLO (`heli session start|attach --yolo`, `heli task create --yolo`); those are human-only commands too, and `heli yolo status` reports only the file and the environment. `current-task.md` has no YOLO switch: its `Mode:` field is narrative text the agent can edit, so it never enables YOLO.

## What YOLO skips

- The push gate (remote git writes)
- `.env`-style secret write block
- T5 approval rules (for example `npm publish`, `git push --force`)
- Stuck-task / plan-step write gates
- The fail-closed refusal of shell commands when the workspace's `command-rules.json` is missing or malformed

## What YOLO never skips

- T6 hard-deny rules, including Heli's built-in floor (recursive forced deletes, `git reset --hard`, `git clean -f` with `-d`/`-x`)
- Heli self-protection: agent-run `heli grant issue` / `heli yolo on` / `heli governance set` / takeovers / any Heli command that carries `--accept-policy-changes` (accepting governance changes a sync server sent), and agent writes to Heli's own state, or to Claude settings that turn hooks off or set `HELI_` variables in `env`
- A linked project's governance files (`.heli/safety`, `.heli/policies`, the binding): the agent cannot change the rules it runs under
- Ownership / write-authority gates and live write conflicts
- Diagnosis and expensive-retry gates, and the command analysis budget (`COMMAND_TOO_COMPLEX`)

## What YOLO is **not**

- Not a host sandbox bypass (`--dangerously-skip-permissions` etc. are separate)
- Not permanent unless you ask for it (`--no-expiry`) or leave the environment variables set
- Not enabled by agent guesswork — only by a human (terminal, environment, or the file written by `heli yolo on`)
- Not a sandbox: Heli's checks read the commands an agent runs and the file paths its tools name. Code the agent runs itself (`python -c`, `node -e`, a script it wrote earlier) is outside them, so keep real secrets and remotes out of its reach as well

## Host notes

| Host | Needs |
|------|--------|
| Grok | User hooks installed + yolo on (cwd inside the workspace) |
| Claude / Codex | Plugin hooks + yolo on |
| OpenCode | Plugin loaded + yolo on |
| Kimi | Hooks in config.toml + yolo on |

Run the agent with its cwd inside the workspace the switch was turned on for (the linked project, or the embedded workspace root).
