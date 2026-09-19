import { readSession, writeSession } from "./session.mjs";

export const DEFAULT_RUNTIME_OBSERVATION_TTL_SECONDS = 3600;

function positiveSeconds(value, fallback) {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function runtimeObservationStatus(observation, {
	now = Date.now(),
	host = null,
	hostSessionId = null,
	runtimeInstanceId = null,
	adapterDigest = null,
	configHash = null,
} = {}) {
	if (!observation || observation.observed !== true) return { current: false, reason: "NOT_OBSERVED" };
	const observedAt = Date.parse(observation.observedAt || "");
	if (Number.isNaN(observedAt)) return { current: false, reason: "INVALID_OBSERVED_AT" };
	const validUntil = Date.parse(observation.validUntil || "");
	if (!Number.isNaN(validUntil) && now > validUntil) return { current: false, reason: "OBSERVATION_EXPIRED" };
	if (host && observation.host && String(observation.host) !== String(host)) return { current: false, reason: "HOST_MISMATCH" };
	if (hostSessionId && observation.hostSessionId && String(observation.hostSessionId) !== String(hostSessionId)) return { current: false, reason: "HOST_SESSION_MISMATCH" };
	if (runtimeInstanceId && observation.runtimeInstanceId && String(observation.runtimeInstanceId) !== String(runtimeInstanceId)) return { current: false, reason: "RUNTIME_INSTANCE_MISMATCH" };
	if (adapterDigest && observation.adapterDigest && String(observation.adapterDigest) !== String(adapterDigest)) return { current: false, reason: "ADAPTER_DIGEST_MISMATCH" };
	if (configHash && observation.configHash && String(observation.configHash) !== String(configHash)) return { current: false, reason: "CONFIG_HASH_MISMATCH" };
	return { current: true, reason: "CURRENT" };
}

export function observeRuntimeCapability(workspaceRoot, sessionId, {
	host = "unknown",
	capability,
	source = "hook",
	at = new Date().toISOString(),
	details = null,
	hostVersion = process.env.HELI_HOST_VERSION || null,
	adapterVersion = process.env.HELI_ADAPTER_VERSION || null,
	adapterDigest = process.env.HELI_ADAPTER_DIGEST || null,
	runtimeInstanceId = process.env.HELI_RUNTIME_INSTANCE_ID || null,
	configHash = process.env.HELI_CONFIG_HASH || null,
	ttlSeconds = process.env.HELI_CAPABILITY_OBSERVATION_TTL_SECONDS || DEFAULT_RUNTIME_OBSERVATION_TTL_SECONDS,
} = {}) {
	if (!workspaceRoot || !sessionId || !capability) return null;
	const session = readSession(workspaceRoot, sessionId);
	if (!session) return null;
	const ttl = positiveSeconds(ttlSeconds, DEFAULT_RUNTIME_OBSERVATION_TTL_SECONDS);
	const observedAtMs = Date.parse(at);
	if (Number.isNaN(observedAtMs)) return null;
	const validUntil = new Date(observedAtMs + ttl * 1000).toISOString();
	const runtime = session.runtimeAttestation && typeof session.runtimeAttestation === "object" ? { ...session.runtimeAttestation } : {};
	const observed = runtime.observedCapabilities && typeof runtime.observedCapabilities === "object" ? { ...runtime.observedCapabilities } : {};
	observed[capability] = {
		observed: true,
		host,
		hostVersion,
		hostSessionId: session.externalHostSessionId || null,
		adapterVersion,
		adapterDigest,
		runtimeInstanceId,
		configHash,
		source,
		observedAt: at,
		validUntil,
		...(details != null ? { details } : {}),
	};
	session.runtimeAttestation = {
		...runtime,
		host,
		hostVersion,
		adapterVersion,
		adapterDigest,
		runtimeInstanceId,
		configHash,
		lastObservedAt: at,
		observedCapabilities: observed,
	};
	return writeSession(workspaceRoot, session);
}

export function observedCapabilityMap(session) {
	return session?.runtimeAttestation?.observedCapabilities || {};
}

export function currentObservedCapabilityMap(session, criteria = {}) {
	if (!session || String(session.status || "") !== "active") return {};
	const current = {};
	for (const [name, observation] of Object.entries(observedCapabilityMap(session))) {
		const status = runtimeObservationStatus(observation, criteria);
		if (status.current) current[name] = { ...observation, current: true, currentReason: status.reason };
	}
	return current;
}
