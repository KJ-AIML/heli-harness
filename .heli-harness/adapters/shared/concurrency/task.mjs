import {
	ensureDir,
	pathExists,
	readJson,
	readText,
	writeJsonAtomic,
	writeTextAtomic,
	listDirNames,
} from "./fs-atomic.mjs";
import { pathsFor, taskPaths, gitBranch, gitRevParse, canonicalizePath } from "./paths.mjs";
import { fingerprintSource, slugTaskId } from "./ids.mjs";
import { TASK_SCHEMA_VERSION, writeWorkspaceSchema, readWorkspaceSchema } from "./schema.mjs";
import { appendTaskEvent } from "./events.mjs";

export function listTaskIds(workspaceRoot) {
	const { tasksDir } = pathsFor(workspaceRoot);
	return listDirNames(tasksDir).filter((id) => pathExists(taskPaths(workspaceRoot, id).taskJson));
}

export function readTask(workspaceRoot, taskId) {
	const p = taskPaths(workspaceRoot, taskId).taskJson;
	return readJson(p, null);
}

export function listTasks(workspaceRoot) {
	return listTaskIds(workspaceRoot)
		.map((id) => readTask(workspaceRoot, id))
		.filter(Boolean);
}

export function listActiveTasks(workspaceRoot) {
	return listTasks(workspaceRoot).filter((t) => {
		const s = String(t.status || "").toLowerCase();
		return s && s !== "complete" && s !== "closed" && s !== "abandoned" && s !== "cancelled";
	});
}

function ensureTaskDirs(workspaceRoot, taskId) {
	const tp = taskPaths(workspaceRoot, taskId);
	ensureDir(tp.dir);
	ensureDir(tp.reportsDir);
	ensureDir(tp.runsDir);
	ensureDir(tp.evidenceDir);
	return tp;
}

function defaultCurrentTaskMd(task) {
	return `# Current Task

Target repo: ${task.target?.repositoryId || ""}

Task: ${task.title || task.taskId}

Mode: ${task.mode || "strict"}

Risk tier: S1

Plan: ${task.source?.planPath || "n/a"}

Step count: 0

Files expected to change:
- (none yet)

Dirty files observed:
- (none yet)

Planned verification:
- (none yet)

Relevant skills consulted:
- none

Current status: ${task.status || "active"}

Failed attempts count: 0

Next smallest action: begin work on ${task.taskId}

Task ID: ${task.taskId}
`;
}

/**
 * Find active tasks that look like duplicates of the proposed work item.
 */
export function findDuplicateTasks(workspaceRoot, { workItemKey, planPath, repositoryId, fingerprint }) {
	const fp =
		fingerprint ||
		fingerprintSource({ planPath, workItemKey, repositoryId });
	const key = String(workItemKey || "").toLowerCase();
	return listActiveTasks(workspaceRoot).filter((t) => {
		const s = t.source || {};
		// Exact work-item fingerprint match (plan + key + repo — not title).
		if (s.fingerprint && s.fingerprint === fp) return true;
		// Same work-item key in the same repository (and plan when provided).
		if (key && String(s.workItemKey || "").toLowerCase() === key) {
			const sameRepo =
				repositoryId &&
				String(t.target?.repositoryId || "").toLowerCase() === String(repositoryId).toLowerCase();
			if (!sameRepo) return false;
			if (planPath) {
				return String(s.planPath || "").toLowerCase() === String(planPath).toLowerCase();
			}
			return true;
		}
		return false;
	});
}

/**
 * Create a durable task namespace and switch workspace to concurrent mode.
 */
