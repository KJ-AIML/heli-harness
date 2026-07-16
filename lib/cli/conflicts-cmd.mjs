import { detectPathClaimConflicts } from "../concurrency/conflicts.mjs";
import { findWorkspaceRoot } from "../concurrency/paths.mjs";
import { listActiveTasks } from "../concurrency/task.mjs";

export function runConflicts(args) {
	let taskId = null;
	let cwd = process.cwd();
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--task" && args[i + 1]) taskId = args[++i];
		else if (!args[i].startsWith("-")) cwd = args[i];
	}
	const workspaceRoot = findWorkspaceRoot(cwd);
	if (!workspaceRoot) {
		console.log(`No Heli workspace from ${cwd}`);
		return;
	}
	const active = listActiveTasks(workspaceRoot);
	console.log(`Active tasks: ${active.length}`);
	for (const t of active) {
		const owns = (t.pathClaims?.owns || []).join(", ") || "(none)";
		console.log(`- ${t.taskId} owns: ${owns}`);
	}
	const conflicts = detectPathClaimConflicts(workspaceRoot, { taskId });
	if (!conflicts.length) {
		console.log("No path-claim overlaps detected.");
		return;
	}
	console.log(`Conflicts: ${conflicts.length}`);
	for (const c of conflicts) {
		console.log(
			`[${c.severity}] ${c.taskA} (${c.claimA}) ↔ ${c.taskB} (${c.claimB}) — ${c.recommendation}`,
		);
	}
}
