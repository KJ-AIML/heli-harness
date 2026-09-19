export const WORKFLOW_PROFILE_IDS = Object.freeze([
	"S0_QUERY",
	"S1_CHANGE",
	"S1_FIX",
	"S2_INVESTIGATION",
	"S3_HIGH_RISK",
]);

const IDS = new Set(WORKFLOW_PROFILE_IDS);

export function validateWorkflowProfiles(document) {
	const errors = [];
	if (!document || typeof document !== "object" || Array.isArray(document)) {
		return { valid: false, errors: ["workflow document must be an object"] };
	}
	if (document.schemaVersion !== 1) errors.push("workflow schemaVersion must be 1");
	const profiles = document.profiles;
	if (!profiles || typeof profiles !== "object" || Array.isArray(profiles)) {
		errors.push("profiles must be an object");
		return { valid: false, errors };
	}
	for (const id of WORKFLOW_PROFILE_IDS) {
		if (!profiles[id]) errors.push(`missing workflow profile: ${id}`);
	}
	for (const [id, profile] of Object.entries(profiles)) {
		if (!IDS.has(id)) errors.push(`unknown workflow profile: ${id}`);
		if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
			errors.push(`workflow ${id} must be an object`);
			continue;
		}
		if (!Array.isArray(profile.required) || profile.required.some((item) => typeof item !== "string" || !item)) {
			errors.push(`workflow ${id}.required must be a non-empty string array`);
		}
		if (profile.escalate != null && (typeof profile.escalate !== "object" || Array.isArray(profile.escalate))) {
			errors.push(`workflow ${id}.escalate must be an object when present`);
		}
	}
	return { valid: errors.length === 0, errors };
}

export function workflowProfile(document, id) {
	if (!IDS.has(id)) {
		const error = new Error(`unknown workflow profile: ${id}`);
		error.code = "UNKNOWN_WORKFLOW_PROFILE";
		throw error;
	}
	const validation = validateWorkflowProfiles(document);
	if (!validation.valid) {
		const error = new Error(`invalid workflow document: ${validation.errors.join("; ")}`);
		error.code = "INVALID_WORKFLOW_DOCUMENT";
		throw error;
	}
	return document.profiles[id];
}

export function defaultWorkflowFor({ riskTier = "S1", intent = "change" } = {}) {
	const risk = String(riskTier || "S1").toUpperCase();
	if (risk === "S3") return "S3_HIGH_RISK";
	if (risk === "S2") return "S2_INVESTIGATION";
	if (String(intent).toLowerCase() === "query") return "S0_QUERY";
	if (String(intent).toLowerCase() === "fix") return "S1_FIX";
	return "S1_CHANGE";
}
