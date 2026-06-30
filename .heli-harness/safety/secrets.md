# Secret Handling

## Required

- Secrets are never required policy memory.
- Do not print `.env` contents or token-bearing files into chat, logs, or reports.
- Do not hardcode keys, tokens, or credentials into repo files.
- Record secret-handling decisions in the run report when relevant.

## Adapter support

- Host-specific secret enforcement depends on adapter support.
- Hooks and guards can help, but local file review still matters.
- Pi/AXGA v0.5.5 guard obvious secret paths such as `.env*`, key files, credential files, registry configs, and SSH private-key style paths where compatible `tool_call` hooks expose paths.
- Pi/AXGA v0.5.5 guard obvious secret-like write content such as common API key prefixes and private-key blocks where compatible `tool_call` hooks expose content.
- This is conservative best-effort detection, not comprehensive secret scanning.

## Reporting guidance

- Note when secret-bearing files were inspected.
- Note whether values were redacted.
- Record approvals for risky secret-handling actions.
