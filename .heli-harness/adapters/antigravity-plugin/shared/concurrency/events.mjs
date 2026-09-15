import { appendJsonl } from "./fs-atomic.mjs";
import { taskPaths } from "./paths.mjs";
import { newEventId } from "./ids.mjs";

export const EVENT_SCHEMA_VERSION = 2;

/**
 * Append a lifecycle event to tasks/<id>/events.jsonl.
 * v2 keeps legacy top-level payload fields for old readers while also storing
 * the exact payload under `payload` for deterministic machine consumers.
 */
export function appendTaskEvent(workspaceRoot, taskId, type, payload = {}) {
	const { eventsJsonl } = taskPaths(workspaceRoot, taskId);
	const eventPayload = payload && typeof payload === "object" && !Array.isArray(payload) ? { ...payload } : {};
	const record = {
		...eventPayload,
		eventSchemaVersion: EVENT_SCHEMA_VERSION,
		eventId: newEventId(),
		type,
		taskId,
		sessionId: eventPayload.sessionId || null,
		at: new Date().toISOString(),
		payload: eventPayload,
	};
	appendJsonl(eventsJsonl, record);
	return record;
}
