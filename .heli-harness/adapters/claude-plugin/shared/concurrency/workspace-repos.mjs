/**
 * Workspace-scoped repository inventory for linked/global Heli workspaces.
 *
 * A linked workspace can govern multiple nested Git repositories. Repository
 * registration is coordination metadata only: it never creates sessions,
 * tasks, grants, or writer authority.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { basename, join, relative } from "node:path";
import {
	canonicalizePath,
	gitShowToplevel,
	pathsFor,
} from "./paths.mjs";
import {
	isPathInside,
	normalizePortableRelativePath,
	readWorkspaceIndex,
	workspaceRelativePath,
} from "./portable-targets.mjs";
import {
	readProjectBinding,
	workspaceManifestPath,
} from "./project-binding.mjs";
import { readJson, writeJsonAtomic } from "./fs-atomic.mjs";

const DISCOVERY_SKIP = new Set([
	".git",
	".heli",
	".heli-harness",
	"node_modules",
	".next",
	"dist",
	"build",
	"coverage",
	"vendor",
]);

function fail(code, message) {
	const error = new Error(message);
	error.code = code;
	throw error;
}

function shortHash(value) {
	return createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
}

function normalizedRepoEntry(workspaceRoot, repo) {
	if (!repo || typeof repo !== "object") return null;
	const rel =
		workspaceRelativePath(workspaceRoot, repo.gitRoot || repo.path || "") ||
		normalizePortableRelativePath(repo.gitRoot || repo.path || "");
	if (!rel) return null;
	return {
		id: String(repo.id || `repo-${shortHash(rel)}`),
		name: String(repo.name || basename(rel === "." ? workspaceRoot : rel) || "repo"),
		path: rel,
		gitRoot: rel,
		profile: String(repo.profile || ""),
		defaultTarget: repo.defaultTarget === true,
	};
}

function writeInventory(workspaceRoot, repos, { env = process.env } = {}) {
	const indexPath = pathsFor(workspaceRoot, { env }).indexPath;
	const normalized = repos
		.map((repo) => normalizedRepoEntry(workspaceRoot, repo))
		.filter(Boolean)
		.sort((a, b) => a.path.localeCompare(b.path));
	writeJsonAtomic(indexPath, {
		schemaVersion: 1,
		workspaceRoot: ".",
		repos: normalized,
	});
	return normalized;
}

function updateManifestResources(workspaceRoot, repos) {
	const binding = readProjectBinding(workspaceRoot);
	if (!binding) return;
	const path = workspaceManifestPath(workspaceRoot);
	const raw = readJson(path, null);
	if (!raw || typeof raw !== "object") return;

	const repositoryPaths = new Set(repos.map((repo) => repo.path));
	const retained = Array.isArray(raw.resources)
		? raw.resources.filter((resource) => resource?.type !== "repository")
		: [];

	for (const repo of repos) {
		retained.push({
			id: repo.id,
			type: "repository",
			path: repo.path,
		});
	}

	// Preserve existing non-repository resources, but remove repository resources
	// that are no longer present in the inventory.
	raw.resources = retained.filter(
		(resource) => resource?.type !== "repository" || repositoryPaths.has(resource.path),
	);
	writeJsonAtomic(path, raw);
}

export function listWorkspaceRepos(workspaceRoot, { env = process.env } = {}) {
	const index = readWorkspaceIndex(workspaceRoot, { env });
	return (Array.isArray(index?.repos) ? index.repos : [])
		.map((repo) => normalizedRepoEntry(workspaceRoot, repo))
		.filter(Boolean);
}

export function repositoryForPath(workspaceRoot, candidatePath, { env = process.env } = {}) {
	const root = canonicalizePath(workspaceRoot);
	const candidate = canonicalizePath(candidatePath);
	const matches = [];
	for (const repo of listWorkspaceRepos(root, { env })) {
		const absolute = canonicalizePath(join(root, repo.path));
		if (!isPathInside(absolute, candidate)) continue;
		matches.push({ repo, absolute });
	}
	matches.sort((a, b) => b.absolute.length - a.absolute.length);
	return matches[0]?.repo || null;
}

function uniqueName(repos, requested, path) {
	const base = String(requested || basename(path) || "repo").trim() || "repo";
	const collision = repos.find((repo) => repo.name === base && repo.path !== path);
	return collision ? `${base}-${shortHash(path).slice(0, 6)}` : base;
}

export function registerWorkspaceRepo(
	workspaceRoot,
	repoPath,
	{
		name = null,
		profile = "",
		defaultTarget = false,
		env = process.env,
	} = {},
) {
	const root = canonicalizePath(workspaceRoot);
	const candidate = canonicalizePath(repoPath || root);
	if (!isPathInside(root, candidate)) {
		fail("REPO_OUTSIDE_WORKSPACE", `repository path is outside workspace: ${candidate}`);
	}
	const gitRoot = gitShowToplevel(candidate);
	if (!gitRoot) fail("REPO_NOT_GIT", `no Git repository found from: ${candidate}`);
	if (!isPathInside(root, gitRoot)) {
		fail("REPO_OUTSIDE_WORKSPACE", `Git root escapes workspace: ${gitRoot}`);
	}
	const rel = workspaceRelativePath(root, gitRoot);
	if (!rel) fail("REPO_PATH_UNPORTABLE", `repository path is not portable inside workspace: ${gitRoot}`);

	const repos = listWorkspaceRepos(root, { env });
	const existing = repos.find((repo) => repo.path === rel);
	const entry = {
		id: existing?.id || `repo-${shortHash(rel)}`,
		name: uniqueName(repos, name || existing?.name, rel),
		path: rel,
		gitRoot: rel,
		profile: String(profile || existing?.profile || ""),
		defaultTarget: Boolean(defaultTarget || existing?.defaultTarget),
	};
	const next = existing
		? repos.map((repo) => (repo.path === rel ? entry : repo))
		: [...repos, entry];

	const written = writeInventory(root, next, { env });
	updateManifestResources(root, written);
	return {
		workspaceRoot: root,
		repository: entry,
		created: !existing,
		repos: written,
	};
}

export function removeWorkspaceRepo(workspaceRoot, selector, { env = process.env } = {}) {
	const root = canonicalizePath(workspaceRoot);
	const needle = String(selector || "").trim();
	if (!needle) fail("REPO_SELECTOR_REQUIRED", "repository id, name, or path is required");
	const repos = listWorkspaceRepos(root, { env });
	const matches = repos.filter((repo) =>
		[repo.id, repo.name, repo.path, repo.gitRoot].some((value) => String(value || "") === needle),
	);
	if (matches.length === 0) fail("REPO_NOT_FOUND", `repository not found: ${needle}`);
	if (matches.length > 1) fail("REPO_AMBIGUOUS", `repository selector is ambiguous: ${needle}`);
	const removed = matches[0];
	const next = repos.filter((repo) => repo.id !== removed.id);
	const written = writeInventory(root, next, { env });
	updateManifestResources(root, written);
	return { workspaceRoot: root, removed, repos: written };
}

function walkForGitRepos(root, current, depth, maxDepth, out) {
	if (depth > maxDepth) return;
	let entries;
	try {
		entries = readdirSync(current, { withFileTypes: true });
	} catch {
		return;
	}
	const hasGit = entries.some((entry) => entry.name === ".git");
	if (hasGit) {
		out.add(canonicalizePath(current));
		// Nested repositories/submodules are explicit enough to discover too, so
		// continue walking while respecting the depth and skip list.
	}
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		if (DISCOVERY_SKIP.has(entry.name)) continue;
		const child = join(current, entry.name);
		if (!isPathInside(root, child)) continue;
		walkForGitRepos(root, child, depth + 1, maxDepth, out);
	}
}

export function discoverWorkspaceRepos(
	workspaceRoot,
	{
		searchPath = workspaceRoot,
		maxDepth = 4,
		env = process.env,
	} = {},
) {
	const root = canonicalizePath(workspaceRoot);
	const start = canonicalizePath(searchPath || root);
	if (!isPathInside(root, start)) {
		fail("DISCOVERY_OUTSIDE_WORKSPACE", `discovery path is outside workspace: ${start}`);
	}
	const found = new Set();
	walkForGitRepos(root, start, 0, maxDepth, found);
	const results = [];
	for (const gitRoot of [...found].sort()) {
		results.push(registerWorkspaceRepo(root, gitRoot, { env }));
	}
	return {
		workspaceRoot: root,
		discovered: results.map((result) => result.repository),
		repos: listWorkspaceRepos(root, { env }),
	};
}
