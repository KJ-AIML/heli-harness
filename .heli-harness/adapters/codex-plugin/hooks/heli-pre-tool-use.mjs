#!/usr/bin/env node
process.env.HELI_ADAPTER_ID = "codex";
await import("../shared/claude-style-pre-tool-use.mjs");
