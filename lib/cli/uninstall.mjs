import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

export function uninstall(parentDir) {
	const parentFull = resolve(parentDir);
	const target = join(parentFull, ".heli-harness");
	if (!existsSync(target)) {
		return { removed: false, target };
	}
	rmSync(target, { recursive: true, force: true });
	return { removed: true, target };
}

export function runUninstall(args) {
	const [parentArg] = args;
	const parentDir = parentArg || process.cwd();
	const result = uninstall(parentDir);
	if (!result.removed) {
		console.log(`No installed harness found at ${result.target}`);
		return;
	}
	console.log(`Removed Heli-Harness:\n  ${result.target}\n`);
	console.log("Manual cleanup:");
	console.log("  Review any AGENTS.md or CLAUDE.md snippets you created and remove them if no longer needed.");
	console.log("  Repos were not deleted.");
}
