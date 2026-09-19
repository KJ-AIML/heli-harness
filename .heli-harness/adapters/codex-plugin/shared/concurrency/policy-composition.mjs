/**
 * Trusted policy composition.
 *
 * Built-in ceiling -> user/admin policy -> project policy.
 * Project content may narrow authority but cannot add grantable actions that the
 * trusted layers do not already allow.
 */
import { join } from "node:path";
import { pathExists, readJson, writeJsonAtomic } from "./fs-atomic.mjs";
import { globalConfigDir } from "./project-binding.mjs";
import { pathsFor } from "./paths.mjs";

export const POLICY_SCHEMA_VERSION = 1;

export const BUILTIN_POLICY = Object.freeze({
	schemaVersion: POLICY_SCHEMA_VERSION,
	grantableActions: Object.freeze([
		"git.push",
		"env.write",
		"command.approval.*",
	]),
	denyActions: Object.freeze([]),
	preferences: Object.freeze({}),
});

export function userPolicyPath(env = process.env) {
	return join(globalConfigDir(env), "policy.json");
}

export function projectPolicyPath(workspaceRoot) {
	return join(pathsFor(workspaceRoot).policiesDir, "policy.json");
}

export function ensureDefaultUserPolicy(env = process.env) {
	const path = userPolicyPath(env);
	if (!pathExists(path)) {
		writeJsonAtomic(path, {
			schemaVersion: POLICY_SCHEMA_VERSION,
			grantableActions: null,
			denyActions: [],
			preferences: {},
		});
	}
	return readJson(path, null);
}

function normalizeLayer(value, source) {
	const raw = value && typeof value === "object" ? value : {};
	return {
		source,
		schemaVersion: raw.schemaVersion || POLICY_SCHEMA_VERSION,
		grantableActions: Array.isArray(raw.grantableActions)
			? raw.grantableActions.map(String)
			: null,
		denyActions: Array.isArray(raw.denyActions) ? raw.denyActions.map(String) : [],
		preferences: raw.preferences && typeof raw.preferences === "object" ? { ...raw.preferences } : {},
	};
}

export function actionMatchesPattern(action, pattern) {
	const a = String(action || "");
	const p = String(pattern || "");
	if (!a || !p) return false;
	if (p === "*") return true;
	if (p.endsWith("*")) return a.startsWith(p.slice(0, -1));
	return a === p;
}

function actionAllowedByLayer(action, layer) {
	if (!Array.isArray(layer.grantableActions)) return true;
	return layer.grantableActions.some((pattern) => actionMatchesPattern(action, pattern));
}

function actionDeniedByLayer(action, layer) {
	return layer.denyActions.some((pattern) => actionMatchesPattern(action, pattern));
}

export function resolvePolicyComposition(workspaceRoot, { env = process.env } = {}) {
	const builtin = normalizeLayer(BUILTIN_POLICY, "builtin");
	const userRaw = readJson(userPolicyPath(env), null);
	const projectRaw = readJson(projectPolicyPath(workspaceRoot), null);
	const user = normalizeLayer(userRaw, "user");
	const project = normalizeLayer(projectRaw, "project");
	return {
		schemaVersion: POLICY_SCHEMA_VERSION,
		layers: [builtin, user, project],
		preferences: {
			...builtin.preferences,
			...user.preferences,
			...project.preferences,
		},
		provenance: {
			userPolicyPath: userPolicyPath(env),
			userPolicyPresent: Boolean(userRaw),
			projectPolicyPath: projectPolicyPath(workspaceRoot),
			projectPolicyPresent: Boolean(projectRaw),
		},
	};
}

export function evaluateGrantPolicy(workspaceRoot, action, { env = process.env } = {}) {
	const composition = resolvePolicyComposition(workspaceRoot, { env });
	const reasons = [];
	let hardDenied = false;
	let grantable = true;
	for (const layer of composition.layers) {
		if (actionDeniedByLayer(action, layer)) {
			hardDenied = true;
			grantable = false;
			reasons.push(`${layer.source}:deny`);
		}
		if (!actionAllowedByLayer(action, layer)) {
			grantable = false;
			reasons.push(`${layer.source}:outside-grantable-ceiling`);
		}
	}
	return {
		action,
		grantable,
		hardDenied,
		reasons,
		composition,
	};
}
