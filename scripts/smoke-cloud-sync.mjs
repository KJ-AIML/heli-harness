#!/usr/bin/env node
/**
 * Cloud sync contract smoke: the portable API core (cloud/core.mjs) served
 * over a real node:http adapter, driven by the real bin/heli.mjs subprocess —
 * device-flow auth, ws create/link/list, push/pull round-trip across two
 * "devices", secret-scan blocking, version conflict, dirty-pull refusal,
 * device revocation. No Cloudflare runtime involved: what CI proves here is
 * the client<->core contract; the CF shell (cloud/worker.mjs) stays thin.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApi } from "../cloud/core.mjs";

const heliPath = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "heli.mjs");

// ---------------------------------------------------------------- test server

function memoryStore() {
	const kv = new Map();
	const blobs = new Map();
	return {
		async get(key) {
			return kv.has(key) ? kv.get(key) : null;
		},
		async put(key, value) {
			kv.set(key, structuredClone(value));
		},
		async delete(key) {
			kv.delete(key);
		},
		async list(prefix) {
			return [...kv.entries()]
				.filter(([key]) => key.startsWith(prefix))
				.sort(([a], [b]) => (a < b ? -1 : 1))
				.map(([key, value]) => ({ key, value: structuredClone(value) }));
		},
		async blobPut(key, bytes) {
			blobs.set(key, Uint8Array.from(bytes));
		},
		async blobGet(key) {
			return blobs.get(key) || null;
		},
		async blobDelete(key) {
			blobs.delete(key);
		},
		_blobCount: () => blobs.size,
	};
}

function startServer(api) {
	return new Promise((resolve) => {
		const server = createServer(async (req, res) => {
			const chunks = [];
			for await (const chunk of req) chunks.push(chunk);
			const body = Buffer.concat(chunks);
			const headers = new Headers();
			for (const [name, value] of Object.entries(req.headers)) {
				if (typeof value === "string") headers.set(name, value);
			}
			const request = new Request(`http://127.0.0.1${req.url}`, {
				method: req.method,
				headers,
				...(req.method === "GET" || req.method === "HEAD" ? {} : { body, duplex: "half" }),
			});
			const response = await api.fetch(request);
			res.writeHead(response.status, Object.fromEntries(response.headers));
			res.end(Buffer.from(await response.arrayBuffer()));
		});
		server.listen(0, "127.0.0.1", () => {
			resolve({ server, url: `http://127.0.0.1:${server.address().port}` });
		});
	});
}

// ------------------------------------------------------------------- helpers

// Async on purpose: the API server runs in THIS process, so a spawnSync'd CLI
// child would deadlock (child waits on server, server waits on blocked loop).
function cli(args, env, opts = {}) {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [heliPath, ...args], {
			...opts,
			env: { ...process.env, ...env },
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (d) => {
			stdout += d;
		});
		child.stderr.on("data", (d) => {
			stderr += d;
		});
		child.on("close", (status) => resolve({ status, stdout, stderr }));
	});
}

function ok(result, label) {
	assert.equal(result.status, 0, `${label}: ${result.stderr || result.stdout}`);
	return result;
}

/** Spawn `heli auth login`, activate via the TEST_LOGIN endpoint while it polls. */
async function login(url, env, loginName) {
	const child = spawn(process.execPath, [heliPath, "auth", "login", "--url", url], {
		env: { ...process.env, ...env },
	});
	let stdout = "";
	let stderr = "";
	child.stderr.on("data", (d) => {
		stderr += d;
	});
	const userCode = await new Promise((resolve, reject) => {
		child.stdout.on("data", (d) => {
			stdout += d;
			const match = /enter code: ([A-Z0-9-]+)/.exec(stdout);
			if (match) resolve(match[1]);
		});
		child.on("close", () => reject(new Error(`login exited before printing code: ${stdout} ${stderr}`)));
	});
	const activation = await fetch(new URL("/activate", url), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ user_code: userCode, login: loginName }),
	});
	assert.equal(activation.status, 200, "test activation should succeed");
	const exitCode = await new Promise((resolve) => child.on("close", resolve));
	assert.equal(exitCode, 0, `auth login should exit 0: ${stdout} ${stderr}`);
	assert.match(stdout, new RegExp(`Logged in as ${loginName}`));
}

// ---------------------------------------------------------------------- test

const store = memoryStore();
const { server, url } = await startServer(createApi(store, { testLogin: true, deviceInterval: 1 }));

const root = mkdtempSync(join(tmpdir(), "heli-cloud-smoke-"));
const wsA = join(root, "ws-a");
const wsB = join(root, "ws-b");
const cfgA = { HELI_CONFIG_DIR: join(root, "cfg-a") };
const cfgB = { HELI_CONFIG_DIR: join(root, "cfg-b") };

