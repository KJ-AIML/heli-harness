#!/usr/bin/env node
/**
 * Append Heli PreToolUse/SessionStart hooks to ~/.kimi-code/config.toml
 * (or KIMI_CODE_HOME/config.toml). Idempotent: skips if marker present.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const pre = join(here, "hooks", "heli-pre-tool-use.mjs").replaceAll("\\", "/");
const session = join(here, "hooks", "heli-session-start.mjs").replaceAll("\\", "/");
const marker = "# --- heli-harness hooks ---";

const home = process.env.KIMI_CODE_HOME || join(homedir(), ".kimi-code");
mkdirSync(home, { recursive: true });
const configPath = join(home, "config.toml");

let existing = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
if (existing.includes(marker)) {
	console.log(`Heli hooks already present in ${configPath}`);
	process.exit(0);
}

// TOML: use single-quoted command strings so Windows paths with quotes are safe.
const block = `
${marker}
[[hooks]]
event = "PreToolUse"
matcher = ".*"
command = 'node "${pre}"'
timeout = 10

[[hooks]]
event = "SessionStart"
command = 'node "${session}"'
timeout = 10
`;

writeFileSync(configPath, `${existing.trimEnd()}\n${block}\n`, "utf8");
console.log(`Appended Heli hooks -> ${configPath}`);
console.log("Verify: kimi doctor config");
