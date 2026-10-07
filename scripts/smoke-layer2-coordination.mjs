#!/usr/bin/env node
/**
 * Layer 2 coordination smoke (issue #36): workspace-scoped dependencies and
 * handoffs with hermetic dirs.
 *
 * Covers: declaration + exact-duplicate idempotency, conflicting dependency
 * rejection, blocked evaluation, publication + exact replay idempotency,
 * conflicting publication rejection, multi-dependency readiness, unknown task
 * / malformed artifact failures, malformed coordination state fail-closed,
 * cross-worktree visibility, and task lifecycle isolation (status untouched).
 */
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { linkProject } from "../lib/cli/link.mjs";
import { setupHeli } from "../lib/cli/setup.mjs";
import { createTask, readTask } from "../lib/concurrency/task.mjs";
import {
	declareDependency,
	dependenciesForTask,
	evaluateTaskCoordination,
	evaluateWorkspaceCoordination,
	listHandoffs,
	publishHandoff,
	readHandoff,
} from "../lib/concurrency/handoff.mjs";
import { projectWorkspaceKey, resolveExecutionIdentity } from "../lib/concurrency/project-binding.mjs";
import { removeFixtureOwnedPath, removeFixtureWorkspaceState } from "./lib/fixture-state-safety.mjs";

const root = mkdtempSync(join(tmpdir(), "heli-l2-smoke-"));
const fixtureDataRoot = join(root, "fixture-data");
const config = join(root, "config");
const data = fixtureDataRoot;
mkdirSync(fixtureDataRoot, { recursive: true });
const env = { ...process.env, HELI_CONFIG_DIR: config, HELI_DATA_DIR: fixtureDataRoot };

