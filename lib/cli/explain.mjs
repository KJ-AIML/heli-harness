import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { findWorkspaceRoot } from "../concurrency/paths.mjs";
import { resolveExecutionContext, evaluateOwnershipGate } from "../concurrency/resolve.mjs";
import { readTask, listActiveTasks, listTasks } from "../concurrency/task.mjs";
import {
	observedCapabilityMap,
	currentObservedCapabilityMap,
	runtimeObservationStatus,
} from "../concurrency/attestation.mjs";
import { readLease, isLeaseExpired } from "../concurrency/lease.mjs";
import { taskPaths } from "../concurrency/paths.mjs";
import { parseEventJsonl, latestEvent } from "../protocol/events.mjs";
import { protocolOk, protocolError } from "../protocol/result.mjs";
import { HELI_CAPABILITY_NAMES, composeCapabilityClaims } from "../protocol/capabilities.mjs";
import { wantsJson, stripOutputFlags, printProtocolResult } from "./output.mjs";
import { resolvePolicyComposition } from "../concurrency/policy-composition.mjs";
import { listGrants } from "../concurrency/grant.mjs";
import { isLinkedWorkspace } from "../concurrency/project-binding.mjs";
import { readResourceLeaseForWorktree, isResourceLeaseExpired, resourceIdForWorktree } from "../concurrency/resource-authority.mjs";

function readJson(path, fallback = null) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return fallback;
	}
}

function argsForExplain(args) {
	const json = wantsJson(args);
	const clean = stripOutputFlags(args);
	const subject = clean[0] || "authority";
	let taskId = null;
	const positional = [];
	for (let i = 1; i < clean.length; i += 1) {
		if (clean[i] === "--task" && clean[i + 1]) taskId = clean[++i];
		else if (!clean[i].startsWith("--")) positional.push(clean[i]);
	}
	if (subject === "decision") {
		return { json, subject, taskId, decisionId: positional[0] || null, cwd: positional[1] || process.cwd() };
	}
	return { json, subject, taskId, decisionId: null, cwd: positional[0] || process.cwd() };
}

function authorityExplanation(ctx) {
	if (isLinkedWorkspace(ctx.workspaceRoot)) {
		const lease = ctx.worktreeRoot ? readResourceLeaseForWorktree(ctx.workspaceRoot, ctx.worktreeRoot) : null;
		const activeLease = lease && !lease.invalid && !isResourceLeaseExpired(lease) ? lease : null;
		const owned = Boolean(activeLease && ctx.sessionId && activeLease.sessionId === ctx.sessionId);
		const available = !activeLease && !lease?.invalid;
		const reasons = [];
		if (lease?.invalid) reasons.push(`resource authority is malformed: ${lease.reason}`);
		else if (owned) reasons.push("current session holds resource-scoped write authority");
		else if (activeLease) reasons.push(`resource authority is held by session ${activeLease.sessionId}`);
		else if (!ctx.sessionId) reasons.push("no host/session is bound in this CLI invocation; authority is available and will be acquired conflict-safely by the first guarded host mutation");
		else reasons.push("current session does not yet hold authority; the first guarded mutation may acquire the available resource");
		return {
			workspaceRoot: ctx.workspaceRoot,
			workspaceMode: "linked",
			authorityModel: "resource-scoped",
			sessionId: ctx.sessionId || null,
			taskId: ctx.taskId || null,
			target: ctx.target?.targetRepo || null,
			worktree: ctx.worktreeRoot || null,
			resourceId: resourceIdForWorktree(ctx.worktreeRoot || ctx.workspaceRoot),
			lease: lease ? {
				owner: lease.sessionId || null,
				workRecord: lease.taskId || null,
				expiresAt: lease.expiresAt || null,
				active: Boolean(activeLease),
				invalid: Boolean(lease.invalid),
				generation: lease.generation || null,
				revision: lease.revision || null,
			} : null,
			writable: owned,
			available,
			decisionCode: lease?.invalid ? "DENY" : owned ? "ALLOW" : activeLease ? "DENY" : "AVAILABLE",
			reasons,
		};
	}
	const lease = ctx.taskId ? readLease(ctx.workspaceRoot, ctx.taskId) : null;
	const activeLease = lease && !lease.invalid && !isLeaseExpired(lease) ? lease : null;
	const gate = evaluateOwnershipGate(ctx, { isWrite: true });
	const writable = !gate.deny;
	const reasons = [];
	if (gate.reason) reasons.push(gate.reason);
	else if (gate.bootstrap) reasons.push("embedded compatibility bootstrap write is allowed because no task exists yet");
	else if (gate.renewalRequired) reasons.push("write is allowed subject to renewing the expired own lease before execution");
	else reasons.push("canonical compatibility ownership evaluator allows the write");
	return {
		workspaceRoot: ctx.workspaceRoot,
		workspaceMode: ctx.concurrentMode ? "concurrent" : "legacy",
		sessionId: ctx.sessionId || null,
		taskId: ctx.taskId || null,
		mode: ctx.mode || null,
		target: ctx.target?.targetRepo || null,
		worktree: ctx.worktreeRoot || null,
		lease: lease ? { owner: lease.sessionId || null, expiresAt: lease.expiresAt || null, active: Boolean(activeLease), invalid: Boolean(lease.invalid) } : null,
		writable,
		decisionCode: gate.code || (writable ? "ALLOW" : "DENY"),
		bootstrap: Boolean(gate.bootstrap),
		renewalRequired: Boolean(gate.renewalRequired),
		reasons,
	};
}

