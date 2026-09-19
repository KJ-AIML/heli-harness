# Secret Handling

**Current release:** `v0.10.0`

## Required

- Secrets are never required policy memory.
- Do not print `.env` contents or token-bearing files into chat, logs, reports, or portable evidence bundles.
- Do not hardcode keys, tokens, or credentials into repo files.
- Credentials remain machine-local/trusted-secret-store state; project binding and portable evidence must not carry them.
- Record secret-handling approvals/evidence when relevant without copying the secret itself.

## Adapter support

- Host-specific secret enforcement depends on adapter support and the exact intercepted surface.
- Current Pi/AXGA guards detect obvious sensitive paths and obvious secret-like write content when compatible `tool_call` hooks expose the necessary structured input.
- Shared classifiers normalize common command/write forms before rule matching where supported.
- Missing structured input or unsupported shell effects must be reported as partial/advisory coverage, not silently upgraded to enforcement.
- This is conservative best-effort detection, not comprehensive secret scanning or a sandbox.

## Reporting guidance

- Note when secret-bearing files were inspected.
- Note whether values were redacted.
- Record the approval/grant or hard-deny outcome for risky secret-handling actions.
