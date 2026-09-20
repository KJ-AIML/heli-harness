import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
	ensureGlobalSetup,
	projectConfigDir,
	readProjectBinding,
	readWorkspaceLock,
	registerWorkspace,
	resolveExecutionIdentity,
	linkedOperationalRoot,
	workspaceManifestPath,
	workspaceLockPath,
} from "../concurrency/project-binding.mjs";
import { canonicalizePath } from "../concurrency/paths.mjs";
import { ensureDir, readJson, writeJsonAtomic } from "../concurrency/fs-atomic.mjs";
import { IDLE_CURRENT_TASK } from "./seed-workspace.mjs";
import { wantsJson, stripOutputFlags, printProtocolResult } from "./output.mjs";
import { protocolOk } from "../protocol/result.mjs";

const PORTABLE_OPERATIONAL_DIRS = ["tasks", "workspace"];
const PORTABLE_STATE_FILES = ["current-task.md", "decisions.md"];
const PROJECT_OVERLAYS = ["profiles", "policies", "safety", "skills"];

function error(code, message) {
	const value = new Error(message);
	value.code = code;
	return value;
}

function activeEmbeddedLeases(projectRoot) {
	const locks = join(projectRoot, ".heli-harness", "locks", "tasks");
	if (!existsSync(locks)) return [];
	const now = Date.now();
	const active = [];
	for (const name of readdirSync(locks)) {
		const dir = join(locks, name);
		if (!statSync(dir).isDirectory()) continue;
		const leasePath = join(dir, "lease.json");
		if (!existsSync(leasePath)) continue;
		const lease = readJson(leasePath, null);
		const expires = Date.parse(lease?.expiresAt || "");
		if (lease?.sessionId && !Number.isNaN(expires) && expires > now) {
			active.push({ taskId: lease.taskId || name.replace(/\.write\.lock$/, ""), lease });
		}
	}
	return active;
}

function copyIfMissing(from, to) {
	if (!existsSync(from)) return false;
	const source = statSync(from);
	if (source.isDirectory()) {
		ensureDir(to);
		let copied = false;
		for (const name of readdirSync(from)) {
			copied = copyIfMissing(join(from, name), join(to, name)) || copied;
		}
		return copied;
	}
	if (existsSync(to)) return false;
	ensureDir(join(to, ".."));
	cpSync(from, to, { force: false });
	return true;
}

function seedOperationalState(projectRoot, operationalRoot) {
	ensureDir(join(operationalRoot, "state"));
	ensureDir(join(operationalRoot, "workspace"));
	const projectName = basename(projectRoot) || "project";
	const stateTask = join(operationalRoot, "state", "current-task.md");
	if (!existsSync(stateTask)) writeFileSync(stateTask, IDLE_CURRENT_TASK, "utf8");
	const decisions = join(operationalRoot, "state", "decisions.md");
	if (!existsSync(decisions)) writeFileSync(decisions, "# Decisions\n\n", "utf8");
	const schemaPath = join(operationalRoot, "workspace", "schema.json");
	if (!existsSync(schemaPath)) {
		writeJsonAtomic(schemaPath, {
			schemaVersion: 1,
			mode: "concurrent",
			updatedAt: new Date().toISOString(),
			note: "linked execution-local authority state",
		});
	}
	const indexPath = join(operationalRoot, "workspace", "index.json");
	if (!existsSync(indexPath)) {
		writeJsonAtomic(indexPath, {
			schemaVersion: 1,
			workspaceRoot: ".",
			repos: [{ name: projectName, path: ".", gitRoot: ".", defaultTarget: true }],
		});
	}
	const targetPath = join(operationalRoot, "workspace", "target.json");
	if (!existsSync(targetPath)) {
		writeJsonAtomic(targetPath, {
			schemaVersion: 1,
			targetRepo: projectName,
			targetGitRoot: ".",
			writesAllowedUnder: ".",
			activeProfile: "",
			selectedAt: new Date().toISOString(),
			selectedBy: "heli link",
			reason: "linked project root",
		});
	}
}

function readPackageMetadata(packageRoot) {
	const pkg = readJson(join(packageRoot, "package.json"), {});
	const manifest = readJson(join(packageRoot, ".heli-harness", "manifest.json"), {});
	return { pkg, manifest };
}

