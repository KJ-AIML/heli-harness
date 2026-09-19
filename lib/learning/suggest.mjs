import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listTaskIds, readTask } from "../concurrency/task.mjs";
import { taskPaths } from "../concurrency/paths.mjs";
import { readDiagnosis } from "../concurrency/diagnosis.mjs";

function id(kind, key) {
	return `learn-${createHash("sha256").update(`${kind}:${key}`).digest("hex").slice(0, 12)}`;
}

function readEvents(workspaceRoot, taskId) {
	const path = taskPaths(workspaceRoot, taskId).eventsJsonl;
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf8")
		.split("\n")
		.filter(Boolean)
		.flatMap((line) => {
			try { return [JSON.parse(line)]; } catch { return []; }
		});
}

function pushGroup(map, key, value) {
	if (!map.has(key)) map.set(key, []);
	map.get(key).push(value);
}

/**
 * Derive evidence-backed learning candidates from local durable task history.
 * This function is read-only. Candidates are proposals, never authority.
 */
export function suggestLearnings(workspaceRoot, { threshold = 2 } = {}) {
	const min = Math.max(2, Number(threshold) || 2);
	const guardGroups = new Map();
	const rootCauseGroups = new Map();
	const taskIds = listTaskIds(workspaceRoot);

	for (const taskId of taskIds) {
		const task = readTask(workspaceRoot, taskId);
		for (const event of readEvents(workspaceRoot, taskId)) {
			if (event.type !== "guard.decision" || event.decision?.effect !== "deny") continue;
			const code = String(event.decision?.code || "GOVERNANCE_DENIED");
			pushGroup(guardGroups, code, {
				taskId,
				eventId: event.eventId || null,
				at: event.at || null,
				host: event.decision?.host || null,
				toolName: event.decision?.toolName || null,
				reason: event.decision?.reason || null,
			});
		}
		const diagnosis = readDiagnosis(workspaceRoot, taskId);
		if (
			diagnosis?.rootCauseStatus === "ESTABLISHED" &&
			String(diagnosis.rootCause || "").trim() &&
			diagnosis.lastVerification?.outcome === "passed"
		) {
			const subsystem = String(diagnosis.responsibleSubsystem || "unknown").trim().toLowerCase();
			const rootCause = String(diagnosis.rootCause).trim();
			const key = `${subsystem}:${rootCause.toLowerCase()}`;
			pushGroup(rootCauseGroups, key, {
				taskId,
				repositoryId: task?.target?.repositoryId || null,
				diagnosisId: diagnosis.diagnosisId || null,
				responsibleSubsystem: diagnosis.responsibleSubsystem || null,
				rootCause,
				verificationRunId: diagnosis.lastVerification?.runId || null,
			});
		}
	}

	const candidates = [];
	for (const [code, evidence] of guardGroups) {
		const uniqueTasks = new Set(evidence.map((item) => item.taskId));
		if (evidence.length < min || uniqueTasks.size < 2) continue;
		candidates.push({
			candidateId: id("guard-pattern", code),
			kind: "procedure-review",
			key: `guard:${code}`,
			status: "candidate",
			autoApply: false,
			confidence: uniqueTasks.size >= 3 ? "high" : "medium",
			observation: `${code} was denied ${evidence.length} times across ${uniqueTasks.size} tasks.`,
			suggestion: "Review whether instructions, workflow routing, or a skill should prevent this repeated mistake earlier. Do not weaken the guard automatically.",
			suggestedDestinations: ["skill", "HARNESS.md", "profile", "decision"],
			evidence,
		});
	}
	for (const [key, evidence] of rootCauseGroups) {
		const uniqueTasks = new Set(evidence.map((item) => item.taskId));
		if (evidence.length < min || uniqueTasks.size < 2) continue;
		const sample = evidence[0];
		candidates.push({
			candidateId: id("verified-root-cause", key),
			kind: "verified-pattern-review",
			key: `root-cause:${key}`,
			status: "candidate",
			autoApply: false,
			confidence: uniqueTasks.size >= 3 ? "high" : "medium",
			observation: `The same established root cause was followed by passing verification in ${uniqueTasks.size} tasks.`,
			suggestion: `Review whether this ${sample.responsibleSubsystem || "subsystem"} pattern belongs in the repository profile, a reusable skill, or a durable engineering decision.`,
			suggestedDestinations: ["profile", "skill", "decision"],
			evidence,
		});
	}
	return {
		schemaVersion: 1,
		workspaceRoot,
		readOnly: true,
		autoApply: false,
		threshold: min,
		tasksScanned: taskIds.length,
		candidates: candidates.sort((a, b) => a.candidateId.localeCompare(b.candidateId)),
	};
}
