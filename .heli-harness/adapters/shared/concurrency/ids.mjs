/**
 * Heli identity generators — never invented by the model.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";

export function newSessionId() {
	return `heli-ses-${randomUUID()}`;
}

export function newLeaseId() {
	return `heli-lease-${randomUUID()}`;
}

export function newEventId() {
	return `heli-evt-${randomUUID()}`;
}

export function hashCanonicalPath(canonicalPath) {
	return createHash("sha256").update(String(canonicalPath)).digest("hex").slice(0, 24);
}

export function slugTaskId(raw) {
	const s = String(raw || "")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64);
	if (!s) throw new Error("task id is empty after normalization");
	if (!/^[a-z0-9]/.test(s)) throw new Error(`task id must start with alphanumeric: ${s}`);
	return s;
}

export function fingerprintSource({ planPath, workItemKey, repositoryId, title }) {
	const parts = [
		String(planPath || "").toLowerCase(),
		String(workItemKey || "").toLowerCase(),
		String(repositoryId || "").toLowerCase(),
		String(title || "").toLowerCase().trim(),
	];
	return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

export function randomToken(bytes = 8) {
	return randomBytes(bytes).toString("hex");
}
