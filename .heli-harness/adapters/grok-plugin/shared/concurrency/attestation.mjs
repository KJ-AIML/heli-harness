import { readSession, writeSession } from "./session.mjs";

/**
 * Persist only capabilities observed from a live host hook invocation.
 * Installed files are never treated as runtime proof.
 */
export function observeRuntimeCapability(workspaceRoot, sessionId, {
	host = "unknown",
	capability,
	source = "hook",
	at = new Date().toISOString(),
	details = null,
} = {}) {
	if (!workspaceRoot || !sessionId || !capability) return null;
	const session = readSession(workspaceRoot, sessionId);
	if (!session) return null;
	const runtime = session.runtimeAttestation && typeof session.runtimeAttestation === "object"
		? { ...session.runtimeAttestation }
		: {};
	const observed = runtime.observedCapabilities && typeof runtime.observedCapabilities === "object"
		? { ...runtime.observedCapabilities }
		: {};
	observed[capability] = {
		observed: true,
		host,
		source,
		observedAt: at,
		...(details != null ? { details } : {}),
	};
	session.runtimeAttestation = {
		...runtime,
		host,
		lastObservedAt: at,
		observedCapabilities: observed,
	};
	return writeSession(workspaceRoot, session);
}

export function observedCapabilityMap(session) {
	return session?.runtimeAttestation?.observedCapabilities || {};
}