let fixtureWorkspaceId = null;
try {
const repo = join(root, "repo");
mkdirSync(repo, { recursive: true });
for (const args of [["init", "-q"], ["config", "user.email", "t@t"], ["config", "user.name", "t"]]) {
	assert.equal(spawnSync("git", args, { cwd: repo }).status, 0);
}
writeFileSync(join(repo, "README.md"), "seed\n");
assert.equal(spawnSync("git", ["add", "."], { cwd: repo }).status, 0);
assert.equal(spawnSync("git", ["commit", "-q", "-m", "init"], { cwd: repo }).status, 0);
const checkoutA = join(root, "checkout-a");
const checkoutB = join(root, "checkout-b");
assert.equal(spawnSync("git", ["worktree", "add", "-q", "-b", "wt-a", checkoutA], { cwd: repo }).status, 0);
assert.equal(spawnSync("git", ["worktree", "add", "-q", "-b", "wt-b", checkoutB], { cwd: repo }).status, 0);

setupHeli({ env });
linkProject(process.cwd(), checkoutA, { env });
fixtureWorkspaceId = projectWorkspaceKey(checkoutA, { env });
assert.ok(fixtureWorkspaceId, "fixture workspace identity must be captured for exact cleanup");
// checkout B is another checkout of the SAME workspace: share the binding only.
// Sessions/leases stay execution-scoped; nothing else is copied.
mkdirSync(checkoutB, { recursive: true });
cpDir(join(checkoutA, ".heli"), join(checkoutB, ".heli"));
assert.equal(projectWorkspaceKey(checkoutA, { env }), projectWorkspaceKey(checkoutB, { env }), "both checkouts share one workspace");
assert.notEqual(
	resolveExecutionIdentity(checkoutA, { env }).executionId,
	resolveExecutionIdentity(checkoutB, { env }).executionId,
	"checkouts keep distinct execution identities",
);

createTask(checkoutA, { taskId: "epic-auth", title: "Auth", env });
createTask(checkoutA, { taskId: "epic-billing", title: "Billing", env });
createTask(checkoutA, { taskId: "epic-ui", title: "UI", env });

// 1. Declaration is visible from the other checkout of the same workspace.
declareDependency(checkoutA, {
	consumerTaskId: "epic-billing",
	producerTaskId: "epic-auth",
	artifactName: "auth-user-contract",
	env,
});
assert.equal(
	dependenciesForTask(checkoutB, "epic-billing", { env }).length,
	1,
	"dependency declared in A is visible from B without copying",
);

// 2. Exact duplicate declaration is idempotent.
const again = declareDependency(checkoutB, {
	consumerTaskId: "epic-billing",
	producerTaskId: "epic-auth",
	artifactName: "auth-user-contract",
	env,
});
assert.equal(again.created, false, "exact redeclaration is a no-op");
assert.equal(dependenciesForTask(checkoutA, "epic-billing", { env }).length, 1, "no duplicate records");

// 3. Blocked before publication, from both checkouts.
for (const cwd of [checkoutA, checkoutB]) {
	const state = evaluateTaskCoordination(cwd, "epic-billing", { env });
	assert.equal(state.coordinationState, "blocked");
	assert.deepEqual(state.blockedOn, ["epic-auth/auth-user-contract"]);
}

// 4. Conflicting dependency (same consumer+artifact, different producer) fails.
createTask(checkoutA, { taskId: "epic-auth2", title: "Auth alt", env });
assert.throws(
	() => declareDependency(checkoutA, {
		consumerTaskId: "epic-billing",
		producerTaskId: "epic-auth2",
		artifactName: "auth-user-contract",
		env,
	}),
	(err) => err.code === "DEPENDENCY_CONFLICT",
);
// and it did not silently rewrite state
assert.equal(dependenciesForTask(checkoutA, "epic-billing", { env })[0].producerTaskId, "epic-auth");

// 5. Unknown producer/consumer fail clearly.
assert.throws(
	() => declareDependency(checkoutA, { consumerTaskId: "epic-billing", producerTaskId: "ghost", artifactName: "x", env }),
	(err) => err.code === "TASK_NOT_FOUND",
);
assert.throws(
	() => declareDependency(checkoutA, { consumerTaskId: "ghost", producerTaskId: "epic-auth", artifactName: "x", env }),
	(err) => err.code === "TASK_NOT_FOUND",
);
// self dependency
assert.throws(
	() => declareDependency(checkoutA, { consumerTaskId: "epic-billing", producerTaskId: "epic-billing", artifactName: "x", env }),
	(err) => err.code === "SELF_DEPENDENCY",
);
// malformed artifact name
assert.throws(
	() => declareDependency(checkoutA, { consumerTaskId: "epic-ui", producerTaskId: "epic-auth", artifactName: "", env }),
	(err) => err.code === "INVALID_ARTIFACT_NAME",
);

// 6. Second dependency: epic-ui waits on two producers; epic-billing's remaining
// path is only auth. Multi-dependency readiness: epic-ui blocked until both.
declareDependency(checkoutA, {
	consumerTaskId: "epic-ui",
	producerTaskId: "epic-auth",
	artifactName: "auth-user-contract",
	env,
});
declareDependency(checkoutA, {
	consumerTaskId: "epic-ui",
	producerTaskId: "epic-auth2",
	artifactName: "public-api-contract",
	env,
});
assert.equal(evaluateTaskCoordination(checkoutA, "epic-ui", { env }).coordinationState, "blocked");
assert.deepEqual(evaluateTaskCoordination(checkoutA, "epic-ui", { env }).blockedOn.sort(), [
	"epic-auth/auth-user-contract",
	"epic-auth2/public-api-contract",
]);
// Task with no dependencies is ready.
assert.equal(evaluateTaskCoordination(checkoutA, "epic-auth", { env }).coordinationState, "ready");

// 7. Publication requires ref; unknown producer fails.
assert.throws(
	() => publishHandoff(checkoutA, { producerTaskId: "epic-auth", artifactName: "auth-user-contract", ref: "", env }),
	(err) => err.code === "HANDOFF_REF_REQUIRED",
);
assert.throws(
	() => publishHandoff(checkoutA, { producerTaskId: "ghost", artifactName: "x", ref: "abc", env }),
	(err) => err.code === "TASK_NOT_FOUND",
);

// 8. Publish from B (the OTHER checkout): publication is workspace-visible.
const published = publishHandoff(checkoutB, {
	producerTaskId: "epic-auth",
	artifactName: "auth-user-contract",
	ref: "cfdc11b",
	path: "docs/contracts/auth-user-contract.md",
	env,
});
assert.equal(published.created, true);
assert.equal(listHandoffs(checkoutA, { env }).length, 1, "handoff published via B is visible from A");
assert.equal(readHandoff(checkoutA, "epic-auth", "auth-user-contract", { env }).ref, "cfdc11b");

// 9. Exact replay is idempotent.
const replay = publishHandoff(checkoutA, {
	producerTaskId: "epic-auth",
	artifactName: "auth-user-contract",
	ref: "cfdc11b",
	path: "docs/contracts/auth-user-contract.md",
	env,
});
assert.equal(replay.created, false, "exact republication is a no-op");
assert.equal(listHandoffs(checkoutA, { env }).length, 1);

// 10. Conflicting publication (same artifact, different ref) fails closed.
assert.throws(
	() => publishHandoff(checkoutA, { producerTaskId: "epic-auth", artifactName: "auth-user-contract", ref: "deadbee", env }),
	(err) => err.code === "HANDOFF_CONFLICT",
);
assert.throws(
	() => publishHandoff(checkoutA, {
		producerTaskId: "epic-auth",
		artifactName: "auth-user-contract",
		ref: "cfdc11b",
		path: "docs/contracts/renamed.md",
		env,
	}),
	(err) => err.code === "HANDOFF_CONFLICT",
);
assert.equal(listHandoffs(checkoutA, { env }).length, 1, "conflicts never mutated state");

// 11. Consumers became ready: billing (single dep) and ui after its second dep.
const billing = evaluateTaskCoordination(checkoutB, "epic-billing", { env });
assert.equal(billing.coordinationState, "ready");
assert.equal(billing.dependencies[0].state, "satisfied");
assert.equal(billing.dependencies[0].ref, "cfdc11b");
assert.equal(billing.dependencies[0].path, "docs/contracts/auth-user-contract.md");
assert.equal(evaluateTaskCoordination(checkoutA, "epic-ui", { env }).coordinationState, "blocked", "ui still waits for its second artifact");
publishHandoff(checkoutA, { producerTaskId: "epic-auth2", artifactName: "public-api-contract", ref: "feed123", env });
const ui = evaluateTaskCoordination(checkoutA, "epic-ui", { env });
assert.equal(ui.coordinationState, "ready", "ui is ready once BOTH artifacts exist");
assert.equal(ui.dependencies.find((d) => d.artifactName === "public-api-contract").path, null, "path is optional");

// 12. Task execution lifecycle untouched: status stays active, no new fields.
for (const id of ["epic-auth", "epic-billing", "epic-ui"]) {
	const task = readTask(checkoutA, id, { env });
	assert.equal(task.status, "active", `${id} status untouched by coordination`);
	assert.equal(task.coordinationState, undefined, `${id} task.json carries no coordination field`);
}

// 13. Malformed shared coordination state fails closed, never silently repaired.
const depPath = join(data, "state", "workspaces", projectWorkspaceKey(checkoutA, { env }), "coordination", "coordination.json");
const good = readFileSync(depPath, "utf8");
writeFileSync(depPath, JSON.stringify({ schemaVersion: 1, dependencies: [], handoffs: null }), "utf8");
assert.throws(
	() => evaluateWorkspaceCoordination(checkoutA, { env }),
	(err) => err.code === "MALFORMED_COORDINATION_STATE",
);
writeFileSync(depPath, good, "utf8");

// 14. Workspace-wide evaluation lists every task exactly once (4 tasks exist).
const all = evaluateWorkspaceCoordination(checkoutB, { env });
assert.deepEqual(all.map((s) => s.coordinationState).sort(), ["ready", "ready", "ready", "ready"]);

function cpDir(from, to) {
	cpSync(from, to, { recursive: true });
}

console.log("layer2 coordination smoke ok");
} finally {
	if (fixtureWorkspaceId) {
		removeFixtureWorkspaceState(fixtureDataRoot, fixtureWorkspaceId);
	}
	removeFixtureOwnedPath(root, tmpdir());
}
