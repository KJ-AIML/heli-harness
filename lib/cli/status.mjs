import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function readJson(path) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
}

function field(text, label) {
	const match = new RegExp(`^${label}:[ \\t]*(.*)$`, "m").exec(text);
	return match ? match[1].trim() : "";
}

export function status(cwd) {
	const heliDir = join(cwd, ".heli-harness");
	if (!existsSync(heliDir)) {
		return { installed: false };
	}
	const manifest = readJson(join(heliDir, "manifest.json"));
	const target = readJson(join(heliDir, "workspace", "target.json"));
	const index = readJson(join(heliDir, "workspace", "index.json"));
	const taskPath = join(heliDir, "state", "current-task.md");
	const taskText = existsSync(taskPath) ? readFileSync(taskPath, "utf8") : "";

	return {
		installed: true,
		version: manifest?.version || "unknown",
		targetRepo: target?.targetRepo || "",
		repoCount: Array.isArray(index?.repos) ? index.repos.length : 0,
		indexConfigured: !!index,
		taskStatus: taskText ? field(taskText, "Current status") : "",
		failedAttempts: taskText ? field(taskText, "Failed attempts count") : "",
	};
}

export function runStatus(args) {
	const cwd = args[0] || process.cwd();
	const result = status(cwd);
	if (!result.installed) {
		console.log(`No Heli-Harness install found at ${cwd}`);
		return;
	}
	console.log(`Heli-Harness version: ${result.version}`);
	console.log(`Target repo: ${result.targetRepo || "not selected"}`);
	console.log(result.indexConfigured ? `Registered repos: ${result.repoCount}` : "Workspace index: not configured");
	if (result.taskStatus) {
		console.log(`Current task status: ${result.taskStatus} (failed attempts: ${result.failedAttempts || "0"})`);
	} else {
		console.log("Current task: none recorded");
	}
}
