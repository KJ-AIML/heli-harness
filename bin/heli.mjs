#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runInstall } from "../lib/cli/install.mjs";
import { runUpdate } from "../lib/cli/update.mjs";
import { runUninstall } from "../lib/cli/uninstall.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const [command, ...args] = process.argv.slice(2);

function usage() {
	console.error("Usage: heli <install|update|uninstall|target|status> [args]");
	process.exit(1);
}

if (!command) usage();

try {
	switch (command) {
		case "install":
			runInstall(packageRoot, args);
			break;
		case "update":
			runUpdate(packageRoot, args);
			break;
		case "uninstall":
			runUninstall(args);
			break;
		default:
			usage();
	}
} catch (error) {
	console.error(`Error: ${error.message}`);
	process.exit(1);
}
