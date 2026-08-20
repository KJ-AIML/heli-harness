/**
 * Portable task-target paths for cross-machine workspace restore.
 * Relative fields are sync authority; absolute fields are local caches.
 */
import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute, join, posix, relative, resolve } from "node:path";
import { readJson, safeRealpath } from "./fs-atomic.mjs";
import { canonicalizePath, pathsFor } from "./paths.mjs";

export const PORTABLE_TARGET_FIELDS = Object.freeze({
	worktree: "workspaceRelativeWorktreePath",
	repository: "workspaceRelativeRepositoryPath",
});

function canonicalPathWithExistingAncestor(input) {
	const absolute = resolve(String(input || "."));
	let probe = absolute;
	const missing = [];
	while (!existsSync(probe) && dirname(probe) !== probe) {
		missing.unshift(basename(probe));
		probe = dirname(probe);
	}
	return canonicalizePath(join(safeRealpath(probe), ...missing));
}

function canonicalWorkspaceRoot(workspaceRoot) {
	return canonicalPathWithExistingAncestor(workspaceRoot);
}

function relativeSegments(root, candidate) {
	const value = relative(root, candidate).replaceAll("\\", "/");
	return value || ".";
}

export function isPathInside(root, candidate) {
	const rel = relativeSegments(canonicalPathWithExistingAncestor(root), canonicalPathWithExistingAncestor(candidate));
	return rel === "." || (rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel));
}

