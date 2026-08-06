/**
 * Cloudflare shell for the heli sync API.
 *
 * All requests are forwarded to a single Durable Object instance, which gives
 * every state mutation a single-threaded home (version counters, token issue).
 * ponytail: one DO serializes everything — fine at Phase 1 scale; shard to one
 * DO per workspace if a hot path ever appears.
 *
 * This file cannot run under plain node (DO/R2 bindings) and is therefore not
 * covered by CI smokes; keep it thin. All logic lives in core.mjs, which is.
 * Deploy: see cloud/README.md.
 */
import { createApi } from "./core.mjs";

function doStore(storage, bucket) {
	return {
		async get(key) {
			const value = await storage.get(key);
			return value === undefined ? null : value;
		},
		async put(key, value) {
			await storage.put(key, value);
		},
		async delete(key) {
			await storage.delete(key);
		},
		async list(prefix) {
			const map = await storage.list({ prefix });
			return Array.from(map, ([key, value]) => ({ key, value }));
		},
		async blobPut(key, bytes) {
			await bucket.put(key, bytes);
		},
		async blobGet(key) {
			const object = await bucket.get(key);
			return object ? new Uint8Array(await object.arrayBuffer()) : null;
		},
		async blobDelete(key) {
			await bucket.delete(key);
		},
	};
}

export class HeliApiDO {
	constructor(state, env) {
		this.api = createApi(doStore(state.storage, env.BUNDLES), {
			testLogin: env.TEST_LOGIN === "1",
			githubClientId: env.GITHUB_CLIENT_ID || null,
			githubClientSecret: env.GITHUB_CLIENT_SECRET || null,
		});
	}

	fetch(request) {
		return this.api.fetch(request);
	}
}

export default {
	fetch(request, env) {
		return env.HELI_API.get(env.HELI_API.idFromName("api")).fetch(request);
	},
};
