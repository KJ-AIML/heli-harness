import { listActiveTasks } from "./task.mjs";
import { matchGlob } from "./paths.mjs";

/**
 * Advisory path-claim overlap detection between active tasks.
 */
export function detectPathClaimConflicts(workspaceRoot, { taskId = null } = {}) {
	const tasks = listActiveTasks(workspaceRoot);
	const focus = taskId ? tasks.filter((t) => t.taskId === taskId || true) : tasks;
	const conflicts = [];

	for (let i = 0; i < focus.length; i++) {
		for (let j = i + 1; j < focus.length; j++) {
			const a = focus[i];
			const b = focus[j];
			if (taskId && a.taskId !== taskId && b.taskId !== taskId) continue;
			const aOwns = a.pathClaims?.owns || [];
			const bOwns = b.pathClaims?.owns || [];
			const aShared = new Set(a.pathClaims?.shared || []);
			const bShared = new Set(b.pathClaims?.shared || []);

			for (const pa of aOwns) {
				for (const pb of bOwns) {
					const overlap = pathsOverlap(pa, pb);
					if (!overlap) continue;
					const explicitlyShared =
						aShared.has(pa) || aShared.has(pb) || bShared.has(pa) || bShared.has(pb);
					conflicts.push({
						severity: explicitlyShared ? "low" : "high",
						taskA: a.taskId,
						taskB: b.taskId,
						claimA: pa,
						claimB: pb,
						kind: "owns-owns",
						recommendation: explicitlyShared
							? "paths marked shared — coordinate carefully"
							: `Mark shared or assign one owner for overlapping paths (${pa} vs ${pb})`,
						explicitlyShared,
					});
				}
			}

			// forbidden crossings
			for (const forbidden of a.pathClaims?.forbidden || []) {
				for (const pb of bOwns) {
					if (pathsOverlap(forbidden, pb)) {
						conflicts.push({
							severity: "high",
							taskA: a.taskId,
							taskB: b.taskId,
							claimA: forbidden,
							claimB: pb,
							kind: "forbidden-owns",
							recommendation: `Task ${b.taskId} owns path forbidden by ${a.taskId}`,
						});
					}
				}
			}
		}
	}
	return conflicts;
}

function pathsOverlap(a, b) {
	const pa = String(a || "").replace(/\\/g, "/");
	const pb = String(b || "").replace(/\\/g, "/");
	if (!pa || !pb) return false;
	if (pa === pb) return true;
	// if either glob matches the other as a concrete path, or mutual prefix with **
	if (matchGlob(pa, pb) || matchGlob(pb, pa)) return true;
	// strip trailing /**
	const na = pa.replace(/\/\*\*$/, "").replace(/\*\*$/, "");
	const nb = pb.replace(/\/\*\*$/, "").replace(/\*\*$/, "");
	if (na && nb && (na.startsWith(nb + "/") || nb.startsWith(na + "/") || na === nb)) return true;
	return false;
}