export function createTask(workspaceRoot, {
	taskId,
	title,
	status = "active",
	mode = "strict",
	programId = null,
	parentTaskId = null,
	workItemKey = null,
	planPath = null,
	repositoryId = "",
	repositoryPath = "",
	worktreePath = "",
	branch = null,
	baseSha = null,
	pathClaims = null,
	allowDuplicate = false,
	sessionId = null,
} = {}) {
	const id = slugTaskId(taskId);
	const existing = readTask(workspaceRoot, id);
	if (existing) {
		const err = new Error(`task already exists: ${id}`);
		err.code = "TASK_EXISTS";
		err.task = existing;
		throw err;
	}

	const fp = fingerprintSource({
		planPath,
		workItemKey: workItemKey || id,
		repositoryId,
	});
	const dups = findDuplicateTasks(workspaceRoot, {
		workItemKey: workItemKey || id,
		planPath,
		repositoryId,
		fingerprint: fp,
	});
	if (dups.length && !allowDuplicate) {
		const err = new Error(
			`duplicate work detected: active task(s) ${dups.map((d) => d.taskId).join(", ")} match work-item/fingerprint. Use --allow-duplicate to force, or attach to the existing task.`,
		);
		err.code = "DUPLICATE_WORK";
		err.duplicates = dups;
		throw err;
	}

	const now = new Date().toISOString();
	const wt = worktreePath ? canonicalizePath(worktreePath) : "";
	const task = {
		schemaVersion: TASK_SCHEMA_VERSION,
		taskId: id,
		title: title || id,
		status,
		programId,
		parentTaskId,
		source: {
			planPath: planPath || null,
			workItemKey: workItemKey || id,
			fingerprint: fp,
		},
		target: {
			repositoryId: repositoryId || "",
			repositoryPath: repositoryPath || "",
			worktreePath: wt,
			branch: branch || (wt ? gitBranch(wt) : null),
			baseSha: baseSha || (wt ? gitRevParse(wt, "HEAD") : null),
			headSha: null,
		},
		mode: mode === "yolo" || mode === "unguarded" || mode === "dangerous" ? mode : "strict",
		revision: 1,
		pathClaims: pathClaims || { owns: [], reads: [], shared: [], forbidden: [] },
		yolo: { enabled: mode === "yolo" || mode === "unguarded" || mode === "dangerous" },
		createdAt: now,
		updatedAt: now,
	};

	const tp = ensureTaskDirs(workspaceRoot, id);
	writeJsonAtomic(tp.taskJson, task);
	writeTextAtomic(tp.currentTaskMd, defaultCurrentTaskMd(task));
	if (!pathExists(tp.planMd)) writeTextAtomic(tp.planMd, `# Plan: ${task.title}\n\n`);
	if (!pathExists(tp.decisionsMd)) writeTextAtomic(tp.decisionsMd, `# Decisions — ${task.taskId}\n\n`);

	// concurrent mode on first task create
	const schema = readWorkspaceSchema(workspaceRoot);
	if (schema.mode !== "concurrent") {
		writeWorkspaceSchema(workspaceRoot, { mode: "concurrent" });
	}

	appendTaskEvent(workspaceRoot, id, "task_created", {
		sessionId,
		title: task.title,
		workItemKey: task.source.workItemKey,
		fingerprint: task.source.fingerprint,
		allowDuplicate: !!allowDuplicate,
	});

	return task;
}

/**
 * CAS update of task.json — expectedRevision must match.
 */
export function updateTask(workspaceRoot, taskId, mutator, { expectedRevision, sessionId = null } = {}) {
	const current = readTask(workspaceRoot, taskId);
	if (!current) {
		const err = new Error(`task not found: ${taskId}`);
		err.code = "TASK_NOT_FOUND";
		throw err;
	}
	if (expectedRevision != null && current.revision !== expectedRevision) {
		const err = new Error(
			`task revision conflict: expected ${expectedRevision}, found ${current.revision}`,
		);
		err.code = "REVISION_CONFLICT";
		err.task = current;
		throw err;
	}
	const next = mutator({ ...current, target: { ...current.target }, source: { ...current.source }, pathClaims: { ...(current.pathClaims || {}) } });
	next.revision = (current.revision || 0) + 1;
	next.updatedAt = new Date().toISOString();
	next.taskId = current.taskId;
	writeJsonAtomic(taskPaths(workspaceRoot, taskId).taskJson, next);
	appendTaskEvent(workspaceRoot, taskId, "task_state_updated", {
		sessionId,
		fromRevision: current.revision,
		toRevision: next.revision,
	});
	return next;
}

export function writeTaskMarkdown(workspaceRoot, taskId, { currentTaskMd, planMd, decisionsMd } = {}) {
	const tp = taskPaths(workspaceRoot, taskId);
	if (currentTaskMd != null) writeTextAtomic(tp.currentTaskMd, currentTaskMd);
	if (planMd != null) writeTextAtomic(tp.planMd, planMd);
	if (decisionsMd != null) writeTextAtomic(tp.decisionsMd, decisionsMd);
}

export function readTaskMarkdown(workspaceRoot, taskId) {
	const tp = taskPaths(workspaceRoot, taskId);
	return {
		currentTaskMd: readText(tp.currentTaskMd, ""),
		planMd: readText(tp.planMd, ""),
		decisionsMd: readText(tp.decisionsMd, ""),
	};
}