export function normalizePortableRelativePath(value) {
	if (typeof value !== "string" || !value.trim()) return null;
	const input = value.trim().replaceAll("\\", "/");
	if (input.startsWith("/") || /^[A-Za-z]:\//.test(input)) return null;
	const normalized = posix.normalize(input);
	if (normalized === ".." || normalized.startsWith("../")) return null;
	return normalized === "." ? "." : normalized.replace(/^\.\//, "");
}

function resolveTargetInput(workspaceRoot, value) {
	if (typeof value !== "string" || !value.trim()) return null;
	const raw = value.trim();
	return canonicalPathWithExistingAncestor(isAbsolute(raw) ? raw : join(workspaceRoot, raw));
}

export function workspaceRelativePath(workspaceRoot, value) {
	const root = canonicalWorkspaceRoot(workspaceRoot);
	const candidate = resolveTargetInput(root, value);
	if (!candidate || !isPathInside(root, candidate)) return null;
	return normalizePortableRelativePath(relativeSegments(root, candidate));
}

export function resolveWorkspaceRelativePath(workspaceRoot, relativePath) {
	const normalized = normalizePortableRelativePath(relativePath);
	if (!normalized) return null;
	const root = canonicalWorkspaceRoot(workspaceRoot);
	const candidate = canonicalPathWithExistingAncestor(join(root, normalized));
	return isPathInside(root, candidate) ? candidate : null;
}

export function readWorkspaceIndex(workspaceRoot) {
	return readJson(pathsFor(workspaceRoot).indexPath, { repos: [] }) || { repos: [] };
}

function indexRepos(workspaceIndex) {
	if (Array.isArray(workspaceIndex)) return workspaceIndex;
	return Array.isArray(workspaceIndex?.repos) ? workspaceIndex.repos : [];
}

function matchingRepos(workspaceIndex, repositoryId) {
	const needle = String(repositoryId || "").toLowerCase();
	if (!needle) return [];
	return indexRepos(workspaceIndex).filter((repo) =>
			[repo?.id, repo?.name, repo?.path, repo?.gitRoot]
				.map((value) => String(value || "").toLowerCase())
				.includes(needle),
	);
}

function indexedRepositoryRelativePath(workspaceRoot, repo) {
	for (const candidate of [repo?.gitRoot, repo?.path]) {
		const indexed = workspaceRelativePath(workspaceRoot, candidate || "");
		if (indexed) return indexed;
	}
	return null;
}

function safePortableRelativePath(workspaceRoot, value) {
	const normalized = normalizePortableRelativePath(value);
	return normalized && resolveWorkspaceRelativePath(workspaceRoot, normalized) ? normalized : null;
}

function targetWorktreeRelativePath(workspaceRoot, target) {
	const hasPortable = Object.prototype.hasOwnProperty.call(target, PORTABLE_TARGET_FIELDS.worktree);
	if (hasPortable) {
		const normalized = safePortableRelativePath(workspaceRoot, target[PORTABLE_TARGET_FIELDS.worktree]);
		return { relative: normalized, invalid: !normalized };
	}
	return { relative: workspaceRelativePath(workspaceRoot, target?.worktreePath), invalid: false };
}

function repositoryResolution(workspaceRoot, target, workspaceIndex) {
	const hasPortable = Object.prototype.hasOwnProperty.call(target, PORTABLE_TARGET_FIELDS.repository);
	if (hasPortable) {
		const relative = safePortableRelativePath(workspaceRoot, target[PORTABLE_TARGET_FIELDS.repository]);
		return relative
			? { relative, reason: null }
			: { relative: null, reason: "invalid-relative-path" };
	}

	const explicit = workspaceRelativePath(workspaceRoot, target?.repositoryPath);
	if (explicit) return { relative: explicit, reason: null };

	const matches = matchingRepos(workspaceIndex, target?.repositoryId);
	if (matches.length > 1) return { relative: null, reason: "legacy-ambiguous-index-match" };
	if (matches.length === 1) {
		const indexed = indexedRepositoryRelativePath(workspaceRoot, matches[0]);
		return indexed
			? { relative: indexed, reason: null }
			: { relative: null, reason: "invalid-relative-path" };
	}

	return target?.repositoryPath
		? { relative: null, reason: "legacy-no-index-match" }
		: { relative: null, reason: null };
}

export function addPortableTargetPaths(workspaceRoot, target = {}, workspaceIndex = null) {
	const next = { ...target };
	const worktreeRelative = targetWorktreeRelativePath(workspaceRoot, next).relative;
	if (worktreeRelative) next.workspaceRelativeWorktreePath = worktreeRelative;
	else delete next.workspaceRelativeWorktreePath;

	const repositoryRelative = repositoryResolution(workspaceRoot, next, workspaceIndex).relative;
	if (repositoryRelative) next.workspaceRelativeRepositoryPath = repositoryRelative;
	else delete next.workspaceRelativeRepositoryPath;
	return next;
}

function staleTarget(target, reason) {
	const next = { ...target };
	delete next.worktreePath;
	delete next.workspaceRelativeWorktreePath;
	if (next.repositoryPath != null) {
		const repositoryPath = normalizePortableRelativePath(next.repositoryPath);
		if (repositoryPath) next.repositoryPath = repositoryPath;
		else delete next.repositoryPath;
	}
	next.restoreStatus = { state: "stale", reason };
	return next;
}

export function sanitizeTaskTargetForBundle(workspaceRoot, target = {}, workspaceIndex = null) {
	const next = { ...target };
	const worktree = targetWorktreeRelativePath(workspaceRoot, target);
	const worktreeRelative = worktree.relative;
	const repository = repositoryResolution(workspaceRoot, target, workspaceIndex);
	let stale = false;
	let reason = null;
	if (worktreeRelative) next.workspaceRelativeWorktreePath = worktreeRelative;
	else if (worktree.invalid || next.worktreePath) {
		delete next.workspaceRelativeWorktreePath;
		delete next.worktreePath;
		stale = true;
		reason = worktree.invalid ? "invalid-relative-path" : "outside-workspace";
	}
	if (repository.relative) {
		next.workspaceRelativeRepositoryPath = repository.relative;
		if (next.repositoryPath != null) next.repositoryPath = repository.relative;
	} else if (repository.reason) {
		delete next.workspaceRelativeRepositoryPath;
		delete next.repositoryPath;
		stale = true;
		reason = reason || repository.reason;
	}
	delete next.worktreePath;
	if (stale) next.restoreStatus = { state: "stale", reason };
	else if (target.restoreStatus?.state === "stale" && !worktreeRelative) next.restoreStatus = { ...target.restoreStatus };
	else if (next.restoreStatus?.state === "stale") delete next.restoreStatus;
	return next;
}

function legacyIndexMatches(workspaceRoot, legacyPath, workspaceIndex) {
	const normalizedLegacy = String(legacyPath || "").replaceAll("\\", "/").replace(/\/+$/, "");
	const matches = [];
	for (const repo of indexRepos(workspaceIndex)) {
		const indexed = indexedRepositoryRelativePath(workspaceRoot, repo);
		if (!indexed || indexed === ".") continue;
		if (normalizedLegacy === indexed || normalizedLegacy.endsWith(`/${indexed}`)) {
			matches.push(indexed);
		}
	}
	return matches;
}

export function migrateTaskTargetForRestore(workspaceRoot, target = {}, workspaceIndex = null) {
	let next = { ...target };
	let changed = false;
	let stale = false;
	let reason = null;

	const worktree = targetWorktreeRelativePath(workspaceRoot, next);
	const hasRelativeWorktree = Object.prototype.hasOwnProperty.call(next, PORTABLE_TARGET_FIELDS.worktree);
	if (worktree.invalid) {
		next = staleTarget(next, "invalid-relative-path");
		changed = true;
		stale = true;
		reason = "invalid-relative-path";
	} else if (worktree.relative) {
		const resolved = resolveWorkspaceRelativePath(workspaceRoot, worktree.relative);
		if (resolved) {
			next.workspaceRelativeWorktreePath = worktree.relative;
			next.worktreePath = resolved;
			changed = true;
			if (!existsSync(resolved)) {
				stale = true;
				reason = "missing-destination";
			}
		} else {
			next = staleTarget(next, "invalid-relative-path");
			changed = true;
			stale = true;
			reason = "invalid-relative-path";
		}
	} else if (!hasRelativeWorktree && next.worktreePath) {
		const localRelative = workspaceRelativePath(workspaceRoot, next.worktreePath);
		const suffixMatches = localRelative ? [] : legacyIndexMatches(workspaceRoot, next.worktreePath, workspaceIndex);
		const fallbackRelative = localRelative || (suffixMatches.length === 1 ? suffixMatches[0] : null);
		if (fallbackRelative) {
			next.workspaceRelativeWorktreePath = fallbackRelative;
			next.worktreePath = resolveWorkspaceRelativePath(workspaceRoot, fallbackRelative);
			changed = true;
			if (!next.worktreePath || !existsSync(next.worktreePath)) {
				stale = true;
				reason = "missing-destination";
			}
		} else {
			reason = suffixMatches.length > 1 ? "legacy-ambiguous-index-match" : "legacy-no-index-match";
			next = staleTarget(next, reason);
			changed = true;
			stale = true;
		}
	}

	const repository = repositoryResolution(workspaceRoot, next, workspaceIndex);
	if (repository.relative) {
		next.workspaceRelativeRepositoryPath = repository.relative;
		next.repositoryPath = repository.relative;
		changed = true;
	} else if (repository.reason) {
		delete next.workspaceRelativeRepositoryPath;
		delete next.repositoryPath;
		changed = true;
		stale = true;
		reason = reason && reason !== "missing-destination" ? reason : repository.reason;
	}
	if (stale && reason !== "missing-destination") next.restoreStatus = { state: "stale", reason };
	else delete next.restoreStatus;
	return { target: next, changed, stale, reason };
}

export function projectTaskWorktree(workspaceRoot, target = {}, workspaceIndex = null) {
	const migrated = migrateTaskTargetForRestore(workspaceRoot, target, workspaceIndex);
	const worktree = migrated.target.worktreePath || "";
	return {
		worktree,
		source: worktree ? (target.workspaceRelativeWorktreePath ? "task-metadata-relative" : "task-metadata") : "task-metadata-stale",
		stale: migrated.stale || Boolean(migrated.target.restoreStatus?.state === "stale"),
		reason: migrated.reason || migrated.target.restoreStatus?.reason || null,
	};
}
