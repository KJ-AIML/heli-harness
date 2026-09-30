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
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApi } from "../cloud/core.mjs";
import { runCloud } from "../lib/cli/cloud.mjs";
import { canonicalizePath, isConcurrentMode } from "../lib/concurrency/index.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const heliPath = join(packageRoot, "bin", "heli.mjs");

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

/**
 * Runs a cloud command in THIS process as a human at a terminal would. The terminal is a function
 * argument (the seam heli's grant/yolo tests use); no environment variable or flag stands in for it.
 * Same { status, stdout, stderr } shape as cli(). Async on purpose: the API server lives in this process.
 */
async function asHuman(command, args, env = {}, { terminal = { stdin: true, stdout: true } } = {}) {
	const saved = new Map();
	for (const [name, value] of Object.entries(env)) {
		saved.set(name, process.env[name]);
		process.env[name] = value;
	}
	const original = { log: console.log, warn: console.warn, error: console.error };
	let stdout = "";
	let stderr = "";
	console.log = (...parts) => {
		stdout += `${parts.join(" ")}\n`;
	};
	console.warn = console.error = (...parts) => {
		stderr += `${parts.join(" ")}\n`;
	};
	try {
		await runCloud(command, args, packageRoot, { terminal });
		return { status: 0, stdout, stderr };
	} catch (error) {
		return { status: 1, stdout, stderr: `${stderr}Error: ${error.message}\n`, error };
	} finally {
		Object.assign(console, original);
		for (const [name, value] of saved) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	}
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
	mkdirSync(join(wsA, "repos", "demo"), { recursive: true });
	writeFileSync(
		join(wsA, ".heli-harness", "workspace", "index.json"),
		JSON.stringify({
			schemaVersion: 1,
			workspaceRoot: ".",
			repos: [{ name: "demo", path: "repos/demo", gitRoot: "repos/demo" }],
		}) + "\n",
	);
	ok(await cli(["ws", "create", "lab"], cfgA, { cwd: wsA }), "ws create");
	assert.ok(existsSync(join(wsA, ".heli-harness", "state", "sync.json")), "ws create links workspace A");
	ok(
		await cli(
			["task", "create", "portable-restore", "--work-item", "portable-restore", "--repo", "demo", "--worktree", join(wsA, "repos", "demo")],
			cfgA,
			{ cwd: wsA },
		),
		"create portable restore task",
	);

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

	// Device B: link by name, pull, verify content round-trip. A task's event log is governance state, so a
	// plain pull refuses it and writes nothing; a human accepts it.
	ok(await cli(["ws", "link", "lab"], cfgB, { cwd: wsB }), "ws link on device B");
	mkdirSync(join(wsB, "repos", "demo"), { recursive: true });
	const plainPull = await cli(["pull"], cfgB, { cwd: wsB });
	assert.equal(plainPull.status, 1, "a pull that brings a task's event log needs acceptance");
	assert.match(plainPull.stderr, /tasks\/portable-restore\/events\.jsonl \(added\)/);
	assert.match(plainPull.stderr, /--accept-policy-changes/);
	assert.equal(existsSync(join(wsB, ".heli-harness", "profiles", "demo.md")), false, "a refused pull writes nothing");
	const pull1 = ok(await asHuman("pull", [wsB, "--accept-policy-changes"], cfgB), "pull on device B");
	assert.match(pull1.stdout, /Pulled v1/);
	assert.equal(
		readFileSync(join(wsB, ".heli-harness", "profiles", "demo.md"), "utf8"),
		"# demo\n\nfirst verify: npm test\n",
		"profile must round-trip byte-identical",
	);
	const restoredPortableTask = JSON.parse(
		readFileSync(join(wsB, ".heli-harness", "tasks", "portable-restore", "task.json"), "utf8"),
	);
	assert.equal(restoredPortableTask.target.workspaceRelativeWorktreePath, "repos/demo");
	assert.equal(restoredPortableTask.target.worktreePath, canonicalizePath(join(wsB, "repos", "demo")));
	assert.equal(restoredPortableTask.target.worktreePath.includes(canonicalizePath(wsA)), false);
	console.log("cloud sync smoke: cross-root task target restored");

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

	// ---- Phase 2: heli sync ----
	const upToDate = ok(await cli(["sync"], cfgA, { cwd: wsA }), "sync when aligned");
	assert.match(upToDate.stdout, /Up to date \(v3\)/);
	writeFileSync(join(wsA, ".heli-harness", "profiles", "demo.md"), "# demo v4\n");
	const syncPush = ok(await cli(["sync"], cfgA, { cwd: wsA }), "sync pushes local changes");
	assert.match(syncPush.stdout, /Pushed v4/);

	// ---- Phase 2: auto-push on task complete ----
	ok(await cli(["sync", "auto", "on"], cfgA, { cwd: wsA }), "enable sync.auto");
	ok(await cli(["task", "create", "smoke-auto", "--work-item", "auto", "--repo", "demo"], cfgA, { cwd: wsA }), "task create");
	const claim = ok(await cli(["task", "claim", "smoke-auto", "--mode", "write"], cfgA, { cwd: wsA }), "task claim");
	const sessionId = /session: (\S+)/.exec(claim.stdout)[1];
	const complete = ok(
		await cli(["task", "complete", "smoke-auto"], { ...cfgA, HELI_SESSION_ID: sessionId }, { cwd: wsA }),
		"task complete with sync.auto",
	);
	assert.match(complete.stdout, /Pushed v5/, "task complete must auto-push");
	ok(await cli(["sync", "auto", "off"], cfgA, { cwd: wsA }), "disable sync.auto");

	// ---- Phase 2: E2E encryption ----
	const passphrase = { HELI_E2E_PASSPHRASE: "correct horse battery staple" };
	ok(await cli(["sync", "e2e", "on"], cfgA, { cwd: wsA }), "enable e2e");
	const noPass = await cli(["push"], cfgA, { cwd: wsA });
	assert.equal(noPass.status, 1, "e2e push without passphrase must fail");
	assert.match(noPass.stderr, /HELI_E2E_PASSPHRASE/);
	writeFileSync(join(wsA, ".heli-harness", "profiles", "demo.md"), "# demo v6 secret contents\n");
	const e2ePush = ok(await cli(["push"], { ...cfgA, ...passphrase }, { cwd: wsA }), "e2e push");
	assert.match(e2ePush.stdout, /E2E encrypted/);

	// Server-side bytes must be ciphertext: no plaintext marker in stored blob.
	const storedBundle = await store.blobGet(`bundle:${syncState.workspaceId}:6`);
	assert.ok(storedBundle, "server stores v6 blob");
	const { gunzipSync } = await import("node:zlib");
	const outer = JSON.parse(gunzipSync(Buffer.from(storedBundle)).toString("utf8"));
	assert.equal(outer.encryption, "aes-256-gcm-scrypt-bound", "stored bundle is encrypted and bound");
	assert.equal(outer.workspaceId, syncState.workspaceId, "ciphertext is bound to its sync workspace");
	assert.equal(outer.version, 6, "ciphertext is bound to the version it was stored as");
	assert.ok(!JSON.stringify(outer).includes("secret contents"), "no plaintext on the server");

	// Device B was logged out above — log back in first, then test passphrase paths.
	await login(url, cfgB, "tester");
	const b2NoPass = await cli(["pull", "--force"], cfgB, { cwd: wsB });
	assert.equal(b2NoPass.status, 1, "e2e pull without passphrase must fail");
	assert.match(b2NoPass.stderr, /HELI_E2E_PASSPHRASE/);
	const b2Wrong = await cli(["pull", "--force"], { ...cfgB, HELI_E2E_PASSPHRASE: "wrong" }, { cwd: wsB });
	assert.equal(b2Wrong.status, 1, "wrong passphrase must fail");
	assert.match(b2Wrong.stderr, /wrong HELI_E2E_PASSPHRASE/);
	const plainE2ePull = await cli(["pull", "--force"], { ...cfgB, ...passphrase }, { cwd: wsB });
	assert.equal(plainE2ePull.status, 1, "another device's task events need acceptance");
	assert.match(plainE2ePull.stderr, /tasks\/smoke-auto\/events\.jsonl \(added\)/);
	ok(await asHuman("pull", [wsB, "--force", "--accept-policy-changes"], { ...cfgB, ...passphrase }), "e2e pull with passphrase");
	// Pulling an encrypted bundle turns e2e on locally: no silent plaintext downgrade.
	assert.equal(
		JSON.parse(readFileSync(join(wsB, ".heli-harness", "state", "sync.json"), "utf8")).e2e,
		true,
		"e2e sticks after pulling an encrypted bundle",
	);
	assert.equal(
		readFileSync(join(wsB, ".heli-harness", "profiles", "demo.md"), "utf8"),
		"# demo v6 secret contents\n",
		"e2e content round-trips",
	);

	// ---- Phase 2: heli init full device restore ----
	const wsC = join(root, "ws-c");
	const plainInit = await cli(["init", "lab", "--dir", wsC], { ...cfgA, ...passphrase });
	assert.equal(plainInit.status, 1, "a fresh device's task history needs acceptance");
	assert.match(plainInit.stderr, /tasks\/portable-restore\/events\.jsonl \(added\)/);
	assert.equal(existsSync(join(wsC, ".heli-harness", "profiles", "demo.md")), false, "a refused init restores nothing");
	const init = ok(
		await asHuman("init", ["lab", "--dir", wsC, "--accept-policy-changes"], { ...cfgA, ...passphrase }),
		"init restores a fresh device",
	);
	assert.match(init.stdout, /restored at/);
	assert.equal(
		readFileSync(join(wsC, ".heli-harness", "profiles", "demo.md"), "utf8"),
		"# demo v6 secret contents\n",
		"init pulls full context onto a fresh machine",
	);

	// ---- Governance: heli ws unlink returns to local-only (works without creds) ----
	const unlink = ok(await cli(["ws", "unlink"], {}, { cwd: wsC }), "ws unlink without credentials");
	assert.match(unlink.stdout, /local-only/);
	assert.ok(!existsSync(join(wsC, ".heli-harness", "state", "sync.json")), "unlink removes sync.json");
	const unlinkAgain = ok(await cli(["ws", "unlink"], {}, { cwd: wsC }), "ws unlink idempotent");
	assert.match(unlinkAgain.stdout, /already local-only/);
	const pushUnlinked = await cli(["push"], { ...cfgA, ...passphrase }, { cwd: wsC });
	assert.equal(pushUnlinked.status, 1, "push after unlink must fail");
	assert.match(pushUnlinked.stderr, /not linked/);

	// ---- Hardening: a hostile or broken server cannot downgrade, roll back,
	// relabel, or silently change governance through a pull ----
	const wsId = syncState.workspaceId;
	const tokenA = JSON.parse(readFileSync(join(root, "cfg-a", "credentials.json"), "utf8")).token;
	const authA = { authorization: `Bearer ${tokenA}` };
	const headVersion = async () => (await (await fetch(new URL(`/ws/${wsId}/versions`, url), { headers: authA })).json()).currentVersion;
	const pushRaw = async (bytes) => {
		const response = await fetch(new URL(`/ws/${wsId}/push`, url), {
			method: "POST",
			headers: { ...authA, "content-type": "application/octet-stream", "x-base-version": String(await headVersion()) },
			body: bytes,
		});
		const text = await response.text();
		assert.equal(response.status, 200, text);
		return JSON.parse(text).version;
	};
	const { packBundle } = await import("../lib/cli/cloud-bundle.mjs");

	// E2E is latched on for B, so a plaintext head is refused and nothing is written.
	assert.equal(JSON.parse(readFileSync(join(wsB, ".heli-harness", "state", "sync.json"), "utf8")).e2e, true);
	const plaintextVersion = await pushRaw(packBundle({ "profiles/demo.md": "# downgraded\n" }));
	const downgrade = await cli(["pull", "--force"], { ...cfgB, ...passphrase }, { cwd: wsB });
	assert.equal(downgrade.status, 1, "plaintext must be refused when E2E is on");
	assert.match(downgrade.stderr, /Refusing an unencrypted bundle/);
	assert.equal(readFileSync(join(wsB, ".heli-harness", "profiles", "demo.md"), "utf8"), "# demo v6 secret contents\n");

	// A proper encrypted head on top of it; B applies it.
	ok(await cli(["push", "--force"], { ...cfgA, ...passphrase }, { cwd: wsA }), "encrypted push over the injected plaintext");
	const goodHead = await headVersion();
	assert.equal(goodHead, plaintextVersion + 1);
	ok(await cli(["pull", "--force"], { ...cfgB, ...passphrase }, { cwd: wsB }), "pull the encrypted head");

	// Rollback: the server claims an older head -> refused; an explicit --version restore still works.
	const wsKey = (await store.list("ws:")).find(({ value }) => value.id === wsId).key;
	const wsRecord = await store.get(wsKey);
	await store.put(wsKey, { ...wsRecord, currentVersion: 6 });
	const rollback = await cli(["pull", "--force"], { ...cfgB, ...passphrase }, { cwd: wsB });
	assert.equal(rollback.status, 1, "an older head must be refused");
	assert.match(rollback.stderr, /possible rollback/);
	ok(await cli(["pull", "--version", "6", "--force"], { ...cfgB, ...passphrase }, { cwd: wsB }), "deliberate restore of v6");
	await store.put(wsKey, wsRecord);

	// Relabel: the server serves v6's ciphertext as the head -> AES-GCM binding fails.
	const headBlob = await store.blobGet(`bundle:${wsId}:${goodHead}`);
	await store.blobPut(`bundle:${wsId}:${goodHead}`, await store.blobGet(`bundle:${wsId}:6`));
	const relabeled = await cli(["pull", "--force"], { ...cfgB, ...passphrase }, { cwd: wsB });
	assert.equal(relabeled.status, 1, "a relabeled bundle must not decrypt");
	assert.match(relabeled.stderr, /different workspace or version/);
	await store.blobPut(`bundle:${wsId}:${goodHead}`, headBlob);

	// Governance-bearing changes need explicit acceptance; a refused pull writes nothing.
	writeFileSync(join(wsA, ".heli-harness", "safety", "command-rules.json"), `${JSON.stringify({ version: 1, rules: [] })}\n`);
	writeFileSync(join(wsA, ".heli-harness", "tasks", "portable-restore", "yolo.json"), `${JSON.stringify({ enabled: true })}\n`);
	ok(await cli(["push", "--force"], { ...cfgA, ...passphrase }, { cwd: wsA }), "push governance changes");
	const policyPull = await cli(["pull", "--force"], { ...cfgB, ...passphrase }, { cwd: wsB });
	assert.equal(policyPull.status, 1, "governance changes must not apply silently");
	assert.match(policyPull.stderr, /safety\/command-rules\.json \(modified\)/);
	assert.match(policyPull.stderr, /tasks\/portable-restore\/yolo\.json \(added\)/);
	assert.match(policyPull.stderr, /--accept-policy-changes/);
	assert.match(policyPull.stderr, /in your own terminal/);
	assert.doesNotMatch(policyPull.stderr, /cannot accept|can't accept/i, "the message says what to do, not what an agent cannot do");
	assert.equal(existsSync(join(wsB, ".heli-harness", "tasks", "portable-restore", "yolo.json")), false, "a refused pull writes nothing");
	// Accepting them is a human decision: without a terminal the flag is refused before anything else runs,
	// and no environment variable stands in for one (an agent's shell has neither).
	const acceptRefusal = /`heli pull --accept-policy-changes` must be run by a human in an interactive terminal/;
	const noTerminal = await cli(["pull", "--force", "--accept-policy-changes"], { ...cfgB, ...passphrase }, { cwd: wsB });
	assert.equal(noTerminal.status, 1, "--accept-policy-changes needs a human terminal");
	assert.match(noTerminal.stderr, acceptRefusal);
	const bypassEnv = { HELI_YOLO: "1", HELI_GUARDS: "off", HELI_ALLOW_COMMAND: "heli-privileged-command", HELI_HUMAN: "1", HELI_TERMINAL: "1", FORCE_TTY: "1", CI: "1", TERM: "xterm" };
	const bypassed = await cli(["pull", "--force", "--accept-policy-changes"], { ...cfgB, ...passphrase, ...bypassEnv }, { cwd: wsB });
	assert.equal(bypassed.status, 1, "no environment variable stands in for a human");
	assert.match(bypassed.stderr, acceptRefusal);
	const halfTerminal = await asHuman("pull", [wsB, "--force", "--accept-policy-changes"], { ...cfgB, ...passphrase }, { terminal: { stdin: true, stdout: false } });
	assert.equal(halfTerminal.status, 1, "stdin and stdout must both be a terminal");
	assert.equal(halfTerminal.error?.code, "HUMAN_TERMINAL_REQUIRED");
	assert.equal(existsSync(join(wsB, ".heli-harness", "tasks", "portable-restore", "yolo.json")), false, "a refused acceptance writes nothing");
	const syncRefusal = await cli(["sync", "--accept-policy-changes"], { ...cfgB, ...passphrase }, { cwd: wsB });
	assert.equal(syncRefusal.status, 1);
	assert.match(syncRefusal.stderr, /`heli sync --accept-policy-changes` must be run by a human/);
	const pushRefusal = await cli(["push", "--accept-policy-changes"], { ...cfgB, ...passphrase }, { cwd: wsB });
	assert.equal(pushRefusal.status, 1, "the flag is human-only whichever command carries it");
	assert.match(pushRefusal.stderr, /`heli push --accept-policy-changes` must be run by a human/);
	// Accepting is not blind: the changes that are applied are printed, so the human sees what they accepted.
	const accepted = ok(await asHuman("pull", [wsB, "--force", "--accept-policy-changes"], { ...cfgB, ...passphrase }), "accept governance changes");
	assert.match(accepted.stdout, /Accepting 2 governance change\(s\)/);
	assert.match(accepted.stdout, /governance change: safety\/command-rules\.json \(modified\)/);
	assert.match(accepted.stdout, /governance change: tasks\/portable-restore\/yolo\.json \(added\)/);
	const nothingToAccept = ok(await asHuman("pull", [wsB, "--force", "--accept-policy-changes"], { ...cfgB, ...passphrase }), "the flag with nothing to accept");
	assert.doesNotMatch(nothingToAccept.stdout, /Accepting|governance change/, "no list when there is nothing to accept");
	assert.deepEqual(JSON.parse(readFileSync(join(wsB, ".heli-harness", "safety", "command-rules.json"), "utf8")).rules, []);

	// init --clone: index.json paths/remotes from the server cannot escape the
	// workspace or inject git options; a safe local remote still clones.
	const remoteRepo = join(root, "remote-repo");
	// Clone targets a server must not be able to choose: inside Heli's own state (a clone there would bypass the
	// governance check of a pull), inside the root dot-folders of the workspace, or any hidden folder.
	const HOSTILE_CLONE_TARGETS = [
		".heli-harness/tasks/evil",
		".heli-harness/profiles/evil",
		".heli/config",
		".git/hooks/evil",
		".claude/evil",
		"repos/.hidden",
	];
	const git = (...gitArgs) => {
		const result = spawnSync("git", gitArgs, { encoding: "utf8" });
		assert.equal(result.status, 0, result.stderr);
	};
	git("init", "-q", remoteRepo);
	writeFileSync(join(remoteRepo, "README.md"), "# remote\n");
	git("-C", remoteRepo, "add", "README.md");
	git("-C", remoteRepo, "-c", "user.name=heli", "-c", "user.email=heli@example.invalid", "commit", "-q", "-m", "init");
	writeFileSync(
		join(wsA, ".heli-harness", "workspace", "index.json"),
		`${JSON.stringify({
			schemaVersion: 1,
			workspaceRoot: ".",
			repos: [
				{ name: "good", path: "repos/good", remote: remoteRepo },
				{ name: "escape", path: "../escaped", remote: remoteRepo },
				{ name: "option", path: "repos/option", remote: "--upload-pack=touch pwned" },
				{ name: "dash", path: "-rf", remote: remoteRepo },
				...HOSTILE_CLONE_TARGETS.map((path, index) => ({ name: `hostile-${index}`, path, remote: remoteRepo })),
			],
		})}\n`,
	);
	ok(await cli(["push", "--force"], { ...cfgA, ...passphrase }, { cwd: wsA }), "push repo index");

	// The repo map is governance too: task targets and `init --clone` resolve against it, so a plain pull refuses a changed one.
	const indexFile = join(wsB, ".heli-harness", "workspace", "index.json");
	assert.equal(JSON.parse(readFileSync(indexFile, "utf8")).repos.length, 1);
	const indexPull = await cli(["pull", "--force"], { ...cfgB, ...passphrase }, { cwd: wsB });
	assert.equal(indexPull.status, 1, "a changed repo map must not apply silently");
	assert.match(indexPull.stderr, /workspace\/index\.json \(modified\)/);
	assert.equal(JSON.parse(readFileSync(indexFile, "utf8")).repos.length, 1, "a refused pull writes nothing");
	ok(await asHuman("pull", [wsB, "--force", "--accept-policy-changes"], { ...cfgB, ...passphrase }), "accept the repo map");
	assert.equal(JSON.parse(readFileSync(indexFile, "utf8")).repos.length, 4 + HOSTILE_CLONE_TARGETS.length);

	const wsD = join(root, "ws-d");
	const initRefused = await cli(["init", "lab", "--dir", wsD, "--clone", "--accept-policy-changes"], { ...cfgA, ...passphrase });
	assert.equal(initRefused.status, 1, "init --accept-policy-changes needs a human terminal");
	assert.match(initRefused.stderr, /`heli init --accept-policy-changes` must be run by a human in an interactive terminal/);
	assert.equal(existsSync(wsD), false, "a refused init does nothing, not even create the folder");
	const initD = ok(await asHuman("init", ["lab", "--dir", wsD, "--clone", "--accept-policy-changes"], { ...cfgA, ...passphrase }), "init --clone");
	const initOutput = `${initD.stdout}\n${initD.stderr}`;
	assert.ok(existsSync(join(wsD, "repos", "good", "README.md")), "a safe remote is cloned");
	assert.equal(existsSync(join(root, "escaped")), false, "a ../ path must not be cloned outside the workspace");
	assert.equal(existsSync(join(wsD, "repos", "option")), false, "an option-shaped remote must not reach git");
	assert.match(initOutput, /unsafe path "\.\.\/escaped"/);
	assert.match(initOutput, /unsafe remote "--upload-pack=touch pwned"/);
	assert.match(initOutput, /unsafe path "-rf"/);
	for (const target of HOSTILE_CLONE_TARGETS) {
		assert.equal(existsSync(join(wsD, ...target.split("/"))), false, `${target} must not be cloned into`);
		assert.ok(initOutput.includes(`unsafe path ${JSON.stringify(target)}`), `${target} is reported`);
	}

	// workspace/schema.json decides whether the ownership and lease gate runs at all: a workspace whose mode is not
	// "concurrent" skips it. A pulled bundle that flips the mode is refused and writes nothing; a human applies it.
	const schemaFile = (workspace) => join(workspace, ".heli-harness", "workspace", "schema.json");
	const schemaA = JSON.parse(readFileSync(schemaFile(wsA), "utf8"));
	assert.equal(schemaA.mode, "concurrent", "an install is concurrent");
	assert.equal(isConcurrentMode(wsB), true);
	writeFileSync(schemaFile(wsA), `${JSON.stringify({ ...schemaA, mode: "legacy" }, null, 2)}\n`);
	ok(await cli(["push", "--force"], { ...cfgA, ...passphrase }, { cwd: wsA }), "push a schema that turns the ownership gate off");
	const flip = await cli(["pull", "--force"], { ...cfgB, ...passphrase }, { cwd: wsB });
	assert.equal(flip.status, 1, "a schema that turns the ownership gate off must not apply silently");
	assert.match(flip.stderr, /workspace\/schema\.json \(modified\)/);
	assert.equal(isConcurrentMode(wsB), true, "a refused pull leaves the ownership gate on");
	assert.equal(JSON.parse(readFileSync(schemaFile(wsB), "utf8")).mode, "concurrent", "a refused pull writes nothing");
	ok(await asHuman("pull", [wsB, "--force", "--accept-policy-changes"], { ...cfgB, ...passphrase }), "accept the schema change");
	assert.equal(isConcurrentMode(wsB), false, "with the human-gated flag the schema applies");

	// The baseline that refuses a rollback and a plaintext downgrade (last applied version, content hash, E2E latch)
	// survives re-linking the SAME sync workspace; only a different workspace starts over.
	const syncFile = join(wsB, ".heli-harness", "state", "sync.json");
	const baseline = JSON.parse(readFileSync(syncFile, "utf8"));
	assert.equal(baseline.e2e, true);
	assert.ok(baseline.lastVersion > 1 && baseline.lastContentSha, "device B has a baseline to lose");
	ok(await cli(["ws", "link", "lab"], cfgB, { cwd: wsB }), "re-link the same sync workspace");
	assert.deepEqual(JSON.parse(readFileSync(syncFile, "utf8")), baseline, "re-linking the same workspace changes nothing");
	const otherWorkspace = await (await fetch(new URL("/ws", url), { method: "POST", headers: { ...authA, "content-type": "application/json" }, body: JSON.stringify({ name: "lab2" }) })).json();
	ok(await cli(["ws", "link", "lab2"], cfgB, { cwd: wsB }), "link another sync workspace");
	assert.deepEqual(
		JSON.parse(readFileSync(syncFile, "utf8")),
		{ workspaceId: otherWorkspace.id, name: "lab2", lastVersion: 0, lastContentSha: null },
		"a different workspace starts over",
	);

	// The clone must not depend on the user's environment. A git config that allows the ext:: transport (it runs a command)
	// and GIT_ALLOW_PROTOCOL, which git lets override every protocol.*.allow setting (a `-c` included), must not turn a remote
	// the sync server named into a command. And a user's own stricter policy (no local clones) is honored, not overridden.
	const hostileGitConfig = join(root, "hostile-gitconfig");
	writeFileSync(hostileGitConfig, '[protocol "ext"]\n\tallow = always\n');
	const strictGitConfig = join(root, "strict-gitconfig");
	writeFileSync(strictGitConfig, '[protocol "file"]\n\tallow = never\n');
	const extMarker = join(root, "ext-ran");
	const extHelper = join(root, "ext-helper.mjs");
	writeFileSync(extHelper, `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(extMarker)}, "ran"); process.exit(1);\n`);
	const indexBefore = JSON.parse(readFileSync(join(wsA, ".heli-harness", "workspace", "index.json"), "utf8"));
	writeFileSync(
		join(wsA, ".heli-harness", "workspace", "index.json"),
		`${JSON.stringify({
			...indexBefore,
			repos: [
				{ name: "viaext", path: "repos/viaext", remote: `ext::node ${extHelper}` },
				{ name: "local", path: "repos/local", remote: remoteRepo },
				// No dot in this path, but the folder `aliased` is a junction (a symlink outside Windows) into Heli's own state.
				{ name: "viajunction", path: "aliased/profiles/evil", remote: remoteRepo },
			],
		})}\n`,
	);
	ok(await cli(["push", "--force"], { ...cfgA, ...passphrase }, { cwd: wsA }), "push a repo map with an ext:: remote");
	const wsG = join(root, "ws-g");
	mkdirSync(wsG);
	ok(await cli(["install", wsG], cfgA), "install ws-g");
	symlinkSync(join(wsG, ".heli-harness"), join(wsG, "aliased"), "junction");
	const initG = ok(
		await asHuman("init", ["lab", "--dir", wsG, "--clone", "--accept-policy-changes"], { ...cfgA, ...passphrase, GIT_CONFIG_GLOBAL: hostileGitConfig, GIT_ALLOW_PROTOCOL: "file:ext" }),
		"init --clone under a hostile git environment",
	);
	assert.equal(existsSync(extMarker), false, "the ext:: transport must not run a command");
	assert.ok(existsSync(join(wsG, "repos", "local", "README.md")), "a local clone works under git's default policy");
	assert.equal(existsSync(join(wsG, ".heli-harness", "profiles", "evil")), false, "a folder that leads into Heli's own state is not a clone target");
	assert.match(initG.stderr, /"aliased\/profiles\/evil" in workspace\/index\.json leads into Heli's own state/);
	const wsI = join(root, "ws-i");
	const strictInit = ok(
		await asHuman("init", ["lab", "--dir", wsI, "--clone", "--accept-policy-changes"], { ...cfgA, ...passphrase, GIT_CONFIG_GLOBAL: strictGitConfig }),
		"init --clone under a strict git config",
	);
	assert.equal(existsSync(join(wsI, "repos", "local", "README.md")), false, "a user's own `file = never` is honored, not overridden");
	assert.match(strictInit.stderr, /Clone failed for local/);
	const { gitCloneArgs, gitCloneEnv } = await import("../lib/cli/cloud.mjs");
	assert.deepEqual(
		gitCloneArgs("https://example.invalid/r.git", "/t/r"),
		["-c", "protocol.ext.allow=never", "clone", "--", "https://example.invalid/r.git", "/t/r"],
		'"--" still comes right before the remote',
	);
	assert.deepEqual(
		gitCloneEnv({ PATH: "p", GIT_ALLOW_PROTOCOL: "ext", git_allow_protocol: "ext", GIT_CONFIG_GLOBAL: "g" }),
		{ PATH: "p", GIT_CONFIG_GLOBAL: "g" },
		"only the variable that beats -c is removed, in any case",
	);

	// Browser activation: a link cannot approve a device in one click, and the
	// OAuth state is random, single-use and bound to the confirming browser.
	{
		const githubCalls = [];
		const fakeGitHub = async (target) => {
			githubCalls.push(String(target));
			if (String(target).startsWith("https://github.com/login/oauth/access_token")) return Response.json({ access_token: "gho_fake" });
			if (String(target) === "https://api.github.com/user") return Response.json({ id: 42, login: "octo" });
			throw new Error(`unexpected fetch: ${target}`);
		};
		const oauthApi = createApi(memoryStore(), { githubClientId: "client-id", githubClientSecret: "client-secret", fetchImpl: fakeGitHub });
		const origin = "https://sync.example";
		const call = (path, init = {}) => oauthApi.fetch(new Request(`${origin}${path}`, init));
		const device = await (await call("/auth/device/code", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ device_name: "attacker-laptop" }),
		})).json();
		const pollToken = async () => (await call("/auth/device/token", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ device_code: device.device_code }),
		})).json();
		const confirm = (fromOrigin = origin) => call("/activate/confirm", {
			method: "POST",
			headers: { origin: fromOrigin, "content-type": "application/x-www-form-urlencoded" },
			body: `code=${device.user_code}`,
		});
		const issued = (response) => ({
			state: new URL(response.headers.get("location")).searchParams.get("state"),
			cookie: /__Host-heli_activate=([0-9a-f]+)/.exec(response.headers.get("set-cookie") || "")?.[1],
		});

		const page = await call(`/activate?code=${device.user_code}`);
		assert.equal(page.status, 200);
		assert.equal(page.headers.get("location"), null, "GET /activate must never redirect to GitHub");
		// Chromium applies form-action to the redirect that answers the confirm POST, so the GitHub origin must be listed.
		assert.match(page.headers.get("content-security-policy"), /form-action 'self' https:\/\/github\.com;/, "the CSP must let the confirm redirect reach GitHub");
		const pageHtml = await page.text();
		assert.ok(pageHtml.includes(device.user_code) && pageHtml.includes("attacker-laptop"), "the page shows the code and device");
		assert.match(pageHtml, /<form method="POST" action="\/activate\/confirm">/);
		assert.equal((await call(`/auth/github/callback?code=gh&state=${device.user_code}`)).status, 400, "state = user code approves nothing");
		assert.equal((await confirm("https://evil.example")).status, 403, "cross-site confirm is refused");

		const first = await confirm();
		assert.equal(first.status, 303);
		const unbound = issued(first);
		assert.match(unbound.state, /^[0-9a-f]{64}$/);
		assert.notEqual(unbound.state, device.user_code);
		assert.match(first.headers.get("set-cookie"), /HttpOnly/);
		assert.match(first.headers.get("set-cookie"), /SameSite=Lax/);
		// Over https the cookie carries the __Host- prefix: a browser stores it only from a secure origin, with Path=/ and
		// no Domain, so a sibling host under the same parent domain cannot plant one for the callback to read.
		assert.match(first.headers.get("set-cookie"), /^__Host-heli_activate=[0-9a-f]{64}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=600; Secure$/);
		assert.doesNotMatch(first.headers.get("set-cookie"), /Domain=/i);
		assert.equal((await call(`/auth/github/callback?code=gh&state=${unbound.state}`)).status, 400, "no cookie -> refused");
		const wrong = issued(await confirm());
		assert.equal((await call(`/auth/github/callback?code=gh&state=${wrong.state}`, { headers: { cookie: `__Host-heli_activate=${"0".repeat(64)}` } })).status, 400, "wrong cookie -> refused");
		const bare = issued(await confirm());
		assert.equal((await call(`/auth/github/callback?code=gh&state=${bare.state}`, { headers: { cookie: `heli_activate=${bare.cookie}` } })).status, 400, "over https only the __Host- cookie counts");
		assert.equal(githubCalls.length, 0, "unbound states never reach GitHub");
		assert.equal((await pollToken()).error, "authorization_pending");

		const good = issued(await confirm());
		const callback = await call(`/auth/github/callback?code=gh&state=${good.state}`, { headers: { cookie: `__Host-heli_activate=${good.cookie}` } });
		assert.equal(callback.status, 200, await callback.text());
		assert.match(callback.headers.get("set-cookie"), /^__Host-heli_activate=; Path=\/; HttpOnly; SameSite=Lax; Max-Age=0; Secure$/, "the cookie is cleared with the attributes it was set with");
		const token = await pollToken();
		assert.equal(token.login, "octo");
		assert.ok(token.token);
		assert.equal((await call(`/auth/github/callback?code=gh&state=${good.state}`, { headers: { cookie: `__Host-heli_activate=${good.cookie}` } })).status, 400, "a state is single-use");
	}

	// ---- Direct checks of guards the runs above only reach indirectly or not at all ----
	{
		const { gzipSync } = await import("node:zlib");
		const { packBundle: pack, unpackBundle: unpack, policyBearingChanges, restoreTaskFilesForWorkspace, writeBundleFiles } = await import("../lib/cli/cloud-bundle.mjs");

		// Ciphertext is bound to workspace AND version; the labels on the outside prove nothing.
		const secret = "unit-test passphrase";
		const sample = { "profiles/a.md": "# a\n" };
		const bound = pack(sample, { passphrase: secret, workspaceId: "ws1", version: 3 });
		assert.deepEqual(unpack(bound, { passphrase: secret, workspaceId: "ws1", version: 3 }), sample);
		assert.throws(() => unpack(bound, { passphrase: secret, workspaceId: "ws2", version: 3 }), /different workspace or version/);
		assert.throws(() => unpack(bound, { passphrase: secret, workspaceId: "ws1", version: 4 }), /different workspace or version/);
		assert.throws(() => unpack(bound, { passphrase: secret }), /expected sync workspace id and version/);
		const relabeledOuter = gzipSync(Buffer.from(JSON.stringify({ ...JSON.parse(gunzipSync(bound).toString("utf8")), workspaceId: "ws2", version: 4 })));
		assert.throws(() => unpack(relabeledOuter, { passphrase: secret, workspaceId: "ws2", version: 4 }), /different workspace or version/);
		assert.throws(() => pack(sample, { passphrase: secret }), /bound to its sync workspace id and version/);
		assert.throws(() => pack(sample, { passphrase: secret, workspaceId: "ws1", version: 0 }), /bound to its sync workspace id and version/);
		const legacy = gzipSync(Buffer.from(JSON.stringify({ format: "heli-bundle-v1", encryption: "aes-256-gcm-scrypt", salt: "", iv: "", data: "" })));
		assert.throws(() => unpack(legacy, { passphrase: secret, workspaceId: "ws1", version: 3 }), /legacy end-to-end bundle/);
		assert.throws(() => unpack(pack(sample), { requireEncryption: true }), /Refusing an unencrypted bundle/);

		// Governance-bearing differences: what counts, what does not.
		const taskJson = (extra) => `${JSON.stringify({ id: "t", ...extra }, null, 2)}\n`;
		const localFiles = {
			"safety/command-rules.json": '{"rules":[]}\n',
			"policies/p.md": "# p\n",
			"tasks/a/task.json": taskJson({ mode: "strict" }),
			"tasks/b/task.json": taskJson({ yolo: { enabled: true } }),
			"profiles/demo.md": "# demo\n",
		};
		assert.deepEqual(policyBearingChanges(localFiles, { ...localFiles }), [], "an identical bundle changes nothing");
		assert.deepEqual(
			policyBearingChanges(localFiles, { ...localFiles, "safety/command-rules.json": '{"rules":[]}\r\n', "profiles/demo.md": "# changed\n" }),
			[],
			"CRLF-only differences and non-governance files are not governance changes",
		);
		assert.deepEqual(
			policyBearingChanges(localFiles, {
				"safety/new.json": "{}\n",
				"policies/p.md": "# p2\n",
				"tasks/a/task.json": taskJson({ mode: "yolo" }),
				"tasks/a/yolo.json": '{"enabled":false}\n',
				"tasks/b/task.json": taskJson({ yolo: { enabled: true }, note: "already on locally" }),
				"tasks/c/task.json": taskJson({ yolo: { enabled: true } }),
				"tasks/d/task.json": taskJson({ mode: "strict" }),
				"profiles/demo.md": "# whatever\n",
			}),
			[
				{ rel: "policies/p.md", change: "modified" },
				{ rel: "safety/new.json", change: "added" },
				{ rel: "tasks/a/task.json", change: "enables YOLO" },
				{ rel: "tasks/a/yolo.json", change: "added" },
				{ rel: "tasks/c/task.json", change: "enables YOLO" },
			],
		);

		// A task's diagnosis gate and event log are authority state as well (protected-paths.mjs lists task.json,
		// yolo.json, events.jsonl and diagnosis.json together): added or changed, they need the same acceptance.
		const eventLog = '{"type":"task_created"}\n';
		const taskFiles = {
			"tasks/a/events.jsonl": eventLog,
			"tasks/a/diagnosis.json": '{"state":"idle"}\n',
			"tasks/a/plan.md": "# plan\n",
			"tasks/a/evidence/events.jsonl": "{}\n",
		};
		assert.deepEqual(policyBearingChanges(taskFiles, { ...taskFiles }), [], "an unchanged event log and diagnosis are not changes");
		assert.deepEqual(policyBearingChanges(taskFiles, { ...taskFiles, "tasks/a/events.jsonl": eventLog.replace(/\n/g, "\r\n") }), [], "a CRLF-only difference is not a change");
		assert.deepEqual(
			policyBearingChanges(taskFiles, {
				"tasks/a/events.jsonl": `${eventLog}{"type":"yolo_changed"}\n`,
				"tasks/a/diagnosis.json": '{"state":"root_cause_confirmed"}\n',
				"tasks/b/events.jsonl": "{}\n",
				"tasks/b/diagnosis.json": "{}\n",
				"tasks/C/Events.JSONL": "{}\n",
				"tasks/a/plan.md": "# plan v2\n",
				"tasks/a/decisions.md": "# decisions\n",
				"tasks/a/reports/r1.md": "r\n",
				"tasks/a/evidence/events.jsonl": "{}\nnot the task's own log\n",
			}),
			[
				{ rel: "tasks/C/Events.JSONL", change: "added" },
				{ rel: "tasks/a/diagnosis.json", change: "modified" },
				{ rel: "tasks/a/events.jsonl", change: "modified" },
				{ rel: "tasks/b/diagnosis.json", change: "added" },
				{ rel: "tasks/b/events.jsonl", change: "added" },
			],
			"the event log and diagnosis of a task are governance, its narrative files and nested evidence are not",
		);

		// The workspace's own mode and repo map are governance too: schema.json's mode decides whether the ownership and
		// lease gate runs at all (a workspace that is not concurrent skips it), index.json is what task targets resolve against.
		const workspaceFiles = {
			"workspace/schema.json": '{"schemaVersion":1,"mode":"concurrent"}\n',
			"workspace/index.json": '{"schemaVersion":1,"repos":[]}\n',
			"state/current-task.md": "# task\n",
		};
		assert.deepEqual(policyBearingChanges(workspaceFiles, { ...workspaceFiles }), [], "an unchanged schema and repo map are not changes");
		assert.deepEqual(policyBearingChanges(workspaceFiles, { ...workspaceFiles, "workspace/schema.json": '{"schemaVersion":1,"mode":"concurrent"}\r\n' }), [], "a CRLF-only difference is not a change");
		assert.deepEqual(
			policyBearingChanges(workspaceFiles, {
				"workspace/schema.json": '{"schemaVersion":1,"mode":"legacy"}\n',
				"workspace/index.json": '{"schemaVersion":1,"repos":[{"name":"x","path":"repos/x"}]}\n',
				"state/current-task.md": "# another task\n",
				"state/decisions.md": "# decisions\n",
			}),
			[
				{ rel: "workspace/index.json", change: "modified" },
				{ rel: "workspace/schema.json", change: "modified" },
			],
			"the mode and the repo map are governance, the narrative state files are not",
		);
		assert.deepEqual(
			policyBearingChanges({}, { "Workspace/Schema.JSON": "{}\n", "workspace/INDEX.json": "{}\n" }),
			[
				{ rel: "Workspace/Schema.JSON", change: "added" },
				{ rel: "workspace/INDEX.json", change: "added" },
			],
			"matched case-insensitively",
		);

		// Look-alike spellings a file system that folds Unicode reads as the governance name they imitate: APFS folds
		// U+017F (long s) to s and U+212A (the Kelvin sign) to k, and NFKC reads fullwidth forms as ASCII. `/i` alone
		// does not fold either of the first two, so the match has to be Unicode-aware and compare the normalized name.
		for (const rel of [
			"tasks/x/yolo.jſon",
			"tasks/x/diagnoſis.json",
			"tasks/x/eventſ.jsonl",
			"workspace/ſchema.json",
			"ſafety/rules.json",
			"tasks/x/ｙｏｌｏ．ｊｓｏｎ",
		]) {
			assert.deepEqual(policyBearingChanges({}, { [rel]: "{}\n" }), [{ rel, change: "added" }], `${JSON.stringify(rel)} reads as a governance file`);
		}
		assert.deepEqual(
			policyBearingChanges({}, { "tasks/x/tasK.json": taskJson({ mode: "yolo" }) }),
			[{ rel: "tasks/x/tasK.json", change: "enables YOLO" }],
			"the Kelvin sign in task.json",
		);
		assert.throws(() => restoreTaskFilesForWorkspace(wsB, { "tasks/x/tasK.json": "{" }), /not valid JSON/, "a Kelvin-sign task.json still goes through restore");
		assert.deepEqual(policyBearingChanges({}, { "tasks/x/yolo.jsonx": "{}\n", "tasks/x/y0lo.json": "{}\n", "profiles/ſafety.md": "x\n" }), [], "names that only look similar stay ordinary");

		// A bundle entry name must be the name it will be written under. join() and the filesystem resolve
		// dot/empty segments, case, NTFS streams and 8.3 short names to another file, so a spelling that
		// merely looks unlike tasks/<id>/yolo.json must not slip past the governance list or the writer.
		// (A trailing dot or space is NOT refused: Node writes it literally, and a task id may end with a dot.)
		const yoloOn = '{"enabled":true}\n';
		assert.deepEqual(
			policyBearingChanges({}, { "tasks/x/Task.json": taskJson({ mode: "yolo" }), "Tasks/x/yolo.json": yoloOn, "SAFETY/x.json": "{}\n", "tasks/x/YOLO.JSON": yoloOn }),
			[
				{ rel: "SAFETY/x.json", change: "added" },
				{ rel: "Tasks/x/yolo.json", change: "added" },
				{ rel: "tasks/x/Task.json", change: "enables YOLO" },
				{ rel: "tasks/x/YOLO.JSON", change: "added" },
			],
			"governance names are matched case-insensitively",
		);
		assert.throws(() => restoreTaskFilesForWorkspace(wsB, { "tasks/x/Task.json": "{" }), /not valid JSON/, "a case-variant task.json still goes through restore");
		const shadyNames = [
			"tasks/x/./yolo.json",
			"tasks//x/yolo.json",
			"tasks/x//yolo.json",
			"tasks/x/yolo.json::$DATA",
			"tasks/x/YOLO~1.JSO",
			"tasks/x/./events.jsonl",
			"tasks/x//diagnosis.json",
			"tasks/x/events.jsonl::$DATA",
			"tasks/x/DIAGNO~1.JSO",
			"workspace/./schema.json",
			"workspace//index.json",
			"workspace/schema.json::$DATA",
			"workspace/SCHEMA~1.JSO",
			"profiles/a:b.md",
			"profiles/\u0001.md",
			"tasks/x/",
		];
		for (const rel of shadyNames) {
			assert.throws(
				() => writeBundleFiles(wsB, { "profiles/canary.md": "x\n", [rel]: yoloOn }),
				/outside the portable subset/,
				`${JSON.stringify(rel)} must be refused`,
			);
		}
		assert.equal(existsSync(join(wsB, ".heli-harness", "profiles", "canary.md")), false, "a refused bundle writes nothing, not even its valid entries");
		assert.equal(existsSync(join(wsB, ".heli-harness", "tasks", "x")), false, "no aliased governance file was created");
		assert.equal(
			writeBundleFiles(wsB, {
				"profiles/notes v2 (draft).md": "n\n",
				"profiles/a.b.c.md.example": "e\n",
				"tasks/legit/evidence/log 1.txt": "l\n",
				"tasks/fix-the-login-bug./events.jsonl": "{}\n", // slugTaskId keeps dots: "Fix the login bug." is a valid task id
			}),
			4,
			"ordinary names still write",
		);

		// Belt and braces for `init --clone`: whatever the path text says, the folder a repo path resolves to (junctions,
		// symlinks, 8.3 names and case followed) may not be, hold or lie inside Heli's operational root, .heli, .git or .claude.
		const { resolvesIntoHeliState } = await import("../lib/cli/cloud.mjs");
		const layout = join(root, "layout");
		mkdirSync(join(layout, ".heli-harness", "profiles"), { recursive: true });
		symlinkSync(join(layout, ".heli-harness"), join(layout, "aliased"), "junction"); // a junction on Windows, a symlink elsewhere
		for (const path of ["aliased/profiles/evil", "aliased", "aliased/tasks/x", ".heli-harness/profiles/x", ".heli/x", ".git/x", ".claude/x", "."]) {
			assert.equal(resolvesIntoHeliState(layout, path), true, `${path} leads into Heli's state`);
		}
		for (const path of ["repos/good", "repos/a/b/c", "aliasedx/y", "heli-harness/x"]) {
			assert.equal(resolvesIntoHeliState(layout, path), false, `${path} is an ordinary folder`);
		}

		// Activation edge cases: hostile device name, missing/null Origin, expired state, spent code.
		let clock = 1_000_000;
		const edgeStore = memoryStore();
		const githubCalls = [];
		const edgeApi = createApi(edgeStore, {
			githubClientId: "client-id",
			githubClientSecret: "client-secret",
			now: () => clock,
			// The GitHub user follows the code the callback presents: "gh-mallory" is a second person, anything else is octo.
			fetchImpl: async (target, init = {}) => {
				githubCalls.push(String(target));
				if (String(target).startsWith("https://github.com/login/oauth/access_token")) return Response.json({ access_token: `gho_${JSON.parse(init.body).code}` });
				return Response.json(String(init.headers.authorization).endsWith("_gh-mallory") ? { id: 8, login: "mallory" } : { id: 7, login: "octo" });
			},
		});
		const origin = "https://sync.example";
		const call = (path, init = {}) => edgeApi.fetch(new Request(`${origin}${path}`, init));
		const start = async (deviceName) => (await call("/auth/device/code", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ device_name: deviceName }),
		})).json();
		const confirm = (code, headers = { origin }) => call("/activate/confirm", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
			body: `code=${code}`,
		});
		const issued = (response) => ({
			state: new URL(response.headers.get("location")).searchParams.get("state"),
			cookie: /__Host-heli_activate=([0-9a-f]+)/.exec(response.headers.get("set-cookie") || "")?.[1],
		});
		const callbackFor = ({ state, cookie }, githubCode = "gh") => call(`/auth/github/callback?code=${githubCode}&state=${state}`, { headers: { cookie: `__Host-heli_activate=${cookie}` } });
		const pollFor = async (deviceCode) => (await call("/auth/device/token", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ device_code: deviceCode }),
		})).json();

		const hostile = await start("<img src=x onerror=alert(1)>");
		const hostileHtml = await (await call(`/activate?code=${hostile.user_code}`)).text();
		assert.ok(!hostileHtml.includes("<img"), "a hostile device name must be HTML-escaped");
		assert.ok(hostileHtml.includes("&lt;img src=x onerror=alert(1)&gt;"));
		assert.equal((await confirm(hostile.user_code, {})).status, 403, "a confirm without an Origin header is refused");
		assert.equal((await confirm(hostile.user_code, { origin: "null" })).status, 403, "a confirm from an opaque origin is refused");
		assert.equal((await confirm("ZZZZ-ZZZZ")).status, 400, "an unknown code is refused");
		assert.equal((await edgeStore.list("oauthstate:")).length, 0, "refused confirms store no state");

		const device = await start("laptop");
		assert.equal((await call(`/activate?code=${encodeURIComponent(` ${device.user_code.toLowerCase()} `)}`)).status, 200, "codes are case- and space-insensitive");
		const stale = issued(await confirm(device.user_code));
		clock += 10 * 60 * 1000 + 1;
		assert.equal((await callbackFor(stale)).status, 400, "an expired state is refused");
		assert.equal(githubCalls.length, 0, "an expired state never reaches GitHub");
		const retry = issued(await confirm(device.user_code));
		assert.equal((await callbackFor(retry)).status, 200, "the same code can be confirmed again while it is still pending");
		assert.equal((await confirm(device.user_code)).status, 400, "an approved code cannot be confirmed again");
		assert.equal((await call(`/activate?code=${device.user_code}`)).status, 400, "an approved code shows no confirm page");

		// Two browsers confirmed the same code: the second outstanding state cannot replace the user who approved it.
		const contested = await start("contested");
		const firstBrowser = issued(await confirm(contested.user_code));
		const secondBrowser = issued(await confirm(contested.user_code));
		assert.equal((await callbackFor(firstBrowser, "gh-octo")).status, 200);
		assert.equal((await callbackFor(secondBrowser, "gh-mallory")).status, 400, "an approved request is not approved again by another state");
		assert.equal((await pollFor(contested.device_code)).login, "octo", "the device belongs to the user who approved it first");

		// Plain http (local development) keeps the bare cookie name, scoped to the callback path, without Secure.
		const httpOrigin = "http://localhost";
		const httpCall = (path, init = {}) => edgeApi.fetch(new Request(`${httpOrigin}${path}`, init));
		const localDev = await start("local-dev");
		const localConfirm = await httpCall("/activate/confirm", {
			method: "POST",
			headers: { origin: httpOrigin, "content-type": "application/x-www-form-urlencoded" },
			body: `code=${localDev.user_code}`,
		});
		assert.equal(localConfirm.status, 303);
		assert.match(localConfirm.headers.get("set-cookie"), /^heli_activate=[0-9a-f]{64}; Path=\/auth\/github\/callback; HttpOnly; SameSite=Lax; Max-Age=600$/);
		const localState = new URL(localConfirm.headers.get("location")).searchParams.get("state");
		const localCookie = /^heli_activate=([0-9a-f]+)/.exec(localConfirm.headers.get("set-cookie"))[1];
		const localCallback = await httpCall(`/auth/github/callback?code=gh&state=${localState}`, { headers: { cookie: `heli_activate=${localCookie}` } });
		assert.equal(localCallback.status, 200, "over plain http the bare cookie name still binds the state");
		assert.match(localCallback.headers.get("set-cookie"), /^heli_activate=; Path=\/auth\/github\/callback; HttpOnly; SameSite=Lax; Max-Age=0$/);

		const old = await start("old");
		clock += 15 * 60 * 1000 + 1;
		assert.equal((await call(`/activate?code=${old.user_code}`)).status, 400, "an expired device code shows no confirm page");
		assert.equal((await confirm(old.user_code)).status, 400, "an expired device code cannot be confirmed");
	}

	console.log("cloud sync smoke ok");
} finally {
	server.closeAllConnections?.();
	server.close();
	rmSync(root, { recursive: true, force: true });
}
