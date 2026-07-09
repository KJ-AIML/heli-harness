# Grok Build Install

## 1. Workspace harness

```powershell
.\install.ps1 -Parent "C:\your\workspace"
```

```bash
./install.sh /path/to/workspace
```

Grok auto-reads workspace `AGENTS.md` / `CLAUDE.md` when present (installer creates them if missing).

## 2. Enforce hooks (required for blocking)

Grok's runtime loads **user hooks** from `~/.grok/hooks/*.json`. Plugin manifests can list hooks for inventory, but live PreToolUse blocking is proven via user-level hooks.

From the heli-harness package (or an installed workspace that contains the adapters):

```bash
node .heli-harness/adapters/grok-plugin/install-user-hooks.mjs
```

This writes `~/.grok/hooks/heli-harness.json` with absolute paths to the deny scripts.

Verify:

```bash
grok inspect
# Hooks section should show PreToolUse loaded (not total_hooks=0)
```

Live check (costs model tokens):

```bash
grok -p "Run the shell command: git push origin main" --permission-mode auto
# Expect tool call denied with Heli-Harness git push message
```

## 3. Optional plugin install (skills)

```bash
grok plugin validate .heli-harness/adapters/grok-plugin
grok plugin install .heli-harness/adapters/grok-plugin --trust
```

This loads `heli-governance` / `heli-target` / `heli-install` skills. Hook **enforcement** still needs step 2.

## 4. Claude-compat fallback

Grok also loads Claude Code plugins. You can use:

```bash
grok plugin install .heli-harness/adapters/claude-plugin --trust
```

plus the same user hooks installer (step 2) for blocking.

## Verify package artifacts

```bash
node scripts/smoke-grok-adapter.mjs
node scripts/smoke-grok-plugin.mjs
node scripts/live-verify-grok-hooks.mjs
```
