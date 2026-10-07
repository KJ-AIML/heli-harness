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
import { runExplain } from "../lib/cli/explain.mjs";
import { runTrace } from "../lib/cli/trace.mjs";
import { runSetup } from "../lib/cli/setup.mjs";
import { runLink } from "../lib/cli/link.mjs";
import { runGrant } from "../lib/cli/grant.mjs";
import { runHost } from "../lib/cli/host.mjs";
import { runHandoff } from "../lib/cli/handoff.mjs";
import { runResume } from "../lib/cli/resume.mjs";
import { hasHelpFlag, helpPathForInvocation, printHelp, renderHelp } from "../lib/cli/help.mjs";
import { runTargetMachine, runTaskMachine, runHandoffMachine, runDiagnosisMachine, runConflictsMachine } from "../lib/cli/machine.mjs";

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

function protocolJsonRequested(commandName, values) {
	if (values.includes("--output-json")) return true;
	const index = values.indexOf("--json");
	if (index < 0) return false;
	if (commandName !== "diagnosis") return true;
	const next = values[index + 1];
	// diagnosis historically uses --json <object> as its input payload.
	return !(next && String(next).trim().startsWith("{"));
}

function usage() {
	process.stderr.write(renderHelp([]));
	process.exit(1);
}

if (!command) usage();

if (command === "--help" || command === "-h") {
	printHelp([]);
	process.exit(0);
}

if (command === "help") {
	const topic = args.filter((value) => value !== "--help" && value !== "-h").slice(0, 2);
	process.exit(printHelp(topic) ? 0 : 1);
}

if (hasHelpFlag(args)) {
	process.exit(printHelp(helpPathForInvocation(command, args)) ? 0 : 1);
}

if (command === "--version" || command === "-v") {
	console.log(version());
	process.exit(0);
}

try {
	switch (command) {
		case "setup": runSetup(args); break;
		case "link": runLink(packageRoot, args); break;
		case "host": runHost(packageRoot, args); break;
		case "handoff": protocolJsonRequested(command, args) ? runHandoffMachine(args) : runHandoff(args); break;
		case "grant": runGrant(args); break;
		case "install": runInstall(packageRoot, args); break;
		case "update": runUpdate(packageRoot, args); break;
		case "uninstall": runUninstall(args); break;
		case "target": protocolJsonRequested(command, args) ? runTargetMachine(args) : runTarget(args); break;
		case "status": runStatus(args); break;
		case "resume": runResume(args); break;
		case "doctor": runDoctor(args); break;
		case "yolo": runYolo(args); break;
		case "task": protocolJsonRequested(command, args) ? runTaskMachine(args) : runTask(args); break;
		case "diagnosis": protocolJsonRequested(command, args) ? runDiagnosisMachine(args) : runDiagnosis(args); break;
		case "session": runSession(args); break;
		case "conflicts": protocolJsonRequested(command, args) ? runConflictsMachine(args) : runConflicts(args); break;
		case "explain": runExplain(args); break;
		case "trace": runTrace(args); break;
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
		default: usage();
	}
} catch (error) {
	if (protocolJsonRequested(command, args)) {
		process.stdout.write(`${JSON.stringify({ protocolVersion: 1, command, ok: false, data: null, warnings: [], errors: [{ code: error.code || "COMMAND_FAILED", message: error.message }] }, null, 2)}\n`);
	} else {
		console.error(`Error: ${error.message}`);
		if (error.code) console.error(`Code: ${error.code}`);
	}
	process.exit(1);
}
