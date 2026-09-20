# Install Matrix — v0.10.1

**Primary topology:** shared/global distribution + `heli setup` + project `heli link`
**Architecture:** [Current Heli architecture](architecture/README.md)
**Host evidence:** [Adapter Support Matrix](ADAPTER_SUPPORT_MATRIX.md)

## Current linked project setup

| Step | Command | Result |
| --- | --- | --- |
| Install pinned release | `npm install -g github:KJ-AIML/heli-harness#v0.10.1` | Shared/global Heli CLI/runtime |
| Initialize trusted user state | `heli setup` | machine identity, user policy, locator |
| Install detected host integrations | `heli host install all` | host-native plugins/hooks/skills from the global package; unavailable/manual hosts are reported |
| Inspect host installation | `heli host status` | separates CLI presence/plugin installation from live runtime evidence |
| Link project | `cd <project> && heli link` | `.heli/workspace.json`, `.heli/heli.lock`, fresh execution identity |
| Verify | `heli doctor && heli status` | layout, target/resource, runtime and host evidence |

The global registry is a locator only. Live grants/sessions/resource authority/capability observations are not committed project state.

## Host activation

| Host | Command or path | Notes |
| --- | --- | --- |
| Pi / AXGA | `pi install git:github.com/KJ-AIML/heli-harness@v0.10.1` or `axga install git:github.com/KJ-AIML/heli-harness@v0.10.1` | Package install is separate from project linking; embedded `/heli-install` is compatibility-only |
| Codex | `codex plugin marketplace add KJ-AIML/heli-harness`; `codex plugin add heli-harness@heli-harness` | Upgrade with `codex plugin marketplace upgrade heli-harness` |
| Claude Code | `claude plugin install .heli-harness/adapters/claude-plugin` | Local/packaged plugin path; use capability evidence for live status |
| Cursor | Use `.heli-harness/adapters/cursor-plugin/` as local marketplace or copy its nested plugin | Plugin wiring is not equivalent to runtime enforcement |
| Grok Build | `node .heli-harness/adapters/grok-plugin/install-user-hooks.mjs` | User-hook activation required |
| OpenCode | Use packaged OpenCode plugin tree | See adapter docs/support matrix |
| Kimi Code CLI | `node .heli-harness/adapters/kimi-plugin/install-user-hooks.mjs` | Verify host config after install |
| Antigravity CLI | Stage packaged plugin in host plugin location | Current status is evidence-limited |
| Generic | Follow `.heli-harness/adapters/generic/AGENT_INSTRUCTIONS.md` | Advisory unless host integration proves more |

## Embedded compatibility / hermetic install

Use only when a self-contained workspace is intentional:

```bash
npx github:KJ-AIML/heli-harness#v0.10.1 install <path>
```

Existing embedded workspaces can migrate with `heli link <path>` after active embedded writer authority is quiesced.

## Lifecycle

| Action | Current command |
| --- | --- |
| Inspect current layout | `heli status` |
| Validate install/binding | `heli doctor` |
| Create project binding | `heli link` |
| Temporary scoped approval | `heli grant issue ...` |
| Explain authority | `heli explain authority` |
| Update embedded compatibility install | `npx github:KJ-AIML/heli-harness#v0.10.1 update <path>` |
| Remove embedded compatibility install | `npx github:KJ-AIML/heli-harness#v0.10.1 uninstall <path>` |
