# Ponytail Parity Audit

Scope: Heli-Harness v0.5.10 compared with local reference repo `D:\KJ\heli-governance-lab\repos\ponytail` at `16f6cbf`.

## Official And Local Evidence

Official docs consulted:

- Claude Code plugins: `https://docs.claude.com/en/docs/claude-code/plugins`
- Claude Code hooks: `https://docs.claude.com/en/docs/claude-code/hooks`
- Claude Code settings: `https://docs.claude.com/en/docs/claude-code/settings`
- Codex plugins: `https://developers.openai.com/codex/plugins`
- Codex plugin build docs: `https://developers.openai.com/codex/plugins/build`
- Codex hooks: `https://developers.openai.com/codex/hooks`
- Codex AGENTS.md docs: `https://developers.openai.com/codex/cli/configure`
- OpenCode plugins: `https://opencode.ai/docs/plugins`

Local CLI help checked:

- `claude --help`: exposes `--plugin-dir`, `--plugin-url`, `plugin|plugins`, `--include-hook-events`, and `--safe-mode`.
- `claude plugin --help`: exposes `validate`, `install`, `marketplace`, `tag`, `list`, `enable`, and `disable`.
- `codex --help`: exposes `plugin`, `--dangerously-bypass-hook-trust`, sandbox options, and config overrides.
- `codex plugin --help`: exposes `add`, `list`, `marketplace`, and `remove`.
- `codex hooks --help`: no standalone `hooks` subcommand; help falls back to top-level Codex help.

## Ponytail Plugin Files Found

Ponytail ships native/plugin artifacts for multiple hosts:

- Claude Code: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `hooks/claude-codex-hooks.json`, `hooks/*.js`, `commands/*.toml`, `skills/*/SKILL.md`.
- Codex: `.codex-plugin/plugin.json`, shared `hooks/claude-codex-hooks.json`, `hooks/*.js`, `skills/*/SKILL.md`, `AGENTS.md`.
- OpenCode: `opencode.json`, `.opencode/plugins/ponytail.mjs`, `.opencode/command/*.md`.
- Gemini: `gemini-extension.json`, `AGENTS.md`, `commands/*.toml`, `skills/*/SKILL.md`.
- Cursor: `.cursor/rules/ponytail.mdc`.
- Windsurf: `.windsurf/rules/ponytail.md`.
- Cline: `.clinerules/ponytail.md`.
- Copilot: `.github/copilot-instructions.md`, `.github/plugin/plugin.json`, `.github/plugin/marketplace.json`.
- Hermes: `plugin.yaml`, `__init__.py`.
- OpenClaw: `.openclaw/skills/*/SKILL.md`.

Evidence paths: `repos/ponytail/README.md`, `repos/ponytail/docs/agent-portability.md`, `repos/ponytail/.claude-plugin/plugin.json`, `repos/ponytail/.codex-plugin/plugin.json`, `repos/ponytail/hooks/claude-codex-hooks.json`.

## Ponytail Claude Code Mechanism

Ponytail uses `.claude-plugin/plugin.json` as the Claude plugin manifest and points hooks through `hooks/claude-codex-hooks.json`. The hook config includes `SessionStart`, `SubagentStart`, and `UserPromptSubmit` command hooks. Commands live in `commands/*.toml`; skills live in `skills/*/SKILL.md`.

Ponytail tests hook behavior locally in `tests/hooks.test.js` and command file presence in `tests/commands.test.js`.

## Ponytail Codex Mechanism

Ponytail uses `.codex-plugin/plugin.json` with `skills: "./skills/"`, `hooks: "./hooks/claude-codex-hooks.json"`, and `interface` metadata. It reuses the same hook scripts as Claude, switching output behavior when Codex plugin environment variables are present.

Evidence paths: `repos/ponytail/.codex-plugin/plugin.json`, `repos/ponytail/hooks/ponytail-runtime.js`, `repos/ponytail/tests/hooks.test.js`.

## Hooks, Commands, Skills Found

Hooks:

- `hooks/claude-codex-hooks.json`
- `hooks/copilot-hooks.json`
- `hooks/ponytail-activate.js`
- `hooks/ponytail-mode-tracker.js`
- `hooks/ponytail-subagent.js`
- `hooks/ponytail-runtime.js`
- `hooks/ponytail-instructions.js`

Commands:

