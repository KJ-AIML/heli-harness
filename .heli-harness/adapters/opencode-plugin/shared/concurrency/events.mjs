import { appendJsonl } from "./fs-atomic.mjs";
import { taskPaths } from "./paths.mjs";
import { newEventId } from "./ids.mjs";

/**
 * Append a lifecycle event to tasks/<id>/events.jsonl
 */
export function appendTaskEvent(workspaceRoot, taskId, type, payload = {}) {
	const { eventsJsonl } = taskPaths(workspaceRoot, taskId);
	const record = {
		eventId: newEventId(),
		type,
		taskId,
		at: new Date().toISOString(),
		...payload,
	};
	appendJsonl(eventsJsonl, record);
	return record;
}
