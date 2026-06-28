# Heli-Harness

Parent-workspace AI development harness for multi-repo, multi-agent engineering work.

## What is this?

Heli-Harness gives local coding agents (Claude Code, Codex, Cursor, Pi, generic) a shared source of truth: protocols, repo profiles, state tracking, optional hooks, and adapter instructions.

## Structure

- `HARNESS.md` — source of truth for agent behavior
- `manifest.json` — harness metadata
- `skills/` — 17 skills for agent workflows
- `adapters/` — agent-specific instructions (Codex, Claude, Cursor, Pi, Generic)
- `profiles/` — repo-specific profiles
- `state/` — task tracking and decisions
- `templates/` — profile templates
- `hooks/` — optional lifecycle hooks

## Install

See the main [README](../README.md) or [INSTALL](../INSTALL.md).

## Usage

Agents should read `HARNESS.md` as the source of truth before any substantive work.
