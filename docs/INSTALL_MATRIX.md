# Install Matrix — v0.10.2

**Primary topology:** global Heli distribution → machine-level host integration → lightweight project `.heli/` binding
**Architecture:** [Current Heli architecture](architecture/README.md)
**Host evidence:** [Adapter Support Matrix](ADAPTER_SUPPORT_MATRIX.md)

## Canonical linked-project setup

| Step | Command | Result |
| --- | --- | --- |
| Install pinned release | `npm install -g github:KJ-AIML/heli-harness#v0.10.2` | Shared/global Heli CLI/runtime |
| Initialize trusted user state | `heli setup` | Machine identity, user policy, locator |
| Install host integrations | `heli host install all` | Machine-level plugins/hooks/skills from the global package |
| Inspect lifecycle state | `heli host status` | Absent/current/stale/manual state, separate from runtime proof |
| Link project | `cd <project> && heli link` | `.heli/workspace.json`, `.heli/heli.lock`, fresh execution identity |
| Verify project | `heli doctor && heli status` | Project binding/runtime/authority checks |
| Verify live host | `heli explain capabilities` | Session-specific observed host capability evidence |

A normal linked project does **not** need a local `.heli-harness/` directory.

## Host lifecycle matrix

| Host | Install | Update / repair | Remove | Notes |
| --- | --- | --- | --- | --- |
| Pi | `heli host install pi` | `heli host update pi` / `repair pi` | `heli host remove pi` | Pi `/heli-install` links the current project; embedded install is explicitly `/heli-legacy-install`. |
| Claude Code | `heli host install claude` | `update claude` / `repair claude` | `remove claude` | Packaged plugin is resolved from the global Heli distribution. |
| Codex | `heli host install codex` | `update codex` / `repair codex` | `remove codex` | Uses repository Git marketplace + `heli-harness@heli-harness`. |
| Grok Build | `heli host install grok` | `update grok` / `repair grok` | `remove grok` | Heli owns `~/.grok/hooks/heli-harness.json`; plugin inventory alone is not runtime proof. |
| OpenCode | `heli host install opencode` | `update opencode` / `repair opencode` | `remove opencode` | Namespaced bundle + wrapper; other user plugins are preserved. |
| Kimi Code CLI | `heli host install kimi` | `update kimi` / `repair kimi` | `remove kimi` | Delimited Heli block in host config; unrelated config is preserved. |
| Cursor | `heli host install cursor` | `update cursor` / `repair cursor` | `remove cursor` | Heli-owned local-user plugin directory only. |
| AXGA | `heli host install axga` | `update axga` / `repair axga` | `remove axga` | Pi-compatible package flow; dedicated live-host proof remains separate. |
| Antigravity | set `HELI_ANTIGRAVITY_PLUGIN_DIR`, then `heli host install antigravity` | `update antigravity` / `repair antigravity` | `remove antigravity` | Env var points to the host plugin **parent**; Heli manages only its `heli-harness/` child. |
| Generic | manual | manual | manual | Instruction-only fallback; no host-native lifecycle surface. |

`heli host install all` reports unavailable/manual hosts rather than silently installing a project-local fallback.

## Lifecycle guarantees

Managed installs are designed to be repeatable and version-aware. Heli records machine-level integration receipts under trusted user config, reports stale or unknown-version installations, and keeps host installation separate from project `.heli/` state.

Removing a host integration does not remove or rewrite:

- `.heli/workspace.json`
- `.heli/heli.lock`
- project overlays
- unrelated host configuration
- unrelated host plugins

## Embedded compatibility / hermetic install

Use only when a self-contained workspace is intentional:

```bash
npx github:KJ-AIML/heli-harness#v0.10.2 install <path>
```

This creates the legacy-compatible `.heli-harness/` tree. Existing embedded workspaces can migrate with `heli link <path>` after active embedded writer authority is quiesced.

Embedded adapter paths belong to this compatibility mode only and are not the normal host onboarding path.
