# Security Policy

## Install Scripts

Inspect `install.ps1`, `install.sh`, `update.ps1`, `update.sh`, `uninstall.ps1`, and `uninstall.sh` before running them. They are intended to copy harness files and manage only the harness install directory.

## Hooks

Hooks are optional. No destructive hook should be enabled without explicit user review and consent.

Where a compatible host loads the bundled PreToolUse hook, its tested blocking scope is narrow: it denies remote Git pushes, environment-secret writes, and writes while task state is stuck or target-mismatched. The command tiers in `.heli-harness/safety/command-tiers.md` remain the policy reference. Hooks are guardrails, not a sandbox, and do not replace host permissions or review.

## Reporting a Vulnerability

To report a security issue, open a [GitHub Security Advisory](https://github.com/KJ-AIML/heli-harness/security/advisories/new) in this repository.

Do not open a public issue for security vulnerabilities.

We will acknowledge receipt within 72 hours and aim to ship a fix or mitigation within 14 days for confirmed issues.