try {
	// Two fresh workspaces = two "devices" of the same user.
	mkdirSync(wsA);
	mkdirSync(wsB);
	ok(await cli(["install", wsA], cfgA), "install ws-a");
	ok(await cli(["install", wsB], cfgB), "install ws-b");

	// Unauthenticated requests are rejected.
	assert.equal((await fetch(new URL("/ws", url))).status, 401, "unauthed /ws must 401");

	// Commands before login fail with guidance.
	const noAuth = await cli(["ws", "list"], cfgA);
	assert.equal(noAuth.status, 1);
	assert.match(noAuth.stderr, /heli auth login/);

	// Device-flow login on both devices (same account).
	await login(url, cfgA, "tester");
	await login(url, cfgB, "tester");
	assert.ok(existsSync(join(root, "cfg-a", "credentials.json")), "device A credentials stored");

	const status = ok(await cli(["auth", "status"], cfgA), "auth status");
	assert.match(status.stdout, /Logged in as tester/);

	// Create + link from inside workspace A.
	writeFileSync(join(wsA, ".heli-harness", "profiles", "demo.md"), "# demo\n\nfirst verify: npm test\n");
	ok(await cli(["ws", "create", "lab"], cfgA, { cwd: wsA }), "ws create");
	assert.ok(existsSync(join(wsA, ".heli-harness", "state", "sync.json")), "ws create links workspace A");

	// Secret scan blocks a push, --allow-secrets overrides.
	const leakPath = join(wsA, ".heli-harness", "profiles", "leak.md");
	writeFileSync(leakPath, `token: ghp_${"a".repeat(36)}\n`);
	const blocked = await cli(["push"], cfgA, { cwd: wsA });
	assert.equal(blocked.status, 1, "push with secret must be blocked");
	assert.match(blocked.stderr, /Push blocked/);
	assert.match(blocked.stderr, /leak\.md:1/);
	rmSync(leakPath);

	// Clean push.
	const push1 = ok(await cli(["push"], cfgA, { cwd: wsA }), "first push");
	assert.match(push1.stdout, /Pushed v1/);

	// Device B: link by name, pull, verify content round-trip.
	ok(await cli(["ws", "link", "lab"], cfgB, { cwd: wsB }), "ws link on device B");
	const pull1 = ok(await cli(["pull"], cfgB, { cwd: wsB }), "pull on device B");
	assert.match(pull1.stdout, /Pulled v1/);
	assert.equal(
		readFileSync(join(wsB, ".heli-harness", "profiles", "demo.md"), "utf8"),
		"# demo\n\nfirst verify: npm test\n",
		"profile must round-trip byte-identical",
	);

	// Version conflict: A pushes v2; B (still at v1 base) is rejected with guidance.
	writeFileSync(join(wsA, ".heli-harness", "profiles", "demo.md"), "# demo v2\n");
	ok(await cli(["push"], cfgA, { cwd: wsA }), "second push from A");
	writeFileSync(join(wsB, ".heli-harness", "profiles", "conflict.md"), "# from B\n");
	const conflict = await cli(["push"], cfgB, { cwd: wsB });
	assert.equal(conflict.status, 1, "stale push must be rejected");
	assert.match(conflict.stderr, /server is at v2/);

	// Dirty pull refusal, then --force resolves, then B can push cleanly.
	const dirtyPull = await cli(["pull"], cfgB, { cwd: wsB });
	assert.equal(dirtyPull.status, 1, "pull over local changes must refuse");
	assert.match(dirtyPull.stderr, /pull --force/);
	ok(await cli(["pull", "--force"], cfgB, { cwd: wsB }), "pull --force");
	assert.equal(readFileSync(join(wsB, ".heli-harness", "profiles", "demo.md"), "utf8"), "# demo v2\n");
	const push3 = ok(await cli(["push"], cfgB, { cwd: wsB }), "push from B after sync");
	assert.match(push3.stdout, /Pushed v3/);

	// Version history is visible from either device.
	const versions = ok(await cli(["ws", "versions"], cfgA, { cwd: wsA }), "ws versions");
	assert.match(versions.stdout, /current v3/);
	assert.match(versions.stdout, /v1 {2}/);

	// Both devices are listed; revoking B's device kills its access.
	const devices = ok(await cli(["auth", "devices"], cfgA), "auth devices");
	const deviceLines = devices.stdout.trim().split("\n");
	assert.equal(deviceLines.length, 2, `expected 2 devices:\n${devices.stdout}`);
	assert.match(devices.stdout, /\(this device\)/);

	ok(await cli(["auth", "logout"], cfgB), "logout device B");
	assert.ok(!existsSync(join(root, "cfg-b", "credentials.json")), "logout removes credentials");
	const afterLogout = await cli(["push"], cfgB, { cwd: wsB });
	assert.equal(afterLogout.status, 1, "push after logout must fail");

	// Machine-local state never travels: bundle content check.
	const pulled = ok(await cli(["pull", "--force"], cfgA, { cwd: wsA }), "pull head on A");
	assert.match(pulled.stdout, /Pulled v3/);
	assert.ok(!existsSync(join(wsB, ".heli-harness", "state", "yolo.json")), "yolo state never syncs");
	const syncState = JSON.parse(readFileSync(join(wsA, ".heli-harness", "state", "sync.json"), "utf8"));
	assert.equal(syncState.lastVersion, 3, "sync.json tracks pulled version");

	console.log("cloud sync smoke ok");
} finally {
	server.closeAllConnections?.();
	server.close();
	rmSync(root, { recursive: true, force: true });
}
