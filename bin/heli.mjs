#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { runInstall } from "../lib/cli/install.mjs";
import { runUpdate } from "../lib/cli/update.mjs";
import { runUninstall } from "../lib/cli/uninstall.mjs";
import { runTarget } from "../lib/cli/target.mjs";
import { runStatus } from "../lib/cli/status.mjs";
import { runDoctor } from "../lib/cli/doctor.mjs";
import { runYolo } from "../lib/cli/yolo.mjs";
import { runTask } from "../lib/cli/task.mjs";
import { runSession } from "../lib/cli/session-cmd.mjs";
import { runConflicts } from "../lib/cli/conflicts-cmd.mjs";
import { runCloud } from "../lib/cli/cloud.mjs";
import { runDiagnosis } from "../lib/cli/diagnosis.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const [command, ...args] = process.argv.slice(2);

function version() {
	const candidates = [join(packageRoot, "package.json"), join(packageRoot, ".heli-harness", "manifest.json")];
	for (const path of candidates) {
		if (!existsSync(path)) continue;
		try {
			const metadata = JSON.parse(readFileSync(path, "utf8"));
			if (typeof metadata.version === "string" && metadata.version) return metadata.version;
		} catch {
			// Try the next source; an installed workspace may only have its manifest.
		}
	}
	return "unknown";
}

function usage() {
	console.error(`Usage: heli <command> [args]

Commands:
  --version | -v  print the Heli-Harness version
  install | update | uninstall
  target | status | yolo
  doctor [path]  (workspace health: plugins, target, leases, sessions, sync)
  task create|list|show|migrate-legacy|claim|release|takeover
  diagnosis show|init|record|route|gate
  session start|attach|status|list|close
  conflicts [--task id]

  auth login|logout|status|devices     (cloud sync)
  ws create|link|unlink|list|versions|delete  (cloud sync; unlink = back to local-only)
  push | pull | sync [auto|e2e on|off] (cloud sync)
  init <name> [--dir p] [--clone]      (cloud sync: full device restore)

  heli yolo on|off|status [path] [--hours N]
`);
	process.exit(1);
}

if (!command) usage();

if (command === "--version" || command === "-v") {
	console.log(version());
	process.exit(0);
}

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
		case "doctor":
			runDoctor(args);
			break;
		case "yolo":
			runYolo(args);
			break;
		case "task":
			runTask(args);
			break;
		case "diagnosis":
			runDiagnosis(args);
			break;
		case "session":
			runSession(args);
			break;
		case "conflicts":
			runConflicts(args);
			break;
		case "auth":
		case "ws":
		case "push":
		case "pull":
		case "sync":
		case "init":
			runCloud(command, args, packageRoot).catch((error) => {
				console.error(`Error: ${error.message}`);
				process.exit(1);
			});
			break;
		default:
			usage();
	}
} catch (error) {
	console.error(`Error: ${error.message}`);
	if (error.code) console.error(`Code: ${error.code}`);
	process.exit(1);
}