export function linkProject(packageRoot, projectRoot, {
	workspaceId = null,
	env = process.env,
} = {}) {
	const root = canonicalizePath(projectRoot || process.cwd());
	if (!existsSync(root)) throw error("PROJECT_NOT_FOUND", `project directory not found: ${root}`);
	const setup = ensureGlobalSetup(env);
	const existingBinding = readProjectBinding(root);
	const firstLink = !existingBinding;
	const embeddedRoot = join(root, ".heli-harness");

	if (firstLink && existsSync(embeddedRoot)) {
		const embeddedManifest = readJson(join(embeddedRoot, "manifest.json"), null);
		if (!embeddedManifest?.supportsLinkedWorkspace) {
			throw error(
				"EMBEDDED_RUNTIME_TOO_OLD_FOR_LINK",
				"embedded .heli-harness must be updated to a linked-workspace-capable runtime before cutover",
			);
		}
		const active = activeEmbeddedLeases(root);
		if (active.length) {
			throw error(
				"LINK_ACTIVE_AUTHORITY",
				`cannot link while active embedded write authority exists: ${active.map((item) => item.taskId).join(", ")}`,
			);
		}
	}

	ensureDir(projectConfigDir(root));
	for (const name of PROJECT_OVERLAYS) ensureDir(join(projectConfigDir(root), name));

	const id = existingBinding?.workspaceId || workspaceId || `heli-ws-${randomUUID()}`;
	if (!existingBinding) {
		writeJsonAtomic(workspaceManifestPath(root), {
			schemaVersion: 1,
			workspaceId: id,
			mode: "concurrent",
			resources: [{ id: "root", type: "worktree", path: "." }],
			policyProfile: "default",
			createdAt: new Date().toISOString(),
			provenance: { embeddedMigration: existsSync(embeddedRoot) },
		});
	}

	const metadata = readPackageMetadata(packageRoot);
	writeJsonAtomic(workspaceLockPath(root), {
		schemaVersion: 1,
		runtime: {
			package: metadata.pkg?.name || "heli-harness",
			version: metadata.pkg?.version || metadata.manifest?.version || "unknown",
		},
		protocolVersion: 1,
		workspaceSchemaVersion: 1,
		adapterContractVersion: 1,
		policySchemaVersion: 1,
		generatedAt: new Date().toISOString(),
	});

	const operationalRoot = linkedOperationalRoot(root, { env });
	ensureDir(operationalRoot);

	if (firstLink && existsSync(embeddedRoot)) {
		// Evidence/work records may move. Authorization/runtime identity must not:
		// never copy sessions, bindings, locks, yolo, sync state, grants, or
		// capability observations into the linked execution namespace.
		for (const name of PORTABLE_OPERATIONAL_DIRS) {
			copyIfMissing(join(embeddedRoot, name), join(operationalRoot, name));
		}
		ensureDir(join(operationalRoot, "state"));
		for (const name of PORTABLE_STATE_FILES) {
			copyIfMissing(
				join(embeddedRoot, "state", name),
				join(operationalRoot, "state", name),
			);
		}
		for (const name of PROJECT_OVERLAYS) {
			copyIfMissing(join(embeddedRoot, name), join(projectConfigDir(root), name));
		}
	} else if (firstLink) {
		for (const name of ["policies", "safety", "profiles"]) {
			copyIfMissing(
				join(packageRoot, ".heli-harness", name),
				join(projectConfigDir(root), name),
			);
		}
	}

	seedOperationalState(root, operationalRoot);
	const execution = resolveExecutionIdentity(root, { env });
	writeJsonAtomic(join(operationalRoot, "execution.json"), {
		schemaVersion: 1,
		workspaceId: id,
		executionId: execution.executionId,
		machineId: execution.machineId,
		workspaceRoot: execution.canonicalWorkspaceRoot,
		authorityScope: "execution-local",
		updatedAt: new Date().toISOString(),
	});

	const registry = registerWorkspace(root, { env });

	if (existsSync(embeddedRoot)) {
		ensureDir(join(embeddedRoot, "workspace"));
		writeJsonAtomic(join(embeddedRoot, "workspace", "linked.json"), {
			schemaVersion: 1,
			workspaceId: id,
			executionId: execution.executionId,
			note: "authority state moved to linked execution namespace; current v0.10 path resolver follows .heli/workspace.json",
			linkedAt: new Date().toISOString(),
		});
	}

	return {
		workspaceRoot: root,
		workspaceId: id,
		executionId: execution.executionId,
		machineId: setup.machine.machineId,
		projectConfigDir: projectConfigDir(root),
		operationalRoot,
		lock: readWorkspaceLock(root),
		registry,
		firstLink,
	};
}

export function runLink(packageRoot, args = []) {
	const json = wantsJson(args);
	const clean = stripOutputFlags(args);
	let workspaceId = null;
	const positional = [];
	for (let i = 0; i < clean.length; i += 1) {
		if (clean[i] === "--workspace-id" && clean[i + 1]) workspaceId = clean[++i];
		else if (!clean[i].startsWith("--")) positional.push(clean[i]);
	}
	const projectRoot = positional[0] || process.cwd();
	const result = linkProject(packageRoot, resolve(projectRoot), { workspaceId });
	if (json) {
		printProtocolResult(protocolOk("link", result));
		return result;
	}
	console.log("Heli project linked.");
	console.log(`  workspace: ${result.workspaceId}`);
	console.log(`  execution: ${result.executionId}`);
	console.log(`  project config: ${result.projectConfigDir}`);
	console.log(`  local authority state: ${result.operationalRoot}`);
	console.log("  registry: locator-only; deleting it does not change authority");
	console.log("  committed .heli/ identity never carries leases, sessions, grants, or capability observations");
	console.log("");
	console.log("Next:");
	console.log("  heli host status");
	console.log("  heli host install all   # if coding-host integrations are not installed yet");
	console.log("  Start Codex / Pi / Claude / another supported host from this project root.");
	console.log("  After SessionStart, verify live hooks with: heli explain capabilities");
	return result;
}
