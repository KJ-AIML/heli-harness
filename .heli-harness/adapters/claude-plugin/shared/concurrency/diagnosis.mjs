/**
 * Lightweight claim -> evidence -> transition state for Heli vNext.
 *
 * This module deliberately does not execute work or interpret arbitrary logs.
 * Agents/hosts record structured observations; Heli validates the transition
 * prerequisites and keeps an append-only event trail.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appendJsonl, ensureDir, pathExists, readJson, writeJsonAtomic } from "./fs-atomic.mjs";
import { appendTaskEvent } from "./events.mjs";
import { pathsFor, taskPaths } from "./paths.mjs";

export const DIAGNOSIS_SCHEMA_VERSION = 1;
export const HYPOTHESIS_STATUSES = [
	"FACT",
	"SUPPORTED_HYPOTHESIS",
	"UNVERIFIED_HYPOTHESIS",
	"CONTRADICTED",
	"REJECTED",
	"UNKNOWN",
];
export const DIAGNOSIS_ROUTES = ["verify-premise", "debug", "fix-loop", "impact", "incident"];
export const ROOT_CAUSE_STATUSES = ["UNKNOWN", "PROPOSED", "ESTABLISHED", "INVALIDATED"];

const RISK_TIERS = new Set(["S0", "S1", "S2", "S3"]);
const TERMINAL_RUN_STATUSES = new Set(["passed", "failed", "blocked", "cancelled"]);

function now() {
	return new Date().toISOString();
}

function text(value) {
	return value == null ? "" : String(value).trim();
}

function lower(value) {
	return text(value).toLowerCase();
}

function required(value, label) {
	const valueText = text(value);
	if (!valueText) {
		const error = new Error(`${label} is required`);
		error.code = "DIAGNOSIS_EVIDENCE_REQUIRED";
		throw error;
	}
	return valueText;
}

function clone(value) {
	return value == null ? value : JSON.parse(JSON.stringify(value));
}

function newId(prefix) {
	return `heli-${prefix}-${randomUUID()}`;
}

function hash(value) {
	return createHash("sha256").update(String(value)).digest("hex").slice(0, 24);
}

function normalizeMessage(value) {
	return text(value)
		.toLowerCase()
		.replace(/[a-f0-9]{8,}/g, "<hex>")
		.replace(/[0-9]+/g, "<n>")
		.replace(/[/\\][^\s]+/g, "<path>")
		.replace(/\s+/g, " ")
		.trim();
}

function normalizeRiskTier(value, fallback = "S1") {
	const normalized = text(value).toUpperCase();
	return RISK_TIERS.has(normalized) ? normalized : fallback;
}

function boundary(value) {
	if (typeof value === "string") {
		return {
			statement: required(value, "closestProvenBoundary"),
			kind: "observed-fact",
			evidenceRef: null,
			observedAt: now(),
		};
	}
	if (!value || typeof value !== "object") return null;
	return {
		statement: required(value.statement || value.label || value.boundary, "closestProvenBoundary.statement"),
		kind: text(value.kind) || "observed-fact",
		evidenceRef: text(value.evidenceRef || value.source) || null,
		observedAt: value.observedAt || now(),
	};
}

function evidenceEntry(value, defaultKind = "supporting") {
	if (typeof value === "string") {
		return {
			kind: defaultKind,
			claim: required(value, "evidence.claim"),
			source: "explicit-agent-observation",
			observedAt: now(),
			current: true,
		};
	}
	if (!value || typeof value !== "object") {
		const error = new Error("evidence entry must be an object or string");
		error.code = "DIAGNOSIS_EVIDENCE_REQUIRED";
		throw error;
	}
	return {
		kind: text(value.kind) || defaultKind,
		claim: required(value.claim || value.statement, "evidence.claim"),
		source: required(value.source || value.reference, "evidence.source"),
		observedAt: value.observedAt || now(),
		validAt: value.validAt || null,
		runId: text(value.runId) || null,
		sourceSha: text(value.sourceSha) || null,
		current: value.current !== false,
	};
}

function addEvidence(list, entry) {
	const next = [...(Array.isArray(list) ? list : []), entry];
	return next.slice(-24);
}

function currentEvidence(list) {
	return (Array.isArray(list) ? list : []).filter((entry) => entry && entry.current !== false);
}

export function emptyDiagnosis(taskId = null) {
	return {
		schemaVersion: DIAGNOSIS_SCHEMA_VERSION,
		taskId: taskId || null,
		diagnosisId: null,
		active: false,
		phase: "IDLE",
		route: null,
		routeReason: null,
		activationReason: null,
		premiseStatus: "UNKNOWN",
		riskTier: "S1",
		symptom: null,
		failureSignature: null,
		previousFailureSignature: null,
		previousDiagnosis: null,
		previousFailureContext: null,
		closestProvenBoundary: null,
		responsibleSubsystem: null,
		currentHypothesis: null,
		hypothesisStatus: "UNKNOWN",
		evidence: { supporting: [], contradicting: [] },
		rootCause: null,
		rootCauseStatus: "UNKNOWN",
		proposedSmallestCausalChange: null,
		verificationPrediction: null,
		falsifier: null,
		previousFailedAction: null,
		materialChangeSincePreviousFailure: null,
		nextSmallestAction: null,
		attempts: { sameFailureClass: 0, implementationFailures: 0 },
		checkpointRequired: false,
		rerouteRequired: false,
		subsystemCheckpoint: null,
		lastDecision: null,
		lastRun: null,
		lastVerification: null,
		retryGate: null,
		independentReview: null,
		reviewRequirement: null,
	implementationBlocked: false,
	stateIntegrity: "valid",
	diagnosisError: null,
	revision: 0,
		lastTransition: null,
		updatedAt: null,
	};
}

export function normalizeDiagnosis(value, taskId = null) {
	const base = emptyDiagnosis(taskId || value?.taskId || null);
	if (!value || typeof value !== "object") return base;
	const next = {
		...base,
		...clone(value),
		taskId: taskId || value.taskId || null,
		evidence: {
			supporting: Array.isArray(value.evidence?.supporting) ? value.evidence.supporting : [],
			contradicting: Array.isArray(value.evidence?.contradicting) ? value.evidence.contradicting : [],
		},
		attempts: {
			...base.attempts,
			...(value.attempts || {}),
		},
	};
	return next;
}

export function diagnosisPathFor(workspaceRoot, taskId = null) {
	return taskId ? taskPaths(workspaceRoot, taskId).diagnosisJson : pathsFor(workspaceRoot).legacyDiagnosisPath;
}

function diagnosisEventsPathFor(workspaceRoot, taskId = null) {
	return taskId ? taskPaths(workspaceRoot, taskId).eventsJsonl : pathsFor(workspaceRoot).legacyDiagnosisEventsPath;
}

export function readDiagnosis(workspaceRoot, taskId = null) {
	const path = diagnosisPathFor(workspaceRoot, taskId);
	if (!pathExists(path)) return emptyDiagnosis(taskId);
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("diagnosis sidecar must contain an object");
		return normalizeDiagnosis(parsed, taskId);
	} catch {
		const invalid = emptyDiagnosis(taskId);
		invalid.active = true;
		invalid.diagnosisId = "invalid-diagnosis-state";
		invalid.phase = "INVALID_STATE";
		invalid.routeReason = "MALFORMED_DIAGNOSIS_STATE";
		invalid.stateIntegrity = "malformed";
		invalid.diagnosisError = "diagnosis.json is malformed; repair or remove it before continuing";
		invalid.rerouteRequired = true;
		invalid.implementationBlocked = true;
		invalid.nextSmallestAction = "repair or remove the malformed diagnosis sidecar after preserving its contents";
		invalid.updatedAt = now();
		return invalid;
	}
}

function appendDiagnosisEvent(workspaceRoot, taskId, type, payload, sessionId = null) {
	if (taskId) {
		return appendTaskEvent(workspaceRoot, taskId, `diagnosis_${type}`, { sessionId, ...payload });
	}
	const event = { eventId: newId("evt"), type: `diagnosis_${type}`, at: now(), ...payload };
	appendJsonl(diagnosisEventsPathFor(workspaceRoot), event);
	return event;
}

function transition(workspaceRoot, taskId, type, mutator, { sessionId = null, payload = {} } = {}) {
	const before = readDiagnosis(workspaceRoot, taskId);
	const next = normalizeDiagnosis(mutator(clone(before)), taskId);
	next.schemaVersion = DIAGNOSIS_SCHEMA_VERSION;
	next.revision = (before.revision || 0) + 1;
	next.lastTransition = type;
	next.updatedAt = now();
	writeJsonAtomic(diagnosisPathFor(workspaceRoot, taskId), next);
	appendDiagnosisEvent(
		workspaceRoot,
		taskId,
		type,
		{
			fromRevision: before.revision || 0,
			toRevision: next.revision,
			diagnosisId: next.diagnosisId,
			phase: next.phase,
			routeReason: next.routeReason,
			payload: clone(payload),
		},
		sessionId,
	);
	return next;
}

function assertActive(diagnosis, action = "transition") {
	if (!diagnosis.active || !diagnosis.diagnosisId) {
		const error = new Error(`diagnosis is not active; initialize it before ${action}`);
		error.code = "DIAGNOSIS_NOT_ACTIVE";
		throw error;
	}
}

function checkpoint(value) {
	const source = value || {};
	return {
		whatWeKnow: required(source.whatWeKnow, "checkpoint.whatWeKnow"),
		whatChanged: required(source.whatChanged, "checkpoint.whatChanged"),
		whyPreviousSubsystemNoLongerPrimary: required(
			source.whyPreviousSubsystemNoLongerPrimary || source.whyPreviousBoundaryNoLongerPrimary,
			"checkpoint.whyPreviousSubsystemNoLongerPrimary",
		),
		newClosestProvenBoundary: required(source.newClosestProvenBoundary, "checkpoint.newClosestProvenBoundary"),
		nextDiscriminatingAction: required(source.nextDiscriminatingAction, "checkpoint.nextDiscriminatingAction"),
		fromSubsystem: text(source.fromSubsystem) || null,
		newResponsibleSubsystem: required(source.newResponsibleSubsystem || source.toSubsystem, "checkpoint.newResponsibleSubsystem"),
		createdAt: source.createdAt || now(),
	};
}

export function startDiagnosis(workspaceRoot, taskId, payload = {}, options = {}) {
	const symptom = required(payload.symptom || payload.claim, "symptom/claim");
	const provenBoundary = boundary(payload.closestProvenBoundary || payload.boundary);
	if (!provenBoundary) required(null, "closestProvenBoundary");
	return transition(
		workspaceRoot,
		taskId,
		"init",
		(current) => {
			if (current.active && !payload.restart) {
				const error = new Error("diagnosis already active; route or complete it before starting another");
				error.code = "DIAGNOSIS_ALREADY_ACTIVE";
				throw error;
			}
			return {
				...emptyDiagnosis(taskId),
				diagnosisId: current.active && payload.restart ? newId("diagnosis") : current.diagnosisId || newId("diagnosis"),
				active: true,
				phase: "ESTABLISH_FACTS",
				activationReason: text(payload.activationReason) || "confirmed-failure",
				premiseStatus: text(payload.premiseStatus).toUpperCase() || "UNVERIFIED",
				riskTier: normalizeRiskTier(payload.riskTier),
				symptom,
				closestProvenBoundary: provenBoundary,
				responsibleSubsystem: text(payload.responsibleSubsystem) || null,
				nextSmallestAction: text(payload.nextSmallestAction) || "record the next discriminating observation",
			};
		},
		{ ...options, payload },
	);
}

export function recordEvidence(workspaceRoot, taskId, payload = {}, options = {}) {
	return transition(
		workspaceRoot,
		taskId,
		"evidence",
		(current) => {
			assertActive(current, "recording evidence");
			const kind = lower(payload.kind || "supporting").startsWith("contra") ? "contradicting" : "supporting";
			const entry = evidenceEntry({ ...payload, kind }, kind);
			current.evidence[kind] = addEvidence(current.evidence[kind], entry);
			if (kind === "contradicting" && current.currentHypothesis) {
				current.hypothesisStatus = "CONTRADICTED";
				current.rootCauseStatus = current.rootCauseStatus === "ESTABLISHED" ? "INVALIDATED" : current.rootCauseStatus;
				current.rerouteRequired = true;
				current.route = null;
				current.routeReason = "HYPOTHESIS_CONTRADICTED";
				current.phase = "REASSESS_PREMISE";
				current.implementationBlocked = true;
				current.nextSmallestAction = "route through verify-premise or debug and establish a new boundary";
			}
			return current;
		},
		{ ...options, payload },
	);
}

export function setHypothesis(workspaceRoot, taskId, payload = {}, options = {}) {
	const hypothesis = required(payload.hypothesis || payload.claim, "hypothesis");
	const falsifier = required(payload.falsifier, "falsifier");
	const expectedResult = required(payload.expectedResult || payload.verificationPrediction, "expectedResult");
	return transition(
		workspaceRoot,
		taskId,
		"hypothesis",
		(current) => {
			assertActive(current, "setting a hypothesis");
			current.currentHypothesis = hypothesis;
			current.hypothesisStatus = "UNVERIFIED_HYPOTHESIS";
			current.falsifier = falsifier;
			current.verificationPrediction = expectedResult;
			current.phase = "FALSIFY";
			current.implementationBlocked = current.riskTier === "S2" || current.riskTier === "S3";
			for (const item of payload.supportingEvidence || []) {
				current.evidence.supporting = addEvidence(current.evidence.supporting, evidenceEntry({ ...item, kind: "supporting" }, "supporting"));
			}
			if (!current.evidence.supporting.length && payload.supportingEvidenceRequired !== false) {
				// A hypothesis may be recorded before support is known, but it must
				// remain explicitly unverified until evidence is recorded.
				current.nextSmallestAction = "record current supporting evidence or a cheaper falsifier";
			}
			return current;
		},
		{ ...options, payload: { hypothesis, falsifier, expectedResult } },
	);
}

export function classifyHypothesis(workspaceRoot, taskId, payload = {}, options = {}) {
	const status = text(payload.status).toUpperCase();
	if (!HYPOTHESIS_STATUSES.includes(status)) {
		const error = new Error(`unknown hypothesis status: ${status}`);
		error.code = "INVALID_HYPOTHESIS_STATUS";
		throw error;
	}
	return transition(
		workspaceRoot,
		taskId,
		"classify",
		(current) => {
			assertActive(current, "classifying a hypothesis");
			if (["SUPPORTED_HYPOTHESIS", "FACT"].includes(status) && !currentEvidence(current.evidence.supporting).length) {
				const error = new Error("supporting evidence is required before classifying a hypothesis as supported/fact");
				error.code = "DIAGNOSIS_EVIDENCE_REQUIRED";
				throw error;
			}
			if (["CONTRADICTED", "REJECTED"].includes(status) && !currentEvidence(current.evidence.contradicting).length) {
				const error = new Error("contradicting evidence is required before invalidating a hypothesis");
				error.code = "DIAGNOSIS_EVIDENCE_REQUIRED";
				throw error;
			}
			current.hypothesisStatus = status;
			if (["CONTRADICTED", "REJECTED"].includes(status)) {
				current.rerouteRequired = true;
				current.route = null;
				current.routeReason = `HYPOTHESIS_${status}`;
				current.phase = "REASSESS_PREMISE";
				current.implementationBlocked = true;
			}
			return current;
		},
		{ ...options, payload: { status } },
	);
}

export function establishRootCause(workspaceRoot, taskId, payload = {}, options = {}) {
	const rootCause = required(payload.rootCause || payload.claim, "rootCause");
	const change = required(payload.proposedSmallestCausalChange || payload.smallestCausalChange, "proposedSmallestCausalChange");
	const prediction = required(payload.verificationPrediction || payload.expectedResult, "verificationPrediction");
	const falsifier = required(payload.falsifier, "falsifier");
	return transition(
		workspaceRoot,
		taskId,
		"root_cause",
		(current) => {
			assertActive(current, "establishing root cause");
			if (
				!current.closestProvenBoundary ||
				!current.currentHypothesis ||
				!currentEvidence(current.evidence.supporting).length ||
				!["SUPPORTED_HYPOTHESIS", "FACT"].includes(current.hypothesisStatus)
			) {
				const error = new Error("closest proven boundary, supported hypothesis, and current supporting evidence are required before root cause");
				error.code = "DIAGNOSIS_EVIDENCE_REQUIRED";
				throw error;
			}
			if (["CONTRADICTED", "REJECTED"].includes(current.hypothesisStatus)) {
				const error = new Error("contradicted/rejected hypothesis cannot establish root cause; route again");
				error.code = "DIAGNOSIS_REROUTE_REQUIRED";
				throw error;
			}
			current.rootCause = rootCause;
			current.rootCauseStatus = "ESTABLISHED";
			current.proposedSmallestCausalChange = change;
			current.verificationPrediction = prediction;
			current.falsifier = falsifier;
			current.phase = "IMPLEMENT";
			current.rerouteRequired = false;
			current.routeReason = null;
			current.implementationBlocked = false;
			current.nextSmallestAction = change;
			return current;
		},
		{ ...options, payload: { rootCause, change, prediction, falsifier } },
	);
}

export function recordCheckpoint(workspaceRoot, taskId, payload = {}, options = {}) {
	const value = checkpoint(payload.checkpoint || payload);
	return transition(
		workspaceRoot,
		taskId,
		"checkpoint",
		(current) => {
			assertActive(current, "recording a subsystem checkpoint");
			current.subsystemCheckpoint = value;
			current.responsibleSubsystem = value.newResponsibleSubsystem;
			current.closestProvenBoundary = boundary(value.newClosestProvenBoundary);
			current.checkpointRequired = false;
			current.nextSmallestAction = value.nextDiscriminatingAction;
			return current;
		},
		{ ...options, payload: value },
	);
}

export function recordDecision(workspaceRoot, taskId, payload = {}, options = {}) {
	const value = {
		decision: required(payload.decision, "decision"),
		evidence: required(payload.evidence, "decision.evidence"),
		predictedEffect: required(payload.predictedEffect, "decision.predictedEffect"),
		falsifier: required(payload.falsifier, "decision.falsifier"),
		outcome: text(payload.outcome) || "pending",
		recordedAt: now(),
	};
	return transition(
		workspaceRoot,
		taskId,
		"decision",
		(current) => {
			assertActive(current, "recording a material decision");
			current.lastDecision = value;
			return current;
		},
		{ ...options, payload: value },
	);
}

function failureTransition(current, payload, signature) {
	const previous = current.failureSignature;
	const previousBoundary = clone(current.closestProvenBoundary);
	const previousFailureContext = {
		run: clone(current.lastRun),
		signature: clone(previous),
		boundary: previousBoundary,
		failedAction: clone(current.previousFailedAction),
		materialChange: clone(current.materialChangeSincePreviousFailure),
		retryGate: clone(current.retryGate),
		attempts: clone(current.attempts),
	};
	const hadPrevious = !!previous?.classKey;
	const newClass = hadPrevious && previous.classKey !== signature.classKey;
	const previousSubsystem = text(previous?.subsystem || current.responsibleSubsystem);
	const nextSubsystem = text(payload.responsibleSubsystem || signature.subsystem);
	const subsystemChanged = !!(previousSubsystem && nextSubsystem && lower(previousSubsystem) !== lower(nextSubsystem));
	const implementationFailure = payload.implementationFailure === true;

	const wasInactive = !current.active || !current.diagnosisId;
	if (!current.diagnosisId) current.diagnosisId = newId("diagnosis");
	current.active = true;
	if (previous || current.lastRun || current.retryGate) current.previousFailureContext = previousFailureContext;
	if (wasInactive) {
		current.activationReason = "confirmed-failure";
		current.premiseStatus = "UNVERIFIED";
		current.phase = "REASSESS_PREMISE";
		current.implementationBlocked = true;
	}
	current.failureSignature = signature;
	current.responsibleSubsystem = nextSubsystem || current.responsibleSubsystem;
	current.closestProvenBoundary = boundary(payload.closestProvenBoundary || payload.boundary) || current.closestProvenBoundary;
	current.previousFailedAction = payload.previousFailedAction || current.previousFailedAction || null;
	current.materialChangeSincePreviousFailure = payload.materialChangeSincePreviousFailure || current.materialChangeSincePreviousFailure || null;
	current.nextSmallestAction = text(payload.nextSmallestAction) || current.nextSmallestAction || "record the next discriminating observation";

	if (newClass) {
		current.previousFailureSignature = previous;
		current.previousDiagnosis = {
			diagnosisId: current.diagnosisId,
			symptom: current.symptom,
			failureSignature: previous,
			closestProvenBoundary: previousBoundary,
			responsibleSubsystem: previousSubsystem || null,
			currentHypothesis: current.currentHypothesis,
			hypothesisStatus: current.hypothesisStatus,
				evidence: clone(current.evidence),
				rootCauseStatus: current.rootCauseStatus,
				rootCause: current.rootCause,
				failureContext: clone(previousFailureContext),
				attempts: clone(current.attempts),
		};
		current.diagnosisId = newId("diagnosis");
		current.activationReason = "new-failure-class";
		current.phase = "REASSESS_PREMISE";
		current.route = null;
		current.routeReason = "NEW_FAILURE_CLASS";
		current.rerouteRequired = true;
		current.implementationBlocked = true;
		current.currentHypothesis = null;
		current.hypothesisStatus = "UNKNOWN";
		current.evidence = { supporting: [], contradicting: [] };
		current.rootCause = null;
		current.rootCauseStatus = "UNKNOWN";
		current.proposedSmallestCausalChange = null;
		current.verificationPrediction = null;
		current.falsifier = null;
		current.attempts = { sameFailureClass: 0, implementationFailures: 0 };
	} else {
		if (hadPrevious) current.attempts.sameFailureClass = (current.attempts.sameFailureClass || 0) + 1;
		if (implementationFailure) current.attempts.implementationFailures = (current.attempts.implementationFailures || 0) + 1;
		if (implementationFailure && current.attempts.implementationFailures >= 2) {
			current.rerouteRequired = true;
			current.route = null;
			current.routeReason = "TWO_STRIKES_SAME_FAILURE";
			current.phase = "REASSESS_ROOT_CAUSE";
			current.implementationBlocked = true;
			current.nextSmallestAction = "re-evaluate the same root-cause hypothesis before another implementation";
		} else if (current.rootCauseStatus === "ESTABLISHED") {
			current.phase = "FIX_LOOP";
		}
	}

	if (subsystemChanged) {
		if (payload.checkpoint) {
			const value = checkpoint({
				...payload.checkpoint,
				fromSubsystem: payload.checkpoint.fromSubsystem || previousSubsystem,
				newResponsibleSubsystem: payload.checkpoint.newResponsibleSubsystem || nextSubsystem,
			});
			current.subsystemCheckpoint = value;
			current.closestProvenBoundary = boundary(value.newClosestProvenBoundary);
			current.checkpointRequired = false;
		} else {
			current.checkpointRequired = true;
			current.implementationBlocked = true;
			current.nextSmallestAction = "record the subsystem checkpoint before selecting an implementation";
		}
	}
	return current;
}

export function recordRun(workspaceRoot, taskId, payload = {}, options = {}) {
	const status = lower(payload.status || payload.outcome);
	if (!TERMINAL_RUN_STATUSES.has(status)) {
		const error = new Error(`run status must be one of: ${[...TERMINAL_RUN_STATUSES].join(", ")}`);
		error.code = "INVALID_RUN_STATUS";
		throw error;
	}
	const signature = status === "failed" ? normalizeFailureSignature(payload.failureSignature || payload.signature) : null;
	return transition(
		workspaceRoot,
		taskId,
		"run",
		(current) => {
			if (status === "failed") {
				failureTransition(current, payload, signature);
			} else if (!current.diagnosisId) {
				current.diagnosisId = newId("diagnosis");
			}
			current.active = true;
			current.lastRun = {
				runId: required(payload.runId || payload.id, "runId"),
				outcome: status,
				failureSignature: signature,
				actionId: text(payload.actionId) || null,
				costClass: text(payload.costClass) || null,
				implementationFailure: payload.implementationFailure === true,
				recordedAt: now(),
			};
			if (status === "passed") {
				current.lastVerification = { outcome: "passed", runId: current.lastRun.runId, recordedAt: now() };
				current.phase = "VERIFY";
				current.nextSmallestAction = "record completion evidence or the next bounded task transition";
			} else if (status === "failed") {
				current.lastVerification = { outcome: "failed", runId: current.lastRun.runId, recordedAt: now() };
			}
			return current;
		},
		{ ...options, payload: { runId: payload.runId || payload.id, status, signature } },
	);
}

export function routeDiagnosis(workspaceRoot, taskId, payload = {}, options = {}) {
	const route = text(payload.route).toLowerCase();
	if (!DIAGNOSIS_ROUTES.includes(route)) {
		const error = new Error(`route must be one of: ${DIAGNOSIS_ROUTES.join(", ")}`);
		error.code = "INVALID_DIAGNOSIS_ROUTE";
		throw error;
	}
	return transition(
		workspaceRoot,
		taskId,
		"route",
		(current) => {
			assertActive(current, "routing diagnosis");
			current.route = route;
			current.rerouteRequired = false;
			current.routeReason = text(payload.reason) || current.routeReason || null;
			current.phase = route.toUpperCase().replaceAll("-", "_");
			current.currentHypothesis = null;
			current.hypothesisStatus = "UNKNOWN";
			current.rootCauseStatus = "UNKNOWN";
			current.rootCause = null;
			// Keep the audit trail, but make prior evidence historical. A reroute
			// must earn current supporting evidence instead of reusing facts that
			// invalidated the previous route.
			current.evidence = {
				supporting: current.evidence.supporting.map((entry) => ({ ...entry, current: false })),
				contradicting: current.evidence.contradicting.map((entry) => ({ ...entry, current: false })),
			};
			current.implementationBlocked = true;
			current.nextSmallestAction = text(payload.nextSmallestAction) || `establish the closest proven boundary for ${route}`;
			return current;
		},
		{ ...options, payload: { route, reason: payload.reason || null } },
	);
}

function actionPolicy(workspaceRoot) {
	const path = join(workspaceRoot, ".heli-harness", "safety", "expensive-actions.json");
	const data = readJson(path, null);
	return data && typeof data === "object" ? data : { schemaVersion: 1, actions: [] };
}

function actionRule(action, policy) {
	const actions = Array.isArray(policy?.actions) ? policy.actions : [];
	const haystack = `${lower(action.actionId)} ${lower(action.command)} ${lower(action.kind)}`;
	return actions.find((rule) => {
		const matches = Array.isArray(rule?.match) ? rule.match : [rule?.match || rule?.id];
		return matches.some((match) => text(match) && haystack.includes(lower(match)));
	}) || null;
}

function normalizeAction(action = {}, policy = {}) {
	const rule = actionRule(action, policy);
	const costClass = lower(action.costClass || action.cost || rule?.costClass || (action.repositoryDefinedCostly ? "expensive" : "normal"));
	return {
		...clone(action),
		actionId: text(action.actionId || action.id || rule?.id) || "unnamed-action",
		costClass,
		policyRuleId: rule?.id || null,
		policyRule: rule || null,
	};
}

function isExpensive(action) {
	return action.costClass === "expensive" || action.costClass === "high" || action.costClass === "repository-defined" || action.repositoryDefinedCostly === true || action.policyRule?.costClass === "expensive";
}

function validMaterialChange(value) {
	if (!value || value.changed !== true) return false;
	if (!text(value.summary) || !text(value.predictedEffect || value.expectedResult)) return false;
	const relevantSurface = value.configChanged === true || value.environmentChanged === true
		|| (Array.isArray(value.files) && value.files.some((file) => text(file)))
		|| text(value.changeRef || value.changeReference || value.diffSummary);
	return !!relevantSurface;
}

function validDiscriminatingEvidence(value) {
	return !!(
		value &&
		text(value.summary) &&
		Array.isArray(value.cheaperActionsChecked) &&
		value.cheaperActionsChecked.length > 0 &&
		text(value.cheaperUnavailableReason)
	);
}

function validTransientPolicy(value, rule) {
	const policy = value || rule?.transientPolicy;
	if (!policy || lower(policy.classification) !== "transient" || !text(policy.policyId)) return false;
	const max = Number(policy.maxRetries);
	const retry = Number(policy.retryCount || 0);
	return Number.isFinite(max) && max > 0 && retry < max;
}

function validHumanOverride(value) {
	return !!(value?.approved === true && text(value.requestedBy || value.approver) && text(value.evidence || value.reason));
}

export function evaluateActionGate(diagnosis, action = {}, policy = {}) {
	const normalized = normalizeAction(action, policy);
	const expensive = isExpensive(normalized);
	const riskTier = normalizeRiskTier(normalized.riskTier || diagnosis?.riskTier);
	const material = validMaterialChange(normalized.materialChange) || normalized.material === true;
	const review = riskTier === "S2" && material
		? { required: true, status: normalized.independentReview?.status || diagnosis?.independentReview?.status || "pending" }
		: { required: false, status: "not-required" };
	if (!expensive) {
		return { allowed: true, code: "NOT_EXPENSIVE", action: normalized, review };
	}
	const previousRun = diagnosis?.lastRun;
	const repeated = previousRun?.outcome === "failed";
	if (!repeated) {
		return { allowed: true, code: "INITIAL_EXPENSIVE_ACTION", action: normalized, review };
	}
	if (riskTier === "S3" || normalized.productionMutation === true || normalized.policyRule?.requiresHumanApproval === true) {
		if (!validHumanOverride(normalized.humanOverride)) {
			return { allowed: false, code: "HUMAN_APPROVAL_REQUIRED", reason: "S3/production expensive actions require explicit human approval evidence", action: normalized, review: { required: true, status: "human-pending" } };
		}
		return { allowed: true, code: "HUMAN_OVERRIDE", action: normalized, review: { required: true, status: "human-approved" } };
	}
	if (validMaterialChange(normalized.materialChange)) {
		return { allowed: true, code: "MATERIAL_CHANGE", action: normalized, review };
	}
	if (validDiscriminatingEvidence(normalized.discriminatingEvidence)) {
		return { allowed: true, code: "DISCRIMINATING_EVIDENCE", action: normalized, review };
	}
	if (validTransientPolicy(normalized.transientPolicy, normalized.policyRule)) {
		return { allowed: true, code: "BOUNDED_TRANSIENT_RETRY", action: normalized, review };
	}
	return {
		allowed: false,
		code: "RETRY_JUSTIFICATION_REQUIRED",
		reason: "repeated expensive action needs material change, discriminating evidence, bounded transient policy, or human override",
		action: normalized,
		review,
		previousRun: clone(previousRun),
	};
}

export function authorizeAction(workspaceRoot, taskId, action = {}, options = {}) {
	const diagnosis = readDiagnosis(workspaceRoot, taskId);
	const gate = evaluateActionGate(diagnosis, action, actionPolicy(workspaceRoot));
	if (!gate.allowed) return gate;
	const next = transition(
		workspaceRoot,
		taskId,
		"action_authorized",
		(current) => {
			current.retryGate = {
				action: gate.action,
				decision: gate.code,
				previousRun: clone(current.lastRun),
				previousFailureSignature: clone(current.failureSignature),
				previousBoundary: clone(current.closestProvenBoundary),
				previousFailedAction: clone(current.previousFailedAction),
				materialChange: clone(gate.action.materialChange),
				discriminatingEvidence: clone(gate.action.discriminatingEvidence),
				attemptCount: current.attempts.sameFailureClass || 0,
				costClass: gate.action.costClass,
				authorizedAt: now(),
			};
			current.reviewRequirement = gate.review;
			return current;
		},
		{ ...options, payload: { action: gate.action, decision: gate.code } },
	);
	return { ...gate, diagnosis: next };
}

export function evaluateDiagnosisWriteGate(diagnosis, { riskTier = null, isWrite = false, action = null, policy = {} } = {}) {
	const current = normalizeDiagnosis(diagnosis);
	if (current.stateIntegrity === "malformed") {
		if (!isWrite) return { allowed: true, code: "DIAGNOSIS_STATE_INVALID_READ_ONLY", reason: current.diagnosisError };
		return { allowed: false, code: "DIAGNOSIS_STATE_INVALID", reason: current.diagnosisError || "diagnosis sidecar is malformed; repair it before material writes" };
	}
	if (action) {
		const actionGate = evaluateActionGate(current, action, policy);
		if (!actionGate.allowed) return { ...actionGate, allowed: false };
	}
	if (!isWrite) return { allowed: true, code: "READ_OR_NON_MATERIAL" };
	if (!current.active) return { allowed: true, code: "NO_ACTIVE_DIAGNOSIS" };
	if (current.rerouteRequired) {
		return {
			allowed: false,
			code: "DIAGNOSIS_REROUTE_REQUIRED",
			reason: `diagnosis requires ${current.routeReason || "reassessment"}: record a new route and closest proven boundary before material writes`,
		};
	}
	if (current.checkpointRequired) {
		return {
			allowed: false,
			code: "SUBSYSTEM_CHECKPOINT_REQUIRED",
			reason: "responsible subsystem changed; record the required checkpoint before material writes",
		};
	}
	const tier = normalizeRiskTier(riskTier || current.riskTier);
	if ((tier === "S2" || tier === "S3") && current.activationReason && current.rootCauseStatus !== "ESTABLISHED") {
		return {
			allowed: false,
			code: "ROOT_CAUSE_EVIDENCE_REQUIRED",
			reason: "S2/S3 material implementation requires current boundary, falsifiable hypothesis, supporting evidence, and established root cause",
		};
	}
	return { allowed: true, code: "DIAGNOSIS_GATE_CLEAR" };
}

export function evaluateDiagnosisCompletion(diagnosis, { riskTier = null } = {}) {
	const current = normalizeDiagnosis(diagnosis);
	if (current.stateIntegrity === "malformed") return { allowed: false, code: "DIAGNOSIS_STATE_INVALID", reason: current.diagnosisError || "diagnosis sidecar is malformed; repair it before completion" };
	if (!current.active) return { allowed: true, code: "NO_ACTIVE_DIAGNOSIS" };
	if (current.rerouteRequired) return { allowed: false, code: "DIAGNOSIS_REROUTE_REQUIRED", reason: "cannot complete while diagnosis requires reroute" };
	if (current.checkpointRequired) return { allowed: false, code: "SUBSYSTEM_CHECKPOINT_REQUIRED", reason: "cannot complete before subsystem checkpoint" };
	if (current.lastVerification?.outcome !== "passed") return { allowed: false, code: "VERIFICATION_EVIDENCE_REQUIRED", reason: "current passing verification evidence is required before completion" };
	const tier = normalizeRiskTier(riskTier || current.riskTier);
	if ((tier === "S2" || tier === "S3") && current.rootCauseStatus !== "ESTABLISHED") return { allowed: false, code: "ROOT_CAUSE_EVIDENCE_REQUIRED", reason: "S2/S3 completion requires established root cause evidence" };
	return { allowed: true, code: "COMPLETION_EVIDENCE_CURRENT" };
}

export function readActionPolicy(workspaceRoot) {
	return actionPolicy(workspaceRoot);
}

export function normalizeFailureSignature(value = {}) {
	if (!value || typeof value !== "object") {
		const error = new Error("failure signature must be an object");
		error.code = "INVALID_FAILURE_SIGNATURE";
		throw error;
	}
	const normalizedMessage = normalizeMessage(value.normalizedMessage || value.message || value.error);
	const dimensions = {
		operationStage: text(value.operationStage || value.operation || value.stage),
		subsystem: text(value.subsystem),
		errorClass: text(value.errorClass || value.classification || value.errorType),
		terminalStatus: text(value.terminalStatus || value.status) || "failed",
		assertion: text(value.assertion || value.test || value.testIdentity),
		environment: text(value.environment),
		provider: text(value.provider),
		sourceSha: text(value.sourceSha || value.sha),
		normalizedMessage,
	};
	if (!Object.values(dimensions).some((item) => item && item !== "failed")) {
		const error = new Error("failure signature needs at least one identifying dimension");
		error.code = "INVALID_FAILURE_SIGNATURE";
		throw error;
	}
	const messageHash = normalizedMessage ? hash(normalizedMessage) : null;
	const classKey = hash(JSON.stringify({
		operationStage: dimensions.operationStage,
		subsystem: dimensions.subsystem,
		errorClass: dimensions.errorClass,
		terminalStatus: dimensions.terminalStatus,
		assertion: dimensions.assertion,
		environment: dimensions.environment,
		provider: dimensions.provider,
		messageHash,
	}));
	return {
		...dimensions,
		messageHash,
		classKey,
		signatureId: hash(JSON.stringify({ ...dimensions, messageHash, classKey })),
		normalizedAt: now(),
	};
}

export function sameFailureClass(left, right) {
	return !!(left?.classKey && right?.classKey && left.classKey === right.classKey);
}
