# Security Policy

## Install Scripts

Inspect `install.ps1`, `install.sh`, `update.ps1`, `update.sh`, `uninstall.ps1`, and `uninstall.sh` before running them. They are intended to copy harness files and manage only the harness install directory.

## Hooks

Hooks are optional. No destructive hook should be enabled without explicit user review and consent.

The bundled hook is a context-injection example. It should not edit files, run repo commands, deploy, delete, or block commands.

## Reporting a Vulnerability

To report a security issue, open a [GitHub Security Advisory](https://github.com/KJ-AIML/heli-harness/security/advisories/new) in this repository.

Do not open a public issue for security vulnerabilities.

We will acknowledge receipt within 72 hours and aim to ship a fix or mitigation within 14 days for confirmed issues.