function adapterManifestPath(workspaceRoot) {
	const embedded = join(workspaceRoot, ".heli-harness", "adapters", "adapters.json");
	if (existsSync(embedded)) return embedded;
	const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
	return join(packageRoot, ".heli-harness", "adapters", "adapters.json");
}

function explainCapabilities(workspaceRoot, ctx) {
	const manifest = readJson(adapterManifestPath(workspaceRoot), { adapters: [] });
	const adapters = Array.isArray(manifest?.adapters) ? manifest.adapters : [];
	const session = ctx.session || null;
	const host = session?.host || ctx.host || "unknown";
	const selected = adapters.find((adapter) => adapter.id === host) || null;
	const rawObserved = observedCapabilityMap(session);
	const criteria = {
		host,
		hostSessionId: session?.externalHostSessionId || null,
		runtimeInstanceId: process.env.HELI_RUNTIME_INSTANCE_ID || null,
		adapterDigest: process.env.HELI_ADAPTER_DIGEST || null,
		configHash: process.env.HELI_CONFIG_HASH || null,
	};
	const currentObserved = currentObservedCapabilityMap(session, criteria);
	const claims = composeCapabilityClaims({
		declared: selected?.capabilities || {},
		observed: currentObserved,
		names: HELI_CAPABILITY_NAMES,
	});
	const observations = Object.fromEntries(
		Object.entries(rawObserved).map(([name, observation]) => [
			name,
			{ ...observation, freshness: runtimeObservationStatus(observation, criteria) },
		]),
	);
	return {
		host,
		sessionId: session?.sessionId || null,
		selectedAdapter: selected ? { id: selected.id, status: selected.status, capabilities: selected.capabilities || {} } : null,
		claims,
		observations,
		adapters: adapters.map((adapter) => ({ id: adapter.id, status: adapter.status, capabilities: adapter.capabilities || {} })),
		note: "declared metadata and live callback observations are distinct; observed does not imply full enforcement",
	};
}

function explainDecision(workspaceRoot, decisionId, explicitTaskId = null) {
	if (!decisionId) return { decisionId: null, event: null, warnings: ["decision id required"] };
	const tasks = explicitTaskId ? [{ taskId: explicitTaskId }] : listTasks(workspaceRoot);
	for (const task of tasks) {
		const path = taskPaths(workspaceRoot, task.taskId).eventsJsonl;
		if (!existsSync(path)) continue;
		const parsed = parseEventJsonl(readFileSync(path, "utf8"));
		const event = parsed.events.find(
			(item) =>
				(item.type === "guard.decision" || item.type === "guard_decision") &&
				item.decision?.decisionId === decisionId,
		);
		if (event) {
			return { decisionId, taskId: task.taskId, event, decision: event.decision || null, warnings: parsed.warnings, replay: "recorded-receipt" };
		}
	}
	return { decisionId, event: null, warnings: ["recorded decision not found"] };
}

