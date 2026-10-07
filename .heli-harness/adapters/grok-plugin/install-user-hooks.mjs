#!/usr/bin/env node
/**
 * Install Heli Grok user-level hooks into ~/.grok/hooks/heli-harness.json
 * with absolute paths to this package's hook scripts.
 *
 * Usage (from any cwd):
 *   node .heli-harness/adapters/grok-plugin/install-user-hooks.mjs
 *   node path/to/install-user-hooks.mjs
 *
 * Duplicate rule (issue #35): a Heli plugin install (grok plugin install
 * heli-harness) already registers the same PreToolUse/SessionStart hooks and
 * Grok runs global + plugin hooks on every tool call. When the plugin's hook
 * config is present, this installer does not write the global hooks file —
 * the plugin is the source of truth; the global file is the fallback for
 * installs where the plugin is absent. --force writes the global file anyway.
 */

import { writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const hooksDir = join(here, "hooks");
const pre = join(hooksDir, "heli-pre-tool-use.mjs").replaceAll("\\", "/");
const session = join(hooksDir, "heli-session-start.mjs").replaceAll("\\", "/");
const sessionEnd = join(hooksDir, "heli-session-end.mjs").replaceAll("\\", "/");

if (!existsSync(pre) || !existsSync(session) || !existsSync(sessionEnd)) {
	console.error("Missing hook scripts next to install-user-hooks.mjs");
	process.exit(1);
}

const userHome = process.env.HELI_HOST_HOME || homedir();
const targetDir = join(userHome, ".grok", "hooks");
mkdirSync(targetDir, { recursive: true });
const target = join(targetDir, "heli-harness.json");

// The installed plugin's own hooks directory carries the identical hook config
// (hooks/hooks.json in the plugin root). Plugin installs live under
// ~/.grok/installed-plugins/<repo>/...; detect the config there rather than
// assuming one layout. The installer's own source tree is deliberately NOT a
// signal: shipping the plugin files is not the same as Grok registering them.
function findInstalledPluginHookConfig(startDirs) {
	for (const start of startDirs) {
		if (!existsSync(start)) continue;
		let queue = [start];
		while (queue.length) {
			const dir = queue.shift();
			let names;
			try {
				names = readdirSync(dir);
			} catch {
				continue;
			}
			if (names.includes("hooks.json")) {
				const candidate = join(dir, "hooks.json");
				try {
					const text = readFileSync(candidate, "utf8");
					if (text.includes("heli-pre-tool-use.mjs") && text.includes("heli-session-start.mjs")) return candidate;
				} catch {}
			}
			for (const name of names) {
				if (!["node_modules", ".git"].includes(name)) {
					try {
						if (readdirSync(join(dir, name)).length) queue.push(join(dir, name));
					} catch {}
				}
			}
		}
	}
	return null;
}

const pluginHookConfig = findInstalledPluginHookConfig([join(userHome, ".grok", "installed-plugins")]);
const force = process.argv.includes("--force");
if (pluginHookConfig && !force) {
	console.log(`Heli plugin hooks already registered via ${pluginHookConfig}`);
	console.log(`Global user hooks not installed (duplicate) -> ${target} skipped`);
	console.log("The plugin is the single Heli hook source; the global hooks file is a fallback for plugin-less installs.");
	console.log("Verify with: grok inspect  (expect PreToolUse hooks loaded)");
	console.log("To write the global hooks file anyway (two sources): rerun with --force.");
	process.exit(0);
}

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
						timeout: 30,
					},
				],
			},
		],
		// No matcher: every end reason, including a clean grok -p exit, closes the session.
		SessionEnd: [
			{
				hooks: [
					{
						type: "command",
						command: `node "${sessionEnd}"`,
						timeout: 5,
					},
				],
			},
		],
	},
};

writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`, "utf8");
console.log(`Installed Grok user hooks -> ${target}`);
if (pluginHookConfig) console.log(`Note: plugin hooks also present at ${pluginHookConfig} — Grok will run both; heli host repair grok removes one.`);
console.log("Verify with: grok inspect  (expect PreToolUse hooks loaded)");
console.log("Optional skills are managed by: heli host install grok");
