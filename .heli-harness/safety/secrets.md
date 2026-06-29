# Secret Handling

## Required

- Secrets are never required policy memory.
- Do not print `.env` contents or token-bearing files into chat, logs, or reports.
- Do not hardcode keys, tokens, or credentials into repo files.
- Record secret-handling decisions in the run report when relevant.

## Adapter support

- Host-specific secret enforcement depends on adapter support.
- Hooks and guards can help, but local file review still matters.

## Reporting guidance

- Note when secret-bearing files were inspected.
- Note whether values were redacted.
- Record approvals for risky secret-handling actions.
