import { existsSync, mkdtempSync, cpSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const PRESERVE_DIRS = ["profiles", "workspace", "policies", "safety"];

export function update(sourceHarnessDir, parentDir, { resetState = false } = {}) {
	const parentFull = resolve(parentDir);
	const target = join(parentFull, ".heli-harness");
	if (!existsSync(target)) {
		throw new Error(`Target harness does not exist: ${target}. Run install first.`);
	}

	const preserveDirs = resetState ? PRESERVE_DIRS : [...PRESERVE_DIRS, "state"];
	const tempPreserve = mkdtempSync(join(tmpdir(), "heli-update-preserve-"));

	for (const dir of preserveDirs) {
		const from = join(target, dir);
		if (existsSync(from)) {
			cpSync(from, join(tempPreserve, dir), { recursive: true, force: true });
		}
	}

	cpSync(sourceHarnessDir, target, { recursive: true, force: true });

	for (const dir of preserveDirs) {
		const preserved = join(tempPreserve, dir);
		if (existsSync(preserved)) {
			const targetDir = join(target, dir);
			rmSync(targetDir, { recursive: true, force: true });
			cpSync(preserved, targetDir, { recursive: true, force: true });
		}
	}
	rmSync(tempPreserve, { recursive: true, force: true });

	return { target, parentFull, preserveDirs };
}

export function runUpdate(packageRoot, args) {
	const resetState = args.includes("--reset-state");
	const parentArg = args.find((arg) => arg !== "--reset-state");
	const parentDir = parentArg || process.cwd();
	const sourceHarnessDir = join(packageRoot, ".heli-harness");
	if (!existsSync(sourceHarnessDir)) {
		throw new Error(`Source harness not found: ${sourceHarnessDir}`);
	}
	const result = update(sourceHarnessDir, parentDir, { resetState });
	console.log(`Updated Heli-Harness at ${result.target}`);
	if (!resetState) {
		console.log("Preserved local overlays: profiles/, workspace/, policies/, safety/, state/.");
		console.log("Use --reset-state to replace state/ from the repo checkout.");
	} else {
		console.log("Preserved local overlays: profiles/, workspace/, policies/, safety/.");
		console.log("state/ was replaced from the repo checkout (--reset-state).");
	}
	console.log("AGENTS.md and CLAUDE.md were not modified.");
}
