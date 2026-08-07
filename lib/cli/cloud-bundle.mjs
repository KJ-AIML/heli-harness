/**
 * Cloud sync bundle: collect/pack/unpack the portable workspace subset and
 * scan it for secrets before it ever leaves the machine.
 *
 * Bundle format v1: gzip(JSON { format, encryption, files: { relPath: text } })
 * — pure node:zlib, no tar (platform tar quirks already bit this repo once).
 * The server stores the bytes opaquely; the format is a client-side concern.
 * The `encryption` field is carried from day one so client-side E2E (Phase 2)
 * is additive, not a migration.
 */
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { join, dirname } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";

export const BUNDLE_FORMAT = "heli-bundle-v1";
const E2E_SCHEME = "aes-256-gcm-scrypt";

// Portable subset — mirrors docs/architecture/cloud-sync.md. Machine-local
// state (sessions/locks/bindings/yolo/target/sync.json) and reinstallable
// distribution assets never sync.
const INCLUDE_DIRS = ["profiles", "policies", "safety", "tasks"];
const INCLUDE_FILES = [
	"workspace/index.json",
	"workspace/schema.json",
	"state/current-task.md",
	"state/decisions.md",
];

function walkFiles(dir, baseRel, out) {
	for (const name of readdirSync(dir).sort()) {
		const path = join(dir, name);
		const rel = baseRel ? `${baseRel}/${name}` : name;
		if (statSync(path).isDirectory()) walkFiles(path, rel, out);
		else out.push(rel);
	}
}

/** Collect the portable subset from <workspaceRoot>/.heli-harness as { rel: text }. */
export function collectBundleFiles(workspaceRoot) {
	const heliDir = join(workspaceRoot, ".heli-harness");
	const files = {};
	const rels = [];
	for (const dir of INCLUDE_DIRS) {
		if (existsSync(join(heliDir, dir))) walkFiles(join(heliDir, dir), dir, rels);
	}
	for (const file of INCLUDE_FILES) {
		if (existsSync(join(heliDir, file))) rels.push(file);
	}
	for (const rel of rels.sort()) {
		files[rel] = readFileSync(join(heliDir, rel), "utf8");
	}
	return files;
}

function deriveKey(passphrase, salt) {
	return scryptSync(passphrase, salt, 32);
}

export function packBundle(files, { passphrase = null } = {}) {
	if (!passphrase) {
		return gzipSync(Buffer.from(JSON.stringify({ format: BUNDLE_FORMAT, encryption: "none", files }), "utf8"));
	}
	const salt = randomBytes(16);
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
	const plaintext = gzipSync(Buffer.from(JSON.stringify(files), "utf8"));
	const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
	return gzipSync(
		Buffer.from(
			JSON.stringify({
				format: BUNDLE_FORMAT,
				encryption: E2E_SCHEME,
				salt: salt.toString("base64"),
				iv: iv.toString("base64"),
				data: ciphertext.toString("base64"),
			}),
			"utf8",
		),
	);
}

export function unpackBundle(bytes, { passphrase = null } = {}) {
	let parsed;
	try {
		parsed = JSON.parse(gunzipSync(bytes).toString("utf8"));
	} catch {
		throw new Error("Bundle is not a valid heli-bundle (gzip/JSON parse failed).");
	}
	if (parsed.format !== BUNDLE_FORMAT) {
		throw new Error(`Unsupported bundle format: ${parsed.format || "unknown"}`);
	}
	if (!parsed.encryption || parsed.encryption === "none") {
		if (!parsed.files || typeof parsed.files !== "object") throw new Error("Bundle has no files map.");
		return parsed.files;
	}
	if (parsed.encryption !== E2E_SCHEME) {
		throw new Error(`Bundle encryption "${parsed.encryption}" is not supported by this CLI version.`);
	}
	if (!passphrase) {
		throw new Error("Bundle is end-to-end encrypted. Set HELI_E2E_PASSPHRASE and retry.");
	}
	const salt = Buffer.from(parsed.salt, "base64");
	const iv = Buffer.from(parsed.iv, "base64");
	const payload = Buffer.from(parsed.data, "base64");
	const tag = payload.subarray(payload.length - 16);
	const ciphertext = payload.subarray(0, payload.length - 16);
	let plaintext;
	try {
		const decipher = createDecipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
		decipher.setAuthTag(tag);
		plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
	} catch {
		throw new Error("Decryption failed: wrong HELI_E2E_PASSPHRASE or corrupted bundle.");
	}
	return JSON.parse(gunzipSync(plaintext).toString("utf8"));
}

/** Stable content hash: same files -> same sha, independent of encryption randomness. */
export function contentSha256(files) {
	const canonical = JSON.stringify(Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1))));
	return createHash("sha256").update(canonical).digest("hex");
}

function isAllowedRel(rel) {
	if (rel.includes("..") || rel.includes("\\") || rel.startsWith("/")) return false;
	return (
		INCLUDE_DIRS.some((dir) => rel.startsWith(`${dir}/`)) ||
		INCLUDE_FILES.includes(rel)
	);
}

/** Write bundle files under .heli-harness, refusing anything outside the portable subset. */
export function writeBundleFiles(workspaceRoot, files) {
	const heliDir = join(workspaceRoot, ".heli-harness");
	let written = 0;
	for (const [rel, content] of Object.entries(files)) {
		if (!isAllowedRel(rel) || typeof content !== "string") {
			throw new Error(`Refusing bundle entry outside the portable subset: ${rel}`);
		}
		const path = join(heliDir, ...rel.split("/"));
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, content);
		written++;
	}
	return written;
}

// Secret patterns: same spirit as safety/ command rules — catch the common
// credential shapes before they leave the machine. Blocking by default.
const SECRET_PATTERNS = [
	{ id: "aws-access-key", regex: /\bAKIA[0-9A-Z]{16}\b/ },
	{ id: "github-token", regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/ },
	{ id: "github-pat", regex: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/ },
	{ id: "private-key", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
	{ id: "slack-token", regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
	{ id: "openai-key", regex: /\bsk-[A-Za-z0-9_-]{32,}\b/ },
	{ id: "generic-assignment", regex: /\b(?:api[_-]?key|secret|password|token)\b\s*[:=]\s*["'][^"']{16,}["']/i },
];

/** Scan bundle files for secret-shaped content. Returns [{ file, line, id }]. */
export function scanBundleSecrets(files) {
	const findings = [];
	for (const [rel, content] of Object.entries(files)) {
		const lines = content.split("\n");
		for (let i = 0; i < lines.length; i++) {
			for (const { id, regex } of SECRET_PATTERNS) {
				if (regex.test(lines[i])) {
					findings.push({ file: rel, line: i + 1, id });
					break;
				}
			}
		}
	}
	return findings;
}
