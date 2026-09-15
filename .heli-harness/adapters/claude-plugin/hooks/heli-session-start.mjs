#!/usr/bin/env node
process.env.HELI_ADAPTER_ID = "claude";
await import("../shared/claude-style-session-start.mjs");