- `commands/ponytail.toml`
- `commands/ponytail-review.toml`
- `commands/ponytail-audit.toml`
- `commands/ponytail-debt.toml`
- `commands/ponytail-gain.toml`
- `commands/ponytail-help.toml`
- `.opencode/command/*.md` equivalents

Skills:

- `skills/ponytail/SKILL.md`
- `skills/ponytail-review/SKILL.md`
- `skills/ponytail-audit/SKILL.md`
- `skills/ponytail-debt/SKILL.md`
- `skills/ponytail-gain/SKILL.md`
- `skills/ponytail-help/SKILL.md`

## Ponytail Install Flow

Ponytail documents:

- Claude Code: `/plugin marketplace add DietrichGebert/ponytail`, then `/plugin install ponytail@ponytail`.
- Codex: `codex plugin marketplace add DietrichGebert/ponytail`, then install from `/plugins`, review hooks in `/hooks`.
- OpenCode: add `@dietrichgebert/ponytail` or `./.opencode/plugins/ponytail.mjs` to `opencode.json`.
- Gemini: `gemini extensions install https://github.com/DietrichGebert/ponytail`.
- Pi: `pi install git:github.com/DietrichGebert/ponytail`.

Evidence path: `repos/ponytail/README.md`.

## Heli Equivalent Before v0.5.10

Before this release:

- Claude Code had pointer adapter files under `.heli-harness/adapters/claude/` and `scripts/smoke-claude-adapter.mjs`.
- Codex had pointer adapter files under `.heli-harness/adapters/codex/` and `scripts/smoke-codex-adapter.mjs`.
- Pi had runtime extension enforcement in `extensions/pi-extension.js`.
- Heli had no Claude or Codex native plugin package.

Evidence paths: `.heli-harness/adapters/adapters.json`, `docs/ADAPTER_SUPPORT_MATRIX.md`, `scripts/smoke-claude-adapter.mjs`, `scripts/smoke-codex-adapter.mjs`.

## Heli v0.5.10 Parity Result

Implemented:

- Claude plugin artifact root: `.heli-harness/adapters/claude-plugin/`.
- Claude plugin manifest: `.heli-harness/adapters/claude-plugin/.claude-plugin/plugin.json`.
- Claude plugin hooks: `.heli-harness/adapters/claude-plugin/hooks/hooks.json`.
- Claude plugin skill: `.heli-harness/adapters/claude-plugin/skills/heli-governance/SKILL.md`.
- Codex plugin artifact root: `.heli-harness/adapters/codex-plugin/`.
- Codex plugin manifest: `.heli-harness/adapters/codex-plugin/.codex-plugin/plugin.json`.
- Codex plugin hooks: `.heli-harness/adapters/codex-plugin/hooks/hooks.json`.
- Codex plugin skill and instructions: `.heli-harness/adapters/codex-plugin/skills/heli-governance/SKILL.md`, `.heli-harness/adapters/codex-plugin/AGENTS.md`.
- Plugin smoke tests: `scripts/smoke-claude-plugin.mjs`, `scripts/smoke-codex-plugin.mjs`.

## Heli Gaps

- No live Claude Code runtime hook execution/trust flow was completed.
- No live Codex runtime hook execution/trust flow was completed.
- No plugin marketplace publication is included.
- OpenCode, Gemini, Cursor, Windsurf, Cline, and Copilot CLI remain analysis/planned unless existing pointer docs already cover them.

## What Heli Copied Conceptually

- Keep plugin adapters thin and host-specific.
- Reuse shared governance text through skills/instructions rather than duplicating policy logic everywhere.
- Treat hook output as evidence only when locally invoked by smoke tests.
- Keep plugin artifacts near adapter evidence so support matrix claims can point to files.

## What Heli Did Not Copy

- Ponytail's mode-tracking runtime and statusline behavior are product-specific and not needed for Heli.
- Ponytail's many host packages were not copied; Heli v0.5.10 only implements Claude and Codex plugin artifacts.
- Ponytail's command suite was not copied because Heli already exposes workflow commands through the Pi extension and pointer adapters.
- Marketplace release metadata was not added because this release does not publish a Heli plugin marketplace entry.

## Status Decision

Claude Code and Codex are `verified-plugin-wired`, not `enforced`.

Reason: Heli now ships native plugin artifacts and local smoke tests, including synthetic PreToolUse deny decisions for `git push` and `.env` writes. Heli does not yet have live host runtime proof that Claude Code or Codex installed, trusted, and executed those hooks during an actual tool call.
