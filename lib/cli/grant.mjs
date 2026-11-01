import { resolve } from "node:path";
import { canonicalizePath, findWorkspaceRoot, isDirectory, resolveWorktreeRoot } from "../concurrency/paths.mjs";
import { resourceIdForWorktree } from "../concurrency/resource-authority.mjs";
import {
	issueGrant,
	listGrants,
	revokeGrant,
} from "../concurrency/grant.mjs";
import { projectWorkspaceKey } from "../concurrency/project-binding.mjs";
import { wantsJson, stripOutputFlags, printProtocolResult } from "./output.mjs";
import { protocolOk } from "../protocol/result.mjs";
import { assertHumanTerminal } from "./human-gate.mjs";

function error(code, message) {
	const value = new Error(message);
	value.code = code;
	return value;
}

function parse(args) {
	const json = wantsJson(args);
	const clean = stripOutputFlags(args);
	const sub = clean[0] || "list";
	const flags = {};
	const positional = [];
	for (let i = 1; i < clean.length; i += 1) {
		const value = clean[i];
		if (["--action", "--scope", "--session", "--resource", "--minutes", "--reason", "--execution"].includes(value) && clean[i + 1]) {
			flags[value.slice(2)] = clean[++i];
		} else if (value === "--all") flags.all = true;
		else if (!value.startsWith("--")) positional.push(value);
	}
	return { json, sub, flags, positional };
}

function workspaceFrom(positional, fallback = process.cwd()) {
	const candidate = positional[1] || positional[0] || fallback;
	const root = findWorkspaceRoot(candidate);
	if (!root) throw error("WORKSPACE_NOT_FOUND", `No Heli workspace found from ${candidate}`);
	return root;
}

// A resource id as `heli grant list` prints it, as opposed to a folder.
const RESOURCE_ID = /^worktree-[0-9a-f]+$/i;

/** The folder `--resource` names, or null when it names the workspace or a resource id. */
function resourceFolder(flag) {
	if (!flag || flag === "workspace" || RESOURCE_ID.test(flag)) return null;
	const folder = resolve(process.cwd(), flag);
	if (!isDirectory(folder)) {
		throw error("RESOURCE_NOT_FOUND", `--resource ${flag}: not "workspace", a resource id from \`heli grant list\`, or a folder`);
	}
	return folder;
}

function inWorkspace(folder, workspaceRoot) {
	const root = findWorkspaceRoot(folder);
	return Boolean(root) && canonicalizePath(root) === canonicalizePath(workspaceRoot);
}

/**
 * What a grant is for. `--resource workspace`: every resource of the workspace. `--resource <id>`: that resource.
 * `--resource <folder>` (in the workspace): the worktree the hook checks a call in that folder against, its git toplevel
 * or the folder itself, so a repository nested in the workspace gets its own. With no `--resource`: the worktree of the
 * folder named on the command line, or of the cwd when it is in the workspace, else of the workspace root.
 */
function resourceFor(workspaceRoot, flag, { folder, fallbackFolder }) {
	if (flag === "workspace") {
		return { type: "workspace", id: projectWorkspaceKey(workspaceRoot) };
	}
	if (flag && !folder) return { type: "worktree", id: flag };
	if (folder && !inWorkspace(folder, workspaceRoot)) {
		throw error("RESOURCE_OUTSIDE_WORKSPACE", `--resource ${flag}: ${folder} is not in the workspace ${workspaceRoot}`);
	}
	const base = folder || (fallbackFolder && inWorkspace(fallbackFolder, workspaceRoot) ? fallbackFolder : workspaceRoot);
	return { type: "worktree", id: resourceIdForWorktree(resolveWorktreeRoot(base)) };
}

/**
 * @param {string[]} args
 * @param {{ terminal?: { stdin: boolean, stdout: boolean } }} [options]
 *   terminal: test seam only; the CLI entry never passes it, so the real TTY state decides.
 */
export function runGrant(args = [], { terminal } = {}) {
	const { json, sub, flags, positional } = parse(args);
	let result;
	if (sub === "issue") {
		assertHumanTerminal("heli grant issue", terminal);
		const folder = resourceFolder(flags.resource);
		const workspaceRoot = workspaceFrom(positional, folder || process.cwd());
		if (!flags.action) throw error("GRANT_ACTION_REQUIRED", "--action is required");
		const minutes = Number(flags.minutes);
		const named = positional[0] && isDirectory(resolve(process.cwd(), positional[0])) ? resolve(process.cwd(), positional[0]) : null;
		const grant = issueGrant(workspaceRoot, {
			action: flags.action,
			scope: flags.scope || "once",
			subjectSessionId: flags.session || process.env.HELI_SESSION_ID || null,
			resource: resourceFor(workspaceRoot, flags.resource, { folder, fallbackFolder: named || process.cwd() }),
			ttlSeconds: Number.isFinite(minutes) && minutes > 0 ? minutes * 60 : null,
			reason: flags.reason || null,
			// Default: usable from any checkout of this workspace. --execution pins it.
			executionId: flags.execution || null,
		});
		result = { workspaceRoot, grant };
	} else if (sub === "list") {
		const workspaceRoot = workspaceFrom(positional);
		result = {
			workspaceRoot,
			grants: listGrants(workspaceRoot, { activeOnly: !flags.all }),
		};
	} else if (sub === "revoke") {
		const grantId = positional[0];
		if (!grantId) throw error("GRANT_ID_REQUIRED", "grant id required");
		const workspaceRoot = findWorkspaceRoot(positional[1] || process.cwd());
		if (!workspaceRoot) throw error("WORKSPACE_NOT_FOUND", "No Heli workspace found");
		result = { workspaceRoot, grant: revokeGrant(workspaceRoot, grantId) };
	} else {
		throw error("UNKNOWN_GRANT_COMMAND", `unknown grant command: ${sub}`);
	}

	if (json) {
		printProtocolResult(protocolOk(`grant.${sub}`, result));
		return result;
	}
	if (sub === "list") {
		if (!result.grants.length) console.log("No active scoped grants.");
		for (const grant of result.grants) {
			console.log(`${grant.grantId}  action=${grant.action} scope=${grant.scope} resource=${grant.resource.type}:${grant.resource.id} expires=${grant.expiresAt || "none"}`);
		}
	} else {
		const grant = result.grant;
		console.log(`${sub === "revoke" ? "Revoked" : "Issued"} grant ${grant.grantId}`);
		console.log(`  action: ${grant.action}`);
		console.log(`  scope: ${grant.scope}`);
		console.log(`  resource: ${grant.resource.type}:${grant.resource.id}`);
		// Issue #35: null means any checkout of the workspace; a pinned id prints as such.
		console.log(`  execution: ${grant.executionId || "any (workspace-wide)"}`);
	}
	return result;
}