function explainGuard(workspaceRoot, taskId) {
	if (!taskId) return { taskId: null, latestDecision: null, warnings: ["no task is bound; pass --task <id>"] };
	const path = taskPaths(workspaceRoot, taskId).eventsJsonl;
	if (!existsSync(path)) return { taskId, latestDecision: null, warnings: ["task event stream does not exist"] };
	const parsed = parseEventJsonl(readFileSync(path, "utf8"));
	const event = latestEvent(parsed.events, (item) => item.type === "guard.decision" || item.type === "guard_decision");
	return { taskId, latestDecision: event, warnings: parsed.warnings };
}

export function runExplain(args = []) {
	const { json, subject, taskId: explicitTaskId, decisionId, cwd } = argsForExplain(args);
	const workspaceRoot = findWorkspaceRoot(cwd);
	if (!workspaceRoot) {
		const result = protocolError(`explain.${subject}`, "WORKSPACE_NOT_FOUND", `No Heli workspace found from ${cwd}`);
		if (json) printProtocolResult(result);
		else console.log(result.errors[0].message);
		process.exitCode = 1;
		return result;
	}
	const ctx = resolveExecutionContext({ cwd, host: "cli", createIfMissing: false, refreshLeaseOnResolve: false });
	let data;
	if (subject === "authority") data = authorityExplanation(ctx);
	else if (subject === "task") {
		const taskId = explicitTaskId || ctx.taskId || listActiveTasks(workspaceRoot)[0]?.taskId || null;
		data = { taskId, task: taskId ? readTask(workspaceRoot, taskId) : null };
	} else if (subject === "capabilities") data = explainCapabilities(workspaceRoot, ctx);
	else if (subject === "guard") data = explainGuard(workspaceRoot, explicitTaskId || ctx.taskId || null);
	else if (subject === "decision") data = explainDecision(workspaceRoot, decisionId, explicitTaskId);
	else if (subject === "config") {
		data = {
			policy: resolvePolicyComposition(workspaceRoot),
			activeGrants: listGrants(workspaceRoot, { activeOnly: true }),
		};
	}
	else {
		const result = protocolError(`explain.${subject}`, "UNKNOWN_EXPLAIN_SUBJECT", `Unknown explain subject: ${subject}`);
		if (json) printProtocolResult(result);
		else console.log(result.errors[0].message);
		process.exitCode = 1;
		return result;
	}
	const result = protocolOk(`explain.${subject}`, data, { warnings: data?.warnings || [] });
	if (json) printProtocolResult(result);
	else if (subject === "authority") {
		console.log(`Workspace: ${data.workspaceRoot}`);
		if (data.workspaceMode === "linked") {
			console.log("Authority model: resource-scoped");
			console.log(`Resource: ${data.worktree || "n/a"}`);
			console.log(`Resource ID: ${data.resourceId || "n/a"}`);
			console.log(`Session: ${data.sessionId || "none"}`);
			console.log(`Work record: ${data.taskId || "none"}`);
			console.log(`Current writer: ${data.lease?.active ? data.lease.owner : "none"}`);
			console.log(`Generation / revision: ${data.lease?.generation || 0} / ${data.lease?.revision || 0}`);
			console.log(`Effective write authority: ${data.writable ? "held" : data.available ? "available, not held" : "denied"}`);
		} else {
			console.log(`Task: ${data.taskId || "unbound"}`);
			console.log(`Session: ${data.sessionId || "none"}`);
			console.log(`Mode: ${data.mode || "n/a"}`);
			console.log(`Target: ${data.target || "n/a"}`);
			console.log(`Effective write authority: ${data.writable ? "allowed" : "denied"}`);
		}
		for (const reason of data.reasons) console.log(`- ${reason}`);
	} else console.log(JSON.stringify(data, null, 2));
	return result;
}
