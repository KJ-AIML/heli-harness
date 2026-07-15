/**
 * Scope-aware YOLO resolution.
 * Ownership/lease gates must NEVER be bypassed by YOLO.
 */
import { pathExists, readJson, readText } from "./fs-atomic.mjs";
import { pathsFor, taskPaths } from "./paths.mjs";
import { readSession } from "./session.mjs";
import { readTask } from "./task.mjs";
import { isConcurrentMode } from "./schema.mjs";

function envTruthy(name, env = process.env) {
	return /^(1|true|yes|on)$/i.test(String(env[name] ?? "").trim());
}

function envGuardsOff(env = process.env) {
	return /^(0|false|off|disabled|yolo|none)$/i.test(String(env.HELI_GUARDS ?? "").trim());
}

function field(text, label) {
	const match = new RegExp(`^${label}:[ \\t]*(.*)$`, "m").exec(text || "");
	return match ? match[1].trim() : "";
}

/**
 * @returns {{ active: boolean, source?: string, safetyOnly: true }}
 * safetyOnly indicates YOLO only applies to legacy safety denials (push/env/stuck),
 * never ownership gates.
 */
export function resolveYolo({
	workspaceRoot,
	cwd,
	taskId = null,
	sessionId = null,
	env = process.env,
	legacyMode = null,
} = {}) {
	const root = workspaceRoot || cwd;
	const concurrent =
		legacyMode === false ? true : legacyMode === true ? false : root ? isConcurrentMode(root) : false;

	// 1. Granular process overrides — handled by callers via allowGitPush/allowEnvWrite
	// 2. Process-level HELI_YOLO / HELI_GUARDS
	if (envTruthy("HELI_YOLO", env)) return { active: true, source: "env:HELI_YOLO", safetyOnly: true };
	if (envGuardsOff(env)) return { active: true, source: "env:HELI_GUARDS", safetyOnly: true };

	// 3. Session setting
	if (root && sessionId) {
		const session = readSession(root, sessionId);
		if (session?.yolo?.enabled === true) {
			return { active: true, source: `session:${sessionId}`, safetyOnly: true };
		}
	}

	// 4. Task setting
	if (root && taskId) {
		const task = readTask(root, taskId);
		if (task?.yolo?.enabled === true || task?.mode === "yolo" || task?.mode === "unguarded" || task?.mode === "dangerous") {
			return { active: true, source: `task:${taskId}`, safetyOnly: true };
		}
		// also check task-local yolo.json
		const yoloPath = taskPaths(root, taskId).yoloJson;
		if (pathExists(yoloPath)) {
			const data = readJson(yoloPath, null);
			if (data?.enabled === true) {
				if (data.expiresAt) {
					const exp = Date.parse(data.expiresAt);
					if (!Number.isNaN(exp) && Date.now() > exp) {
						/* expired */
					} else {
						return { active: true, source: `task-file:${taskId}`, safetyOnly: true };
					}
				} else {
					return { active: true, source: `task-file:${taskId}`, safetyOnly: true };
				}
			}
		}
	}

	// 5. Legacy workspace yolo.json — only in legacy mode
	if (!concurrent && root) {
		const { legacyYoloPath, legacyTaskPath } = pathsFor(root);
		if (pathExists(legacyYoloPath)) {
			try {
				const data = readJson(legacyYoloPath, null);
				if (data?.enabled === true) {
					if (data.expiresAt) {
						const exp = Date.parse(data.expiresAt);
						if (!Number.isNaN(exp) && Date.now() > exp) {
							/* expired */
						} else {
							return { active: true, source: "state/yolo.json", safetyOnly: true };
						}
					} else {
						return { active: true, source: "state/yolo.json", safetyOnly: true };
					}
				}
			} catch {
				/* ignore */
			}
		}
		if (pathExists(legacyTaskPath)) {
			const mode = field(readText(legacyTaskPath, ""), "Mode").toLowerCase();
			if (mode === "yolo" || mode === "unguarded" || mode === "dangerous") {
				return { active: true, source: `current-task.md Mode: ${mode}`, safetyOnly: true };
			}
		}
	}

	// Concurrent mode: global yolo.json must NOT bleed across tasks
	// (explicitly ignored)

	return { active: false, safetyOnly: true };
}

export function allowGitPushScoped(opts) {
	const env = opts.env || process.env;
	if (envTruthy("HELI_ALLOW_GIT_PUSH", env)) return true;
	return resolveYolo(opts).active;
}

export function allowEnvWriteScoped(opts) {
	const env = opts.env || process.env;
	if (envTruthy("HELI_ALLOW_ENV_WRITE", env)) return true;
	return resolveYolo(opts).active;
}
