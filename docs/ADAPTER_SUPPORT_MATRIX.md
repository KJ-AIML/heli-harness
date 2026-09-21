# Adapter Support Matrix

**Current released baseline:** `v0.10.2`  
**Architecture:** [Current Heli architecture](architecture/README.md)  
**Install lifecycle:** [Install Matrix](INSTALL_MATRIX.md)

This matrix separates runtime evidence from installation lifecycle guarantees. An adapter is not considered fully supported merely because plugin files exist or one hook smoke test passes.

## Dimension taxonomy

| Dimension | Meaning |
| --- | --- |
| Runtime integration | What host callback/plugin behavior is implemented and tested. |
| Fresh install | A machine-level install path exists from the global Heli distribution. |
| Global discovery | Host integration resolves packaged Heli assets without requiring a project-local `.heli-harness/`. |
| Linked project | Host/runtime can operate when the project contains only `.heli/` binding/state. |
| Update / repair | Managed refresh path exists and is safe to repeat. |
| Remove | Managed removal exists and is scoped to Heli-owned host artifacts. |
| Automated E2E | Repository automation exercises lifecycle or linked-project behavior. |
| Live-host proof | Evidence came from the actual host/runtime rather than only synthetic/local simulation. |
| Distribution current | Source/package metadata is aligned with the Heli release train; registry/catalog publication is tracked separately. |

Legend: **Yes** = implemented and repository-tested; **Partial** = implemented with an explicit evidence limitation; **Manual** = host-specific operator step remains; **No** = not implemented/proven.

## Current lifecycle support

| Host | Runtime integration | Fresh install | Global discovery | Linked project | Update / repair | Remove | Automated E2E | Live-host proof | Distribution current |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Pi** | Yes — extension hooks/guards | Yes | Yes | Yes | Yes | Yes | Yes — linked install regression + runtime smoke | Partial — repository runtime smoke; external installed-package refresh still release-dependent | **Source current**; public package/catalog must be refreshed by the next release |
| **Claude Code** | Yes — plugin hooks/skills | Yes | Yes | Yes | Yes | Yes | Yes — adapter/plugin smokes | Yes — `live-verify-claude-plugin.mjs` | Yes in repository artifacts |
| **Codex** | Yes — plugin hooks/skills | Yes | Yes | Yes | Yes | Yes | Yes — adapter/plugin smokes | Yes — install/hook live verify scripts | Yes in repository artifacts |
| **Grok Build** | Yes — user hooks + skills | Yes | Yes | Yes | Yes | Yes | Yes — hook/plugin smokes | Yes — `live-verify-grok-hooks.mjs` | Yes in repository artifacts |
| **OpenCode** | Yes — JS plugin | Yes | Yes | Yes | Yes | Yes | Yes — lifecycle namespacing + plugin smoke | Yes — `live-verify-opencode-plugin.mjs` | Yes in repository artifacts |
| **Kimi Code CLI** | Yes — user hooks | Yes | Yes | Yes | Yes | Yes | Yes — delimited-config lifecycle + plugin smoke | Yes — `live-verify-kimi-hooks.mjs` | Yes in repository artifacts |
| **Cursor** | Partial — plugin/rules/skills, no runtime guard proof | Yes | Yes | Yes for packaged context/skills | Yes | Yes | Yes — plugin/lifecycle smoke | No | Yes in repository artifacts |
| **AXGA** | Partial — Pi-compatible package surface | Yes | Yes | Yes by shared Pi package model | Yes | Yes | Partial — host-manager lifecycle only | No dedicated AXGA live proof | Source current; dedicated catalog proof not established |
| **Antigravity CLI** | Partial — packaged plugin + synthetic hooks | Conditional | Yes when plugin parent is configured | Yes | Conditional | Conditional | Yes — synthetic plugin/lifecycle smoke | No | Yes in repository artifacts |
| **Generic** | Manual instruction adapter | Manual | Manual | Yes conceptually | Manual | Manual | No host-native E2E | No | N/A |

### Host-specific limits

**Pi.** `/heli-install` now means “link this project to global Heli” and must not create a local `.heli-harness/`. Embedded/hermetic installation is explicitly `/heli-legacy-install`. The package version is sourced from root `package.json`; a new release is required to replace any older package/catalog copy already installed or published outside this repository.

**Claude Code.** Managed install resolves the plugin from the globally installed Heli package. Direct project-local plugin installation is compatibility/dogfood only.

**Codex.** The default path uses the Git marketplace `KJ-AIML/heli-harness` plus `heli-harness@heli-harness`; nested workspace marketplace paths are compatibility/dogfood only.

**Grok Build.** Heli owns `~/.grok/hooks/heli-harness.json`. Plugin inventory alone does not prove that Grok invoked the hook. Removal deletes only the Heli hook file/plugin.

**OpenCode.** Global installation uses a Heli-owned `heli-harness-bundle/` plus a thin `heli-harness.js` wrapper. This avoids copying `shared/` into the common OpenCode plugin directory and preserves unrelated user plugins.

**Kimi Code CLI.** Heli writes a delimited hook block in Kimi config. Update is idempotent; remove strips only that block and preserves unrelated configuration.

**Cursor.** Managed lifecycle covers the Heli-owned local-user plugin directory. The packaged rules/skills are wired, but no runtime enforcement claim is made.

**Antigravity CLI.** The host plugin location is version-specific. Set `HELI_ANTIGRAVITY_PLUGIN_DIR` to the host plugin **parent** directory; Heli manages only its `heli-harness/` child. No live-host proof exists yet.

**AXGA / Generic.** AXGA follows the Pi-compatible package surface but lacks dedicated live-host evidence. Generic remains an instruction-only fallback and must not be presented as equivalent to a native managed host integration.

## Runtime evidence rule

Installation status, file presence, a package version receipt, and project binding are descriptive facts. They are never promoted automatically to runtime enforcement proof.

After opening a linked project in a host, inspect session evidence with:

```bash
heli explain capabilities
```

Live checks for supported native hooks exercise bounded behaviors such as remote-push denial and environment-file-write denial in isolated workspaces. Heli remains a governance guardrail, not a sandbox or universal host security boundary.

## Maintainer verification

`npm run check` includes host-manager lifecycle smoke, fresh linked-project migration coverage, Pi install-regression coverage, adapter/package validation, and release/version convergence gates. Maintainer-only `scripts/live-verify-*.mjs` commands may consume provider usage and are not end-user setup steps.
