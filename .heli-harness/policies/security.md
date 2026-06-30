# Security Policy

Scope:

- Secret handling, sensitive files, risky commands, and externally visible actions.

## Required

- Treat secrets and credentials as sensitive even in local workspaces.
- Minimize exposure when investigating auth, keys, or config files.
- Record security-relevant decisions in the run report.

## Recommended

- Prefer redacted examples over real secret values.
- Use the smallest access needed for inspection or validation.
- Call out uncertain security assumptions explicitly.

## Forbidden

- Do not print `.env` contents, tokens, or private keys into logs or reports.
- Do not hardcode credentials into code, docs, or tests.
- Do not bypass safety prompts for destructive or secret-bearing actions.

## Requires approval

- Rotating secrets.
- Sharing sensitive logs outside the repo.
- Network operations that touch production systems or billable APIs.

## Exceptions

- None currently approved.
