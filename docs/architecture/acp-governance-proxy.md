# Experimental ACP v1 Governance Proxy

**Status:** Experimental integration; not part of the stable v0.10.0 governance-kernel contract.
**Current architecture:** [Current Heli architecture](README.md)

> This document describes an optional transport/proxy experiment. It must not be used to infer universal tool interception, sandboxing, or current core authority semantics.

Heli can sit between an ACP client/editor and an ACP agent without becoming the agent runtime:

```text
ACP Client -> heli-acp-proxy -> ACP Agent
                  |
                  +-> Heli task/session/lease/diagnosis guard
```

The prototype speaks stable ACP **v1** newline-delimited JSON-RPC and intentionally does not implement draft ACP v2. It forwards frames transparently except for `session/request_permission`: when Heli's existing deterministic PreToolUse guard returns a denial from structured ACP tool-call evidence, the proxy responds to the agent with a reject option (or `cancelled` when no reject option exists) instead of forwarding the permission request to the client.

```bash
node bin/heli-acp-proxy.mjs -- codex-acp
# or
node bin/heli-acp-proxy.mjs --cwd /path/to/workspace -- your-acp-agent --flag
```

For concurrent write authority, bind the Heli session explicitly (`HELI_SESSION_ID`) before launching the proxy. ACP session IDs are recorded as external host identities; they do not automatically grant a task or write lease.

## Truthful guarantees

- Stable ACP v1 JSON-RPC framing only.
- Heli does not infer missing `rawInput` or fabricate command arguments.
- Tool kind and ACP `locations` may still support target/ownership checks when raw input is absent.
- Permission requests observed at runtime are recorded as runtime capability evidence.
- Heli denials are recorded as local `guard.decision` task events.
- Allowed permission requests remain client/user decisions and are forwarded unchanged.
- This is not a sandbox and does not replace the ACP client's own permission UI or host isolation.
- ACP v2 remains draft and is out of scope for this prototype.
