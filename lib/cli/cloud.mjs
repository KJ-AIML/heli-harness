/**
 * Cloud sync CLI: heli auth | ws | push | pull.
 *
 * Talks to the heli sync service (cloud/core.mjs contract). Strictly optional:
 * no governance path imports this module — a workspace works fully offline and
 * unauthenticated. Design: docs/architecture/cloud-sync.md.
 *
 * Local files:
 *   <config dir>/credentials.json          { url, token, login }   (per device;
 *       config dir = $HELI_CONFIG_DIR or ~/.heli, file mode 0600 where supported)
 *   .heli-harness/state/sync.json          { workspaceId, name, lastVersion,
 *       lastBundleSha256 }                 (per machine; never part of a bundle)
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { findWorkspaceRoot } from "../concurrency/paths.mjs";
import { writeJsonAtomic } from "../concurrency/fs-atomic.mjs";
import {
	collectBundleFiles,
	packBundle,
	unpackBundle,
	writeBundleFiles,
	scanBundleSecrets,
} from "./cloud-bundle.mjs";

const POLL_TIMEOUT_MS = 15 * 60 * 1000;

function configDir() {
	return process.env.HELI_CONFIG_DIR || join(homedir(), ".heli");
}

function credentialsPath() {
	return join(configDir(), "credentials.json");
}

function readCredentials() {
	if (!existsSync(credentialsPath())) return null;
	try {
		return JSON.parse(readFileSync(credentialsPath(), "utf8"));
	} catch {
		return null;
	}
}

function requireCredentials() {
	const creds = readCredentials();
	if (!creds?.token || !creds?.url) {
		throw new Error("Not logged in. Run: heli auth login --url <sync-server-url>");
	}
	return creds;
}

async function api(creds, method, path, { body = null, headers = {}, raw = false } = {}) {
	const response = await fetch(new URL(path, creds.url), {
		method,
		headers: { authorization: `Bearer ${creds.token}`, ...headers },
		body,
	});
	if (response.status === 401) {
		throw new Error("Sync server rejected this device's token. Run: heli auth login");
	}
	if (raw) return response;
	const data = await response.json().catch(() => ({}));
	if (!response.ok) {
		const error = new Error(data.error ? `Sync server error: ${data.error}` : `Sync server HTTP ${response.status}`);
		error.status = response.status;
		error.data = data;
		throw error;
	}
	return data;
}

function requireWorkspace(args) {
	const pathArg = args.find((a) => !a.startsWith("--"));
	const start = pathArg || process.cwd();
	const root = findWorkspaceRoot(start) || (existsSync(join(start, ".heli-harness")) ? start : null);
	if (!root) throw new Error(`No .heli-harness workspace found at or above: ${start}`);
	return root;
}

function syncStatePath(workspaceRoot) {
	return join(workspaceRoot, ".heli-harness", "state", "sync.json");
}

function readSyncState(workspaceRoot) {
	const path = syncStatePath(workspaceRoot);
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
}

function requireSyncState(workspaceRoot) {
	const state = readSyncState(workspaceRoot);
	if (!state?.workspaceId) {
		throw new Error("Workspace is not linked to a sync workspace. Run: heli ws create <name> (or: heli ws link <name>)");
	}
	return state;
}

function sha256(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}

function flagValue(args, flag) {
	const index = args.indexOf(flag);
	return index >= 0 && args[index + 1] ? args[index + 1] : null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- heli auth

async function authLogin(args) {
	const url = flagValue(args, "--url") || process.env.HELI_SYNC_URL || readCredentials()?.url;
	if (!url) {
		throw new Error("No sync server configured. Run: heli auth login --url <sync-server-url>");
	}
	const start = await fetch(new URL("/auth/device/code", url), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ device_name: `${process.env.COMPUTERNAME || process.env.HOSTNAME || "device"} (${process.platform})` }),
	}).then((r) => r.json());

	console.log(`To authorize this device, open:\n\n  ${start.verification_uri}\n`);
	console.log(`and enter code: ${start.user_code}\n`);
	console.log("Waiting for authorization...");

	const deadline = Date.now() + Math.min(start.expires_in * 1000, POLL_TIMEOUT_MS);
	while (Date.now() < deadline) {
		await sleep((start.interval || 5) * 1000);
		const poll = await fetch(new URL("/auth/device/token", url), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ device_code: start.device_code }),
		});
		const data = await poll.json().catch(() => ({}));
		if (data.token) {
			mkdirSync(configDir(), { recursive: true });
			writeFileSync(credentialsPath(), JSON.stringify({ url, token: data.token, login: data.login }, null, 2), {
				mode: 0o600,
			});
			console.log(`Logged in as ${data.login}. Credentials stored in ${credentialsPath()}`);
			return;
		}
		if (data.error && data.error !== "authorization_pending") {
			throw new Error(`Device authorization failed: ${data.error}`);
		}
	}
	throw new Error("Device authorization timed out. Run: heli auth login");
}

async function runAuth(args) {
	const [sub, ...rest] = args;
	switch (sub) {
		case "login":
			await authLogin(rest);
			return;
		case "logout": {
			const creds = readCredentials();
			if (creds?.token) {
				await api(creds, "POST", "/auth/logout").catch(() => {});
				rmSync(credentialsPath(), { force: true });
			}
			console.log("Logged out.");
			return;
		}
		case "status": {
			const creds = readCredentials();
			if (!creds?.token) {
				console.log("Not logged in.");
				return;
			}
			const who = await api(creds, "GET", "/auth/whoami");
			console.log(`Logged in as ${who.login} (device: ${who.device})`);
			console.log(`Sync server: ${creds.url}`);
			return;
		}
		case "devices": {
			const creds = requireCredentials();
			const revokeId = flagValue(rest, "--revoke");
			if (revokeId) {
				await api(creds, "DELETE", `/auth/devices/${revokeId}`);
				console.log(`Revoked device ${revokeId}`);
				return;
			}
			const devices = await api(creds, "GET", "/auth/devices");
			for (const device of devices) {
				console.log(`${device.id}  ${device.name}${device.current ? "  (this device)" : ""}`);
			}
			if (devices.length === 0) console.log("No devices.");
			return;
		}
		default:
			throw new Error("Usage: heli auth login [--url U] | logout | status | devices [--revoke id]");
	}
}

// ------------------------------------------------------------------ heli ws

function linkWorkspace(workspaceRoot, ws) {
	writeJsonAtomic(syncStatePath(workspaceRoot), {
		workspaceId: ws.id,
		name: ws.name,
		lastVersion: ws.currentVersion ?? 0,
		lastBundleSha256: null,
	});
}

async function runCloudWs(args) {
	const [sub, ...rest] = args;
	const creds = requireCredentials();
	switch (sub) {
		case "create": {
			const name = rest.find((a) => !a.startsWith("--"));
			if (!name) throw new Error("Usage: heli ws create <name>");
			const ws = await api(creds, "POST", "/ws", {
				body: JSON.stringify({ name }),
				headers: { "content-type": "application/json" },
			});
			const workspaceRoot = findWorkspaceRoot(process.cwd());
			if (workspaceRoot) {
				linkWorkspace(workspaceRoot, ws);
				console.log(`Created sync workspace "${ws.name}" (${ws.id}) and linked this workspace.`);
			} else {
				console.log(`Created sync workspace "${ws.name}" (${ws.id}). Run heli ws link ${ws.name} inside a workspace.`);
			}
			return;
		}
		case "link": {
			const name = rest.find((a) => !a.startsWith("--"));
			if (!name) throw new Error("Usage: heli ws link <name>");
			const workspaceRoot = requireWorkspace([]);
			const list = await api(creds, "GET", "/ws");
			const ws = list.find((w) => w.name === name || w.id === name);
			if (!ws) throw new Error(`No sync workspace named "${name}". Run: heli ws list`);
			linkWorkspace(workspaceRoot, { ...ws, currentVersion: 0 });
			console.log(`Linked to sync workspace "${ws.name}" (${ws.id}). Run: heli pull`);
			return;
		}
		case "list": {
			const list = await api(creds, "GET", "/ws");
			for (const ws of list) {
				console.log(`${ws.name}  (${ws.id})  v${ws.currentVersion}`);
			}
			if (list.length === 0) console.log("No sync workspaces. Create one with: heli ws create <name>");
			return;
		}
		case "versions": {
			const workspaceRoot = requireWorkspace(rest);
			const state = requireSyncState(workspaceRoot);
			const data = await api(creds, "GET", `/ws/${state.workspaceId}/versions`);
			console.log(`${data.name} (${data.id}) — current v${data.currentVersion}`);
			for (const version of data.versions) {
				console.log(`  v${version.version}  ${new Date(version.createdAt).toISOString()}  ${version.size} bytes  by ${version.pushedBy}`);
			}
			return;
		}
		case "delete": {
			const name = rest.find((a) => !a.startsWith("--"));
			if (!name) throw new Error("Usage: heli ws delete <name-or-id>");
			const list = await api(creds, "GET", "/ws");
			const ws = list.find((w) => w.name === name || w.id === name);
			if (!ws) throw new Error(`No sync workspace named "${name}".`);
			await api(creds, "DELETE", `/ws/${ws.id}`);
			console.log(`Deleted sync workspace "${ws.name}" (versions retained 30 days server-side).`);
			return;
		}
		default:
			throw new Error("Usage: heli ws create <name> | link <name> | list | versions | delete <name>");
	}
}

// ---------------------------------------------------------- heli push / pull

async function runPush(args) {
	const creds = requireCredentials();
	const workspaceRoot = requireWorkspace(args);
	const state = requireSyncState(workspaceRoot);

	const files = collectBundleFiles(workspaceRoot);
	if (Object.keys(files).length === 0) throw new Error("Nothing to push: portable subset is empty.");

	const findings = scanBundleSecrets(files);
	if (findings.length > 0 && !args.includes("--allow-secrets")) {
		for (const finding of findings) {
			console.error(`  secret? ${finding.file}:${finding.line}  (${finding.id})`);
		}
		throw new Error(
			`Push blocked: ${findings.length} secret-shaped finding(s) in the portable subset. ` +
				"Remove them, or re-run with --allow-secrets if they are false positives.",
		);
	}

	const bundle = packBundle(files);
	let baseVersion = state.lastVersion ?? 0;
	for (;;) {
		try {
			const result = await api(creds, "POST", `/ws/${state.workspaceId}/push`, {
				body: bundle,
				headers: { "content-type": "application/octet-stream", "x-base-version": String(baseVersion) },
			});
			writeJsonAtomic(syncStatePath(workspaceRoot), {
				...state,
				lastVersion: result.version,
				lastBundleSha256: sha256(bundle),
			});
			console.log(`Pushed v${result.version} (${Object.keys(files).length} files, ${bundle.length} bytes) to "${state.name}".`);
			return;
		} catch (error) {
			if (error.status === 409 && args.includes("--force")) {
				baseVersion = error.data.currentVersion;
				continue; // retry on top of the server head; the old head stays retrievable
			}
			if (error.status === 409) {
				throw new Error(
					`Push rejected: server is at v${error.data.currentVersion}, this machine last synced v${baseVersion}. ` +
						"Run: heli pull (then push), or push --force to overwrite (old head stays in version history).",
				);
			}
			throw error;
		}
	}
}

async function runPull(args) {
	const creds = requireCredentials();
	const workspaceRoot = requireWorkspace(args);
	const state = requireSyncState(workspaceRoot);

	// Dirty check: refuse to overwrite unsynced local changes unless --force.
	if (state.lastBundleSha256 && !args.includes("--force")) {
		const localSha = sha256(packBundle(collectBundleFiles(workspaceRoot)));
		if (localSha !== state.lastBundleSha256) {
			throw new Error(
				"Local portable subset has changes since the last sync. Run: heli push first, or pull --force to overwrite them.",
			);
		}
	}

	const versionArg = flagValue(args, "--version");
	const path = `/ws/${state.workspaceId}/pull${versionArg ? `?version=${versionArg}` : ""}`;
	const response = await api(creds, "GET", path, { raw: true });
	if (!response.ok) {
		const data = await response.json().catch(() => ({}));
		throw new Error(data.error === "no_versions" ? "Nothing to pull: no versions pushed yet." : `Pull failed: ${data.error || response.status}`);
	}
	const bytes = Buffer.from(await response.arrayBuffer());
	const files = unpackBundle(bytes);
	const written = writeBundleFiles(workspaceRoot, files);
	const version = Number(response.headers.get("x-version"));
	writeJsonAtomic(syncStatePath(workspaceRoot), {
		...state,
		lastVersion: version,
		lastBundleSha256: sha256(bytes),
	});
	console.log(`Pulled v${version} (${written} files) from "${state.name}".`);
}

export async function runCloud(command, args) {
	switch (command) {
		case "auth":
			return runAuth(args);
		case "ws":
			return runCloudWs(args);
		case "push":
			return runPush(args);
		case "pull":
			return runPull(args);
		default:
			throw new Error(`Unknown cloud command: ${command}`);
	}
}
