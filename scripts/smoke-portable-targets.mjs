#!/usr/bin/env node
/**
 * Portable task-target regression suite.
 * Temp workspaces only — verifies relative target authority before cloud integration.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const { createTask, readTask, setTaskTarget, canonicalizePath } = await import("../lib/concurrency/index.mjs");
const cloudBundle = await import("../lib/cli/cloud-bundle.mjs");
let portable = {};
try {
	portable = await import("../lib/concurrency/portable-targets.mjs");
} catch {
	// The first RED run should fail the API assertion, not abort on a missing module.
}

function fixtureWorkspace(label = "heli-portable") {
	const dir = mkdtempSync(join(tmpdir(), `${label}-`));
	mkdirSync(join(dir, ".heli-harness", "workspace"), { recursive: true });
	writeFileSync(join(dir, ".heli-harness", "HARNESS.md"), "# Heli-Harness\n");
	writeFileSync(
		join(dir, ".heli-harness", "workspace", "index.json"),
		JSON.stringify({
			schemaVersion: 1,
			workspaceRoot: ".",
			repos: [{ name: "demo", path: "repos/demo", gitRoot: "repos/demo" }],
		}) + "\n",
	);
	return dir;
}

const expectedApi = [
	"workspaceRelativePath",
	"resolveWorkspaceRelativePath",
	"addPortableTargetPaths",
	"sanitizeTaskTargetForBundle",
	"migrateTaskTargetForRestore",
	"projectTaskWorktree",
];
for (const name of expectedApi) {
	assert.equal(typeof portable[name], "function", `portable target API exports ${name}`);
}
console.log("smoke-portable-targets: resolver API present");

const workspace = fixtureWorkspace();
try {
	const repo = join(workspace, "repos", "demo");
	mkdirSync(repo, { recursive: true });

	const task = createTask(workspace, {
		taskId: "portable-task",
		title: "Portable target",
		workItemKey: "portable-target",
		repositoryId: "demo",
		repositoryPath: "repos/demo",
		worktreePath: repo,
	});
	assert.equal(task.target.workspaceRelativeWorktreePath, "repos/demo");
	assert.equal(task.target.workspaceRelativeRepositoryPath, "repos/demo");
	assert.equal(readTask(workspace, task.taskId).target.workspaceRelativeWorktreePath, "repos/demo");
	console.log("smoke-portable-targets: createTask writes relative target companions");

	const moved = join(workspace, "repos", "moved-demo");
	mkdirSync(moved, { recursive: true });
	setTaskTarget(workspace, task.taskId, {
		repositoryPath: "repos/moved-demo",
		worktreePath: moved,
	});
	const updated = readTask(workspace, task.taskId);
	assert.equal(updated.target.workspaceRelativeWorktreePath, "repos/moved-demo");
	assert.equal(updated.target.workspaceRelativeRepositoryPath, "repos/moved-demo");
	console.log("smoke-portable-targets: setTaskTarget refreshes relative companions");

	setTaskTarget(workspace, task.taskId, { worktreePath: "" });
	const cleared = readTask(workspace, task.taskId);
	assert.equal(cleared.target.workspaceRelativeWorktreePath, undefined);
	console.log("smoke-portable-targets: clearing worktree clears its portable companion");
	setTaskTarget(workspace, task.taskId, { worktreePath: moved });

	assert.equal(portable.workspaceRelativePath(workspace, workspace), ".");
	assert.equal(portable.workspaceRelativePath(workspace, join(workspace, "repos", "demo")), "repos/demo");
	assert.equal(portable.workspaceRelativePath(workspace, join(workspace, "..", "outside")), null);
	assert.equal(portable.resolveWorkspaceRelativePath(workspace, "../outside"), null);
	assert.equal(portable.resolveWorkspaceRelativePath(workspace, "/source-machine/repos/demo"), null);
	console.log("smoke-portable-targets: relative path validation rejects escapes");

	const enriched = portable.addPortableTargetPaths(workspace, {
		repositoryId: "demo",
		repositoryPath: "repos/demo",
		worktreePath: repo,
	}, { repos: [{ name: "demo", path: "repos/demo", gitRoot: "repos/demo" }] });
	assert.equal(enriched.workspaceRelativeWorktreePath, "repos/demo");
	assert.equal(enriched.workspaceRelativeRepositoryPath, "repos/demo");
	console.log("smoke-portable-targets: target enrichment is deterministic");

	assert.equal(typeof cloudBundle.normalizeTaskFilesForBundle, "function");
	assert.equal(typeof cloudBundle.restoreTaskFilesForWorkspace, "function");
	const sourceFiles = cloudBundle.collectBundleFiles(workspace);
	const sourceTaskRel = Object.keys(sourceFiles).find((rel) => rel.endsWith("/task.json"));
	assert.ok(sourceTaskRel, "task JSON is included in the portable subset");
	assert.equal(sourceFiles[sourceTaskRel].includes(workspace), false, "bundle omits source absolute root");

	const destination = fixtureWorkspace("heli-portable-destination");
	try {
		const restored = cloudBundle.restoreTaskFilesForWorkspace(destination, sourceFiles);
		const restoredTask = JSON.parse(restored[sourceTaskRel]);
		assert.equal(restoredTask.target.worktreePath, join(canonicalizePath(destination), "repos", "moved-demo"));
		assert.equal(restoredTask.target.workspaceRelativeWorktreePath, "repos/moved-demo");
		assert.equal(restoredTask.target.restoreStatus, undefined);
		const normalizedDestination = cloudBundle.normalizeTaskFilesForBundle(destination, restored);
		assert.deepEqual(JSON.parse(normalizedDestination[sourceTaskRel]).target, JSON.parse(sourceFiles[sourceTaskRel]).target);
		console.log("smoke-portable-targets: cross-root bundle restore is stable");

		const legacyTask = JSON.parse(sourceFiles[sourceTaskRel]);
		legacyTask.target = {
			repositoryId: "demo",
			repositoryPath: "/source-machine/workspace/repos/demo",
			worktreePath: "/source-machine/workspace/repos/demo",
		};
		const legacyFiles = { ...sourceFiles, [sourceTaskRel]: JSON.stringify(legacyTask) + "\n" };
		const legacyRestored = cloudBundle.restoreTaskFilesForWorkspace(destination, legacyFiles);
		const rebasedLegacy = JSON.parse(legacyRestored[sourceTaskRel]);
		assert.equal(rebasedLegacy.target.workspaceRelativeWorktreePath, "repos/demo");
		assert.equal(rebasedLegacy.target.worktreePath, join(canonicalizePath(destination), "repos", "demo"));
		console.log("smoke-portable-targets: legacy index suffix rebase is safe");

		const unmappedRepository = portable.migrateTaskTargetForRestore(
			destination,
			{
				repositoryPath: "/source-machine/workspace/repos/ghost",
				worktreePath: "/source-machine/workspace/repos/demo",
			},
			{ repos: [{ name: "demo", path: "repos/demo", gitRoot: "repos/demo" }] },
		);
		assert.equal(unmappedRepository.target.repositoryPath, undefined);
		assert.equal(unmappedRepository.stale, true);
		assert.equal(unmappedRepository.target.restoreStatus.reason, "legacy-no-index-match");
		console.log("smoke-portable-targets: unmapped legacy repository is stale");

		const ambiguous = portable.migrateTaskTargetForRestore(
			destination,
			{
				repositoryId: "unknown",
				worktreePath: "/source-machine/workspace/repos/demo",
			},
			{
				repos: [
					{ name: "demo-a", path: "repos/demo", gitRoot: "repos/demo" },
					{ name: "demo-b", path: "repos/demo", gitRoot: "repos/demo" },
				],
			},
		);
		assert.equal(ambiguous.stale, true);
		assert.equal(ambiguous.target.worktreePath, undefined);
		assert.equal(ambiguous.target.restoreStatus.reason, "legacy-ambiguous-index-match");
		console.log("smoke-portable-targets: ambiguous legacy target is stale");

		const staleTaskRel = "tasks/stale-target/task.json";
		const staleTaskFiles = {
			[staleTaskRel]: JSON.stringify({ taskId: "stale-target", target: ambiguous.target }) + "\n",
		};
		const normalizedStaleTask = JSON.parse(
			cloudBundle.normalizeTaskFilesForBundle(destination, staleTaskFiles)[staleTaskRel],
		);
		assert.equal(normalizedStaleTask.target.restoreStatus.reason, "legacy-ambiguous-index-match");
		console.log("smoke-portable-targets: stale status survives a subsequent push normalization");

		const duplicateRepository = portable.migrateTaskTargetForRestore(
			destination,
			{
				repositoryId: "demo",
				workspaceRelativeWorktreePath: "repos/demo",
			},
			{
				repos: [
					{ id: "demo", path: "repos/demo-a", gitRoot: "repos/demo-a" },
					{ id: "demo", path: "repos/demo-b", gitRoot: "repos/demo-b" },
				],
			},
		);
		assert.equal(duplicateRepository.target.workspaceRelativeRepositoryPath, undefined);
		assert.equal(duplicateRepository.target.repositoryPath, undefined);
		assert.equal(duplicateRepository.stale, true);
		assert.equal(duplicateRepository.target.restoreStatus.reason, "legacy-ambiguous-index-match");
		console.log("smoke-portable-targets: duplicate repository identity is stale");

		const sanitizedOutside = portable.sanitizeTaskTargetForBundle(
			destination,
			{
				repositoryId: "demo",
				repositoryPath: "repos/demo",
				worktreePath: "/source-machine/workspace/other-repo",
			},
			{ repos: [{ name: "demo", path: "repos/demo", gitRoot: "repos/demo" }] },
		);
		assert.equal(sanitizedOutside.worktreePath, undefined);
		assert.equal(sanitizedOutside.workspaceRelativeRepositoryPath, "repos/demo");
		assert.equal(sanitizedOutside.repositoryPath, "repos/demo");
		assert.equal(sanitizedOutside.restoreStatus.state, "stale");
		console.log("smoke-portable-targets: outside target is stripped from bundle");

		const traversalRepository = portable.sanitizeTaskTargetForBundle(
			destination,
			{
				repositoryId: "unknown",
				repositoryPath: "../../outside",
				worktreePath: join(destination, "repos", "demo"),
			},
			{ repos: [] },
		);
		assert.equal(traversalRepository.workspaceRelativeRepositoryPath, undefined);
		assert.equal(traversalRepository.repositoryPath, undefined);
		assert.equal(traversalRepository.restoreStatus.reason, "legacy-no-index-match");
		console.log("smoke-portable-targets: traversal repository target is stale");

		const outsideRepository = mkdtempSync(join(tmpdir(), "heli-portable-outside-"));
		const escapedRepository = join(destination, "repo-link");
		symlinkSync(outsideRepository, escapedRepository, "dir");
		try {
			const symlinkRepository = portable.migrateTaskTargetForRestore(
				destination,
				{ workspaceRelativeRepositoryPath: "repo-link" },
				{ repos: [] },
			);
			assert.equal(symlinkRepository.target.workspaceRelativeRepositoryPath, undefined);
			assert.equal(symlinkRepository.target.repositoryPath, undefined);
			assert.equal(symlinkRepository.target.restoreStatus.reason, "invalid-relative-path");
			console.log("smoke-portable-targets: symlink-escaping repository target is stale");
		} finally {
			rmSync(escapedRepository, { force: true });
			rmSync(outsideRepository, { recursive: true, force: true });
		}

		const invalidRelative = portable.migrateTaskTargetForRestore(
			destination,
			{ workspaceRelativeWorktreePath: "../../outside" },
			{ repos: [] },
		);
		assert.equal(invalidRelative.stale, true);
		assert.equal(invalidRelative.target.restoreStatus.reason, "invalid-relative-path");
		console.log("smoke-portable-targets: invalid relative target is stale");
	} finally {
		rmSync(destination, { recursive: true, force: true });
	}
} finally {
	rmSync(workspace, { recursive: true, force: true });
}

console.log("smoke-portable-targets: ok");