export function setTaskYolo(workspaceRoot, taskId, enabled, { sessionId = null, expectedRevision } = {}) {
	const task = updateTask(
		workspaceRoot,
		taskId,
		(t) => {
			t.yolo = { ...(t.yolo || {}), enabled: !!enabled, updatedAt: new Date().toISOString() };
			if (enabled) t.mode = "yolo";
			else if (t.mode === "yolo" || t.mode === "unguarded" || t.mode === "dangerous") t.mode = "strict";
			return t;
		},
		{ expectedRevision, sessionId },
	);
	appendTaskEvent(workspaceRoot, taskId, "yolo_changed", { sessionId, enabled: !!enabled });
	return task;
}

export function setTaskTarget(workspaceRoot, taskId, targetPatch, { sessionId = null, expectedRevision } = {}) {
	const task = updateTask(
		workspaceRoot,
		taskId,
		(t) => {
			t.target = { ...t.target, ...targetPatch };
			if (targetPatch.worktreePath) t.target.worktreePath = canonicalizePath(targetPatch.worktreePath);
			return t;
		},
		{ expectedRevision, sessionId },
	);
	appendTaskEvent(workspaceRoot, taskId, "target_changed", { sessionId, target: task.target });
	return task;
}

/**
 * Import legacy global state into one task and enable concurrent mode.
 */
export function migrateLegacyTask(workspaceRoot, taskId, { title, repositoryId } = {}) {
	const { legacyTaskPath, legacyPlanPath, legacyDecisionsPath, legacyYoloPath, targetPath } = pathsFor(workspaceRoot);
	const id = slugTaskId(taskId);
	if (readTask(workspaceRoot, id)) {
		const err = new Error(`task already exists: ${id}`);
		err.code = "TASK_EXISTS";
		throw err;
	}
	const legacyTask = readText(legacyTaskPath, "");
	const legacyPlan = readText(legacyPlanPath, "");
	const legacyDecisions = readText(legacyDecisionsPath, "");
	const target = readJson(targetPath, {});
	const yolo = readJson(legacyYoloPath, null);

	const task = createTask(workspaceRoot, {
		taskId: id,
		title: title || "Migrated legacy task",
		workItemKey: id,
		repositoryId: repositoryId || target?.targetRepo || "",
		repositoryPath: target?.targetGitRoot || "",
		mode: yolo?.enabled ? "yolo" : "strict",
		allowDuplicate: true,
	});

	const tp = taskPaths(workspaceRoot, id);
	if (legacyTask.trim()) writeTextAtomic(tp.currentTaskMd, legacyTask);
	if (legacyPlan.trim()) writeTextAtomic(tp.planMd, legacyPlan);
	if (legacyDecisions.trim()) writeTextAtomic(tp.decisionsMd, legacyDecisions);

	appendTaskEvent(workspaceRoot, id, "task_migrated_from_legacy", {});
	writeConcurrentProjection(workspaceRoot);
	return readTask(workspaceRoot, id);
}

/**
 * Neutral or single-task projection into legacy state/current-task.md location.
 * One-way: never authoritative in concurrent mode.
 */
export function writeConcurrentProjection(workspaceRoot) {
	const active = listActiveTasks(workspaceRoot);
	const { legacyTaskPath, stateDir } = pathsFor(workspaceRoot);
	ensureDir(stateDir);
	if (active.length === 0) {
		writeTextAtomic(
			legacyTaskPath,
			`# Current Task\n\nConcurrent task mode is active.\nActive tasks: 0.\nUse \`heli task list\` or bind a session before write work.\n\nCurrent status: idle\n\nFailed attempts count: 0\n`,
		);
		return;
	}
	if (active.length === 1) {
		const md = readText(taskPaths(workspaceRoot, active[0].taskId).currentTaskMd, "");
		const header = `<!-- Heli concurrent projection of task ${active[0].taskId}; authoritative copy is under tasks/${active[0].taskId}/ -->\n`;
		writeTextAtomic(legacyTaskPath, header + md);
		return;
	}
	const lines = [
		"# Current Task",
		"",
		"Concurrent task mode is active.",
		`Active tasks: ${active.length}.`,
		"Use `heli task list`, `heli task show <id>`, or the bound session context.",
		"",
		"Active task ids:",
		...active.map((t) => `- ${t.taskId} (${t.status || "active"}) — ${t.title || ""}`),
		"",
		"Current status: multi-task",
		"",
		"Failed attempts count: 0",
		"",
	];
	writeTextAtomic(legacyTaskPath, lines.join("\n"));
}
