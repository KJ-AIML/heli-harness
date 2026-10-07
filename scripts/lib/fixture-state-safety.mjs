import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

function lexicalAbsolute(path, label) {
	if (typeof path !== "string" || !path.trim() || !isAbsolute(path)) {
		throw new Error(`${label} must be a non-empty absolute path`);
	}
	if (path.split(/[\\/]+/).includes("..")) {
		throw new Error(`${label} must not contain parent traversal segments`);
	}
	return resolve(path);
}

function canonicalPathWithMissingTail(path) {
	let ancestor = path;
	const tail = [];
	while (!existsSync(ancestor)) {
		const parent = dirname(ancestor);
		if (parent === ancestor) throw new Error(`cannot find an existing ancestor for ${path}`);
		tail.unshift(basename(ancestor));
		ancestor = parent;
	}
	return resolve(realpathSync(ancestor), ...tail);
}

function isSameOrDescendant(root, target) {
	const rel = relative(root, target);
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * Prove that a test cleanup target is strictly inside its dedicated fixture
 * root and does not overlap the user's ~/.heli tree. Existing symlink ancestors
 * are resolved before containment checks, including when the leaf is missing.
 */
function assertFixtureOwnedPathAgainstHeli(targetPath, fixtureRoot, heliPath) {
	const targetInput = lexicalAbsolute(targetPath, "targetPath");
	const rootInput = lexicalAbsolute(fixtureRoot, "fixtureRoot");
	const heliInput = lexicalAbsolute(heliPath, "heliPath");
	if (!existsSync(rootInput)) throw new Error(`fixture root does not exist: ${rootInput}`);
	const root = realpathSync(rootInput);
	const target = canonicalPathWithMissingTail(targetInput);
	const heli = canonicalPathWithMissingTail(heliInput);
	if (isSameOrDescendant(heli, target) || isSameOrDescendant(target, heli)) {
		throw new Error(`refusing cleanup path that overlaps user Heli state: ${target}`);
	}
	if (!isSameOrDescendant(root, target) || target === root) {
		throw new Error(`refusing cleanup outside fixture root ${root}: ${target}`);
	}
	return target;
}

export function assertFixtureOwnedPath(targetPath, fixtureRoot) {
	return assertFixtureOwnedPathAgainstHeli(targetPath, fixtureRoot, resolve(homedir(), ".heli"));
}

/** Remove one explicitly owned fixture path after asserting containment. */
export function removeFixtureOwnedPath(targetPath, fixtureRoot) {
	const safePath = assertFixtureOwnedPath(targetPath, fixtureRoot);
	rmSync(safePath, { recursive: true, force: true });
}

/**
 * Remove only one fixture workspace state directory, never the shared workspaces
 * root. Workspace ids are single path components; callers supply the id minted
 * by the fixture's own `.heli/workspace.json`.
 */
export function removeFixtureWorkspaceState(fixtureDataRoot, fixtureWorkspaceId) {
	if (typeof fixtureWorkspaceId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(fixtureWorkspaceId)) {
		throw new Error(`invalid fixture workspace id: ${String(fixtureWorkspaceId)}`);
	}
	const target = join(fixtureDataRoot, "state", "workspaces", fixtureWorkspaceId);
	removeFixtureOwnedPath(target, fixtureDataRoot);
	return target;
}

/** Regression test for the cleanup guard; safe to run in the normal smoke suite. */
export function runFixtureStateSafetyRegression() {
	const root = resolve(tmpdir(), `heli-fixture-safety-${process.pid}-${Date.now()}`);
	mkdirSync(root, { recursive: true });
	const fixtureDataRoot = join(root, "fixture-data");
	mkdirSync(fixtureDataRoot, { recursive: true });
	const fixtureWorkspaceId = "heli-ws-fixture-123";
	const exactWorkspacePath = join(fixtureDataRoot, "state", "workspaces", fixtureWorkspaceId);
	mkdirSync(join(exactWorkspacePath, "executions"), { recursive: true });
	writeFileSync(join(exactWorkspacePath, "executions", "marker.json"), "{}\n");
	const sibling = join(fixtureDataRoot, "state", "workspaces", "other-fixture-ws");
	mkdirSync(sibling, { recursive: true });
	writeFileSync(join(sibling, "keep.json"), "keep\n");

	try {
		assert.equal(
			assertFixtureOwnedPath(exactWorkspacePath, fixtureDataRoot),
			canonicalPathWithMissingTail(resolve(exactWorkspacePath)),
		);
		removeFixtureWorkspaceState(fixtureDataRoot, fixtureWorkspaceId);
		assert.equal(existsSync(exactWorkspacePath), false, "exact fixture workspace is removed");
		assert.equal(existsSync(join(sibling, "keep.json")), true, "sibling workspace remains");

		const outside = join(root, "outside-workspace");
		mkdirSync(outside, { recursive: true });
		assert.throws(() => assertFixtureOwnedPath(outside, fixtureDataRoot), /outside fixture root/);
		assert.throws(() => removeFixtureOwnedPath(outside, fixtureDataRoot), /outside fixture root/);
		assert.equal(existsSync(outside), true, "outside path was not removed");

		// Simulate a production Heli home. The guard refuses its state root even if
		// a caller mistakenly claims a fixture root that contains it.
		const productionHeli = join(homedir(), ".heli");
		const productionEntriesBefore = existsSync(productionHeli)
			? realpathSync(productionHeli)
			: null;
		const productionState = join(productionHeli, "state", "workspaces", "must-never-delete");
		assert.throws(
			() => removeFixtureOwnedPath(productionState, fixtureDataRoot),
			/overlaps user Heli state/,
		);
		if (productionEntriesBefore) {
			assert.equal(existsSync(productionEntriesBefore), true, "the real ~/.heli root survives refusal");
		}

		// Use an existing synthetic protected root for the symlink regression so the
		// test is deterministic on clean CI runners where ~/.heli does not exist.
		// The exported guard still derives the real protected root from homedir().
		const syntheticHeli = join(root, "synthetic-home", ".heli");
		mkdirSync(syntheticHeli, { recursive: true });
		const symlinkRoot = join(root, "fixture-symlink");
		mkdirSync(symlinkRoot, { recursive: true });
		const escapedLink = join(symlinkRoot, "escape");
		symlinkSync(syntheticHeli, escapedLink, "dir");
		assert.throws(
			() => assertFixtureOwnedPathAgainstHeli(
				join(escapedLink, "state", "workspaces", "must-never-delete"),
				symlinkRoot,
				syntheticHeli,
			),
			/overlaps user Heli state/,
		);
		assert.equal(existsSync(syntheticHeli), true, "symlink escape did not mutate the protected Heli root");
	} finally {
		// Remove this exact temporary test root. Its parent is the system temp dir,
		// and the user's real ~/.heli is independently excluded by the guard.
		removeFixtureOwnedPath(root, tmpdir());
	}
	return true;
}
