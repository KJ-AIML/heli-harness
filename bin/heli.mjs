#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runInstall } from "../lib/cli/install.mjs";
import { runUpdate } from "../lib/cli/update.mjs";
import { runUninstall } from "../lib/cli/uninstall.mjs";
import { runTarget } from "../lib/cli/target.mjs";
import { runStatus } from "../lib/cli/status.mjs";
import { runYolo } from "../lib/cli/yolo.mjs";
import { runTask } from "../lib/cli/task.mjs";
import { runSession } from "../lib/cli/session-cmd.mjs";
import { runConflicts } from "../lib/cli/conflicts-cmd.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const [command, ...args] = process.argv.slice(2);

function usage() {
	console.error(`Usage: heli <command> [args]

Commands:
  install | update | uninstall
  target | status | yolo
  task create|list|show|migrate-legacy|claim|release|takeover
  session start|attach|status|list|close
  conflicts [--task id]

  heli yolo on|off|status [path] [--hours N]
`);
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
		case "target":
			runTarget(args);
			break;
		case "status":
			runStatus(args);
			break;
		case "yolo":
			runYolo(args);
			break;
		case "task":
			runTask(args);
			break;
		case "session":
			runSession(args);
			break;
		case "conflicts":
			runConflicts(args);
			break;
		default:
			usage();
	}
} catch (error) {
	console.error(`Error: ${error.message}`);
	if (error.code) console.error(`Code: ${error.code}`);
	process.exit(1);
}
