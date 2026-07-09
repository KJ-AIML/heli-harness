#!/usr/bin/env node
/**
 * Install Heli Grok user-level hooks into ~/.grok/hooks/heli-harness.json
 * with absolute paths to this package's hook scripts.
 *
 * Usage (from any cwd):
 *   node .heli-harness/adapters/grok-plugin/install-user-hooks.mjs
 *   node path/to/install-user-hooks.mjs
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const hooksDir = join(here, "hooks");
const pre = join(hooksDir, "heli-pre-tool-use.mjs").replaceAll("\\", "/");
const session = join(hooksDir, "heli-session-start.mjs").replaceAll("\\", "/");

if (!existsSync(pre) || !existsSync(session)) {
	console.error("Missing hook scripts next to install-user-hooks.mjs");
	process.exit(1);
}

const targetDir = join(homedir(), ".grok", "hooks");
mkdirSync(targetDir, { recursive: true });
const target = join(targetDir, "heli-harness.json");

// SessionStart must NOT include matcher (Grok v0 rejects lifecycle matchers).
const config = {
	hooks: {
		SessionStart: [
			{
				hooks: [
					{
						type: "command",
						command: `node "${session}"`,
						timeout: 5,
					},
				],
			},
		],
		PreToolUse: [
			{
				matcher: ".*",
				hooks: [
					{
						type: "command",
						command: `node "${pre}"`,
						timeout: 5,
					},
				],
			},
		],
	},
};

writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`, "utf8");
console.log(`Installed Grok user hooks -> ${target}`);
console.log("Verify with: grok inspect  (expect PreToolUse hooks loaded)");
console.log("Optional: also run  grok plugin install .heli-harness/adapters/grok-plugin --trust  for skills");
