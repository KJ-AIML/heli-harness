/**
 * Heli cloud sync — portable API core.
 *
 * Runs identically inside a Cloudflare Durable Object (cloud/worker.mjs) and a
 * plain node:http adapter (scripts/smoke-cloud-sync.mjs). Everything here uses
 * only standard Request/Response/WebCrypto so the full contract is testable in
 * CI without workerd or any npm dependency.
 *
 * Design: docs/architecture/cloud-sync.md. The server never parses workspace
 * schemas — bundles are opaque bytes (gzip'd heli-bundle-v1 on the client).
 *
 * store interface (implemented over DO storage + R2 in prod, Maps in tests):
 *   get(key) -> value|null      put(key, value)      delete(key)
 *   list(prefix) -> [{ key, value }] sorted by key
 *   blobPut(key, bytes)         blobGet(key) -> bytes|null   blobDelete(key)
 */

const DEVICE_CODE_TTL_MS = 15 * 60 * 1000;
const MAX_BUNDLE_BYTES = 10 * 1024 * 1024;
const RETAINED_VERSIONS = 10;
const USER_CODE_ALPHABET = "BCDFGHJKMNPQRSTVWXZ23456789"; // no ambiguous chars

function json(data, status = 200, headers = {}) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});
}

function randomHex(bytes) {
	const buf = crypto.getRandomValues(new Uint8Array(bytes));
	return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

function randomUserCode() {
	const buf = crypto.getRandomValues(new Uint8Array(8));
	let code = "";
	for (const b of buf) code += USER_CODE_ALPHABET[b % USER_CODE_ALPHABET.length];
	return `${code.slice(0, 4)}-${code.slice(4)}`;
}

async function sha256Hex(input) {
	const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function padVersion(n) {
	return String(n).padStart(10, "0");
}

export function createApi(store, options = {}) {
	const {
		testLogin = false,
		githubClientId = null,
		githubClientSecret = null,
		fetchImpl = globalThis.fetch,
		now = () => Date.now(),
		deviceInterval = 5,
	} = options;

	async function authenticate(request) {
		const header = request.headers.get("authorization") || "";
		const match = /^Bearer\s+(\S+)$/.exec(header);
		if (!match) return null;
		const record = await store.get(`token:${await sha256Hex(match[1])}`);
		if (!record || record.revokedAt) return null;
		return record; // { userId, login, deviceId, deviceName, createdAt }
	}

	async function approvePending(userCode, user) {
		const deviceCode = await store.get(`usercode:${userCode}`);
		if (!deviceCode) return false;
		const pending = await store.get(`pending:${deviceCode}`);
		if (!pending || pending.expiresAt < now()) return false;
		await store.put(`pending:${deviceCode}`, { ...pending, approved: true, user });
		return true;
	}

	const routes = {
		"GET /health": async () => json({ ok: true }),

		"POST /auth/device/code": async (request) => {
			const body = await request.json().catch(() => ({}));
			const deviceCode = randomHex(32);
			const userCode = randomUserCode();
			await store.put(`pending:${deviceCode}`, {
				userCode,
				deviceName: typeof body.device_name === "string" ? body.device_name.slice(0, 80) : "unknown",
				approved: false,
				user: null,
				expiresAt: now() + DEVICE_CODE_TTL_MS,
			});
			await store.put(`usercode:${userCode}`, deviceCode);
			const origin = new URL(request.url).origin;
			return json({
				device_code: deviceCode,
				user_code: userCode,
				verification_uri: `${origin}/activate`,
				interval: deviceInterval,
				expires_in: DEVICE_CODE_TTL_MS / 1000,
			});
		},

		"POST /auth/device/token": async (request) => {
			const body = await request.json().catch(() => ({}));
			const pending = body.device_code ? await store.get(`pending:${body.device_code}`) : null;
			if (!pending) return json({ error: "invalid_device_code" }, 400);
			if (pending.expiresAt < now()) {
				await store.delete(`pending:${body.device_code}`);
				await store.delete(`usercode:${pending.userCode}`);
				return json({ error: "expired_token" }, 400);
			}
			if (!pending.approved) return json({ error: "authorization_pending" });
			const token = randomHex(32);
			const deviceId = randomHex(8);
			const device = {
				userId: pending.user.userId,
				login: pending.user.login,
				deviceId,
				deviceName: pending.deviceName,
				createdAt: now(),
			};
			await store.put(`token:${await sha256Hex(token)}`, device);
			await store.put(`device:${pending.user.userId}:${deviceId}`, {
				...device,
				tokenHash: await sha256Hex(token),
			});
			await store.put(`user:${pending.user.userId}`, { userId: pending.user.userId, login: pending.user.login });
			await store.delete(`pending:${body.device_code}`);
			await store.delete(`usercode:${pending.userCode}`);
			return json({ token, login: pending.user.login });
		},

		// Test-only direct activation (TEST_LOGIN env). Never enabled in prod config.
		"POST /activate": async (request) => {
			if (!testLogin) return json({ error: "not_found" }, 404);
			const body = await request.json().catch(() => ({}));
			if (typeof body.user_code !== "string" || typeof body.login !== "string") {
				return json({ error: "invalid_request" }, 400);
			}
			const ok = await approvePending(body.user_code, {
				userId: `test:${body.login}`,
				login: body.login,
			});
			return ok ? json({ ok: true }) : json({ error: "invalid_user_code" }, 400);
		},

		// Browser activation: enter/confirm the user code, then bounce via GitHub OAuth.
		"GET /activate": async (request) => {
			const url = new URL(request.url);
			const userCode = url.searchParams.get("code") || "";
			if (!githubClientId) {
				return new Response("Activation requires GitHub OAuth configuration.", { status: 503 });
			}
			const redirect = new URL("https://github.com/login/oauth/authorize");
			redirect.searchParams.set("client_id", githubClientId);
			redirect.searchParams.set("scope", "read:user");
			redirect.searchParams.set("state", userCode);
			redirect.searchParams.set("redirect_uri", `${url.origin}/auth/github/callback`);
			if (!userCode) {
				return new Response(
					"<!doctype html><title>Heli device activation</title>" +
						'<form method="GET" action="/activate">' +
						"<h1>Heli device activation</h1>" +
						'<p>Enter the code shown in your terminal:</p>' +
						'<input name="code" autofocus placeholder="XXXX-XXXX"> <button>Continue</button></form>',
					{ headers: { "content-type": "text/html; charset=utf-8" } },
				);
			}
			return Response.redirect(redirect.toString(), 302);
		},

		"GET /auth/github/callback": async (request) => {
			const url = new URL(request.url);
			const code = url.searchParams.get("code");
			const userCode = url.searchParams.get("state");
			if (!code || !userCode || !githubClientId || !githubClientSecret) {
				return new Response("Invalid activation callback.", { status: 400 });
			}
			const tokenResponse = await fetchImpl("https://github.com/login/oauth/access_token", {
				method: "POST",
				headers: { accept: "application/json", "content-type": "application/json" },
				body: JSON.stringify({ client_id: githubClientId, client_secret: githubClientSecret, code }),
			});
			const tokenBody = await tokenResponse.json().catch(() => ({}));
			if (!tokenBody.access_token) return new Response("GitHub authorization failed.", { status: 502 });
			const userResponse = await fetchImpl("https://api.github.com/user", {
				headers: {
					authorization: `Bearer ${tokenBody.access_token}`,
					accept: "application/json",
					"user-agent": "heli-sync",
				},
			});
			const ghUser = await userResponse.json().catch(() => ({}));
			if (!ghUser.id) return new Response("GitHub user lookup failed.", { status: 502 });
			const ok = await approvePending(userCode, { userId: `gh:${ghUser.id}`, login: ghUser.login });
			return new Response(
				ok
					? "Device authorized. You can close this tab and return to your terminal."
					: "Activation code invalid or expired. Re-run: heli auth login",
				{ status: ok ? 200 : 400, headers: { "content-type": "text/plain; charset=utf-8" } },
			);
		},
	};

	// Authenticated routes get (request, auth, params).
	const authedRoutes = {
		"GET /auth/whoami": async (request, auth) => json({ login: auth.login, device: auth.deviceName }),

		"POST /auth/logout": async (request, auth) => {
			const header = request.headers.get("authorization");
			const token = /^Bearer\s+(\S+)$/.exec(header)[1];
			await store.delete(`token:${await sha256Hex(token)}`);
			await store.delete(`device:${auth.userId}:${auth.deviceId}`);
			return json({ ok: true });
		},

		"GET /auth/devices": async (request, auth) => {
			const devices = await store.list(`device:${auth.userId}:`);
			return json(
				devices.map(({ value }) => ({
					id: value.deviceId,
					name: value.deviceName,
					createdAt: value.createdAt,
					current: value.deviceId === auth.deviceId,
				})),
			);
		},

		"DELETE /auth/devices/:id": async (request, auth, params) => {
			const device = await store.get(`device:${auth.userId}:${params.id}`);
			if (!device) return json({ error: "not_found" }, 404);
			await store.delete(`token:${device.tokenHash}`);
			await store.delete(`device:${auth.userId}:${params.id}`);
			return json({ ok: true });
		},

		"GET /ws": async (request, auth) => {
			const items = await store.list(`ws:${auth.userId}:`);
			return json(
				items
					.filter(({ value }) => !value.deletedAt)
					.map(({ value }) => ({
						id: value.id,
						name: value.name,
						currentVersion: value.currentVersion,
						updatedAt: value.updatedAt,
					})),
			);
		},

		"POST /ws": async (request, auth) => {
			const body = await request.json().catch(() => ({}));
			const name = typeof body.name === "string" ? body.name.trim() : "";
			if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(name)) {
				return json({ error: "invalid_name" }, 400);
			}
			const existing = await store.list(`ws:${auth.userId}:`);
			if (existing.some(({ value }) => value.name === name && !value.deletedAt)) {
				return json({ error: "name_exists" }, 409);
			}
			const ws = {
				id: randomHex(6),
				name,
				currentVersion: 0,
				createdAt: now(),
				updatedAt: now(),
			};
			await store.put(`ws:${auth.userId}:${ws.id}`, ws);
			return json({ id: ws.id, name: ws.name, currentVersion: 0 }, 201);
		},

		"GET /ws/:id/versions": async (request, auth, params) => {
			const ws = await store.get(`ws:${auth.userId}:${params.id}`);
			if (!ws || ws.deletedAt) return json({ error: "not_found" }, 404);
			const versions = await store.list(`ver:${ws.id}:`);
			return json({
				id: ws.id,
				name: ws.name,
				currentVersion: ws.currentVersion,
				versions: versions.map(({ value }) => value).sort((a, b) => b.version - a.version),
			});
		},

		"POST /ws/:id/push": async (request, auth, params) => {
			const ws = await store.get(`ws:${auth.userId}:${params.id}`);
			if (!ws || ws.deletedAt) return json({ error: "not_found" }, 404);
			const baseVersion = Number(request.headers.get("x-base-version"));
			if (!Number.isInteger(baseVersion) || baseVersion < 0) {
				return json({ error: "invalid_base_version" }, 400);
			}
			if (baseVersion !== ws.currentVersion) {
				return json({ error: "version_conflict", currentVersion: ws.currentVersion }, 409);
			}
			const bytes = new Uint8Array(await request.arrayBuffer());
			if (bytes.length === 0) return json({ error: "empty_bundle" }, 400);
			if (bytes.length > MAX_BUNDLE_BYTES) return json({ error: "bundle_too_large" }, 413);
			const version = ws.currentVersion + 1;
			await store.blobPut(`bundle:${ws.id}:${version}`, bytes);
			await store.put(`ver:${ws.id}:${padVersion(version)}`, {
				version,
				size: bytes.length,
				sha256: await sha256Hex(bytes),
				pushedBy: auth.deviceName,
				createdAt: now(),
			});
			await store.put(`ws:${auth.userId}:${params.id}`, { ...ws, currentVersion: version, updatedAt: now() });
			// Retention: keep the last RETAINED_VERSIONS snapshots.
			const versions = await store.list(`ver:${ws.id}:`);
			for (const { key, value } of versions.slice(0, Math.max(0, versions.length - RETAINED_VERSIONS))) {
				await store.delete(key);
				await store.blobDelete(`bundle:${ws.id}:${value.version}`);
			}
			return json({ version });
		},

		"GET /ws/:id/pull": async (request, auth, params) => {
			const ws = await store.get(`ws:${auth.userId}:${params.id}`);
			if (!ws || ws.deletedAt) return json({ error: "not_found" }, 404);
			if (ws.currentVersion === 0) return json({ error: "no_versions" }, 404);
			const requested = new URL(request.url).searchParams.get("version");
			const version = requested ? Number(requested) : ws.currentVersion;
			const meta = await store.get(`ver:${ws.id}:${padVersion(version)}`);
			if (!meta) return json({ error: "version_not_found" }, 404);
			const bytes = await store.blobGet(`bundle:${ws.id}:${version}`);
			if (!bytes) return json({ error: "bundle_missing" }, 500);
			return new Response(bytes, {
				headers: {
					"content-type": "application/octet-stream",
					"x-version": String(version),
					"x-sha256": meta.sha256,
				},
			});
		},

		"DELETE /ws/:id": async (request, auth, params) => {
			const ws = await store.get(`ws:${auth.userId}:${params.id}`);
			if (!ws || ws.deletedAt) return json({ error: "not_found" }, 404);
			// ponytail: soft delete only — hard GC of R2 objects after the 30-day
			// window is a deploy-time cron concern, added when the service is live.
			await store.put(`ws:${auth.userId}:${params.id}`, { ...ws, deletedAt: now() });
			return json({ ok: true });
		},
	};

	function matchRoute(table, method, pathname) {
		for (const [pattern, handler] of Object.entries(table)) {
			const [patternMethod, patternPath] = pattern.split(" ");
			if (patternMethod !== method) continue;
			const patternParts = patternPath.split("/").filter(Boolean);
			const pathParts = pathname.split("/").filter(Boolean);
			if (patternParts.length !== pathParts.length) continue;
			const params = {};
			let ok = true;
			for (let i = 0; i < patternParts.length; i++) {
				if (patternParts[i].startsWith(":")) params[patternParts[i].slice(1)] = pathParts[i];
				else if (patternParts[i] !== pathParts[i]) ok = false;
			}
			if (ok) return { handler, params };
		}
		return null;
	}

	return {
		async fetch(request) {
			try {
				const { pathname } = new URL(request.url);
				const open = matchRoute(routes, request.method, pathname);
				if (open) return await open.handler(request, null, open.params);
				const authed = matchRoute(authedRoutes, request.method, pathname);
				if (authed) {
					const auth = await authenticate(request);
					if (!auth) return json({ error: "unauthorized" }, 401);
					return await authed.handler(request, auth, authed.params);
				}
				return json({ error: "not_found" }, 404);
			} catch (error) {
				return json({ error: "internal", message: String(error?.message || error) }, 500);
			}
		},
	};
}
