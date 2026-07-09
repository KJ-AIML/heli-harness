import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function readJson(path) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
}

function paths(cwd) {
	return {
		indexPath: join(cwd, ".heli-harness", "workspace", "index.json"),
		targetPath: join(cwd, ".heli-harness", "workspace", "target.json"),
	};
}

export function listRepos(cwd) {
	const { indexPath } = paths(cwd);
	const index = existsSync(indexPath) ? readJson(indexPath) : null;
	if (!index || !Array.isArray(index.repos)) {
		return { configured: false };
	}
	return { configured: true, repos: index.repos };
}

export function showTarget(cwd) {
	const { indexPath, targetPath } = paths(cwd);
	const index = existsSync(indexPath) ? readJson(indexPath) : null;
	const target = existsSync(targetPath) ? readJson(targetPath) : null;
	return {
		indexConfigured: !!index,
		targetRepo: target?.targetRepo || "",
		targetGitRoot: target?.targetGitRoot || "",
		writesAllowedUnder: target?.writesAllowedUnder || "",
		activeProfile: target?.activeProfile || "",
	};
}

export function setTarget(cwd, selector, { confirm = false } = {}) {
	const { indexPath, targetPath } = paths(cwd);
	const index = existsSync(indexPath) ? readJson(indexPath) : null;
	if (!index || !Array.isArray(index.repos)) {
		throw new Error("Workspace index is not configured — create .heli-harness/workspace/index.json to track repos");
	}
	const selectorLower = selector.toLowerCase();
	const match = index.repos.find((repo) =>
		[repo.name, repo.path, repo.gitRoot].some((value) => String(value || "").toLowerCase() === selectorLower));
	if (!match) {
		throw new Error(`No workspace repo matched "${selector}"`);
	}

	const existingTarget = existsSync(targetPath) ? readJson(targetPath) : null;
	const currentRepo = existingTarget?.targetRepo || "";
	if (currentRepo && currentRepo !== match.name && !confirm) {
		return { needsConfirm: true, currentRepo, newRepo: match.name };
	}

	const gitRoot = match.gitRoot || match.path;
	const newTarget = {
		schemaVersion: 1,
		targetRepo: match.name,
		targetGitRoot: gitRoot,
		writesAllowedUnder: gitRoot,
		activeProfile: match.profile || "",
		selectedAt: new Date().toISOString(),
		selectedBy: "heli-cli",
		reason: selector,
	};
	writeFileSync(targetPath, JSON.stringify(newTarget, null, 2) + "\n");
	return { needsConfirm: false, target: newTarget };
}

export function clearTarget(cwd) {
	const { targetPath } = paths(cwd);
	const cleared = {
		schemaVersion: 1,
		targetRepo: "",
		targetGitRoot: "",
		writesAllowedUnder: "",
		activeProfile: "",
		selectedAt: new Date().toISOString(),
		selectedBy: "heli-cli",
		reason: "cleared",
	};
	writeFileSync(targetPath, JSON.stringify(cleared, null, 2) + "\n");
	return cleared;
}

export function runTarget(args) {
	const [subcommand, ...rest] = args;
	const confirm = rest.includes("--confirm");
	const positional = rest.filter((arg) => arg !== "--confirm");

	switch (subcommand || "show") {
		case "list": {
			const cwd = positional[0] || process.cwd();
			const result = listRepos(cwd);
			if (!result.configured) {
				console.log("Workspace index is not configured");
				console.log("Create .heli-harness/workspace/index.json to track repos");
				return;
			}
			console.log(`Known repos: ${result.repos.length}`);
			for (const repo of result.repos) {
				const suffix = repo.defaultTarget ? "; default" : "";
				console.log(`${repo.name || "(unnamed)"} -> path=${repo.path || "missing"}; gitRoot=${repo.gitRoot || "missing"}; profile=${repo.profile || "missing"}${suffix}`);
			}
			return;
		}
		case "show": {
			const cwd = positional[0] || process.cwd();
			const result = showTarget(cwd);
			console.log(result.indexConfigured ? "Workspace index: detected" : "Workspace index: not configured");
			console.log(`Target repo: ${result.targetRepo || "not selected"}`);
			console.log(`Target git root: ${result.targetGitRoot || "not selected"}`);
			console.log(`Writes allowed under: ${result.writesAllowedUnder || "not selected"}`);
			console.log(`Active profile: ${result.activeProfile || "not selected"}`);
			console.log("Usage: heli target list [path] | heli target show [path] | heli target set <repo> [--confirm] [path] | heli target clear [path]");
			return;
		}
		case "set": {
			const [selector, path] = positional;
			if (!selector) {
				console.log("Usage: heli target set <repo-name-or-path> [--confirm] [path]");
				return;
			}
			const cwd = path || process.cwd();
			const result = setTarget(cwd, selector, { confirm });
			if (result.needsConfirm) {
				console.log(`Target mismatch: the active target is "${result.currentRepo}", you're about to switch to "${result.newRepo}".`);
				console.log(`Re-run with --confirm to proceed: heli target set ${selector} --confirm${path ? ` ${path}` : ""}`);
				return;
			}
			console.log(`Target repo set: ${result.target.targetRepo}`);
			console.log(`Target git root: ${result.target.targetGitRoot}`);
			return;
		}
		case "clear": {
			const cwd = positional[0] || process.cwd();
			clearTarget(cwd);
			console.log("Target repo cleared");
			return;
		}
		default:
			console.log("Usage: heli target list [path] | show [path] | set <repo> [--confirm] [path] | clear [path]");
	}
}
