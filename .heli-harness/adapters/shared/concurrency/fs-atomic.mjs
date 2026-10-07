/**
 * Cross-platform atomic filesystem primitives for Heli concurrency.
 * No external dependencies. Local-first only — not distributed locks.
 */
import {
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
	renameSync,
	rmSync,
	appendFileSync,
	openSync,
	closeSync,
	unlinkSync,
	readdirSync,
	statSync,
	realpathSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

export function ensureDir(path) {
	mkdirSync(path, { recursive: true });
	return path;
}

export function readJson(path, fallback = null) {
	try {
		if (!existsSync(path)) return fallback;
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return fallback;
	}
}

export function readText(path, fallback = "") {
	try {
		if (!existsSync(path)) return fallback;
		return readFileSync(path, "utf8");
	} catch {
		return fallback;
	}
}

const RENAME_RETRY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const RENAME_MAX_ATTEMPTS = 20;

function sleepSync(ms) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Rename `from` over `to`, retrying transient Windows sharing violations
 * (EPERM/EBUSY/EACCES from antivirus, indexers or a concurrent reader).
 * The target is NEVER deleted first: a failed write leaves the previous
 * content intact. On final failure the temp file is removed and the error
 * is rethrown. `rename` is injectable for tests.
 */
export function renameWithRetry(from, to, { rename = renameSync, attempts = RENAME_MAX_ATTEMPTS } = {}) {
	for (let attempt = 1; ; attempt += 1) {
		try {
			rename(from, to);
			return to;
		} catch (error) {
			if (!RENAME_RETRY_CODES.has(error?.code) || attempt >= attempts) {
				try {
					unlinkSync(from);
				} catch {
					/* temp cleanup is best-effort */
				}
				throw error;
			}
			sleepSync(Math.min(10 * attempt, 100));
		}
	}
}

/**
 * Atomic JSON write via temp file + rename into place (see renameWithRetry).
 */
export function writeJsonAtomic(path, value, { spaces = 2 } = {}) {
	ensureDir(dirname(path));
	const payload = `${JSON.stringify(value, null, spaces)}\n`;
	const tmp = join(dirname(path), `.${randomBytes(8).toString("hex")}.tmp`);
	writeFileSync(tmp, payload, "utf8");
	return renameWithRetry(tmp, path);
}

export function writeTextAtomic(path, text) {
	ensureDir(dirname(path));
	const tmp = join(dirname(path), `.${randomBytes(8).toString("hex")}.tmp`);
	writeFileSync(tmp, text, "utf8");
	return renameWithRetry(tmp, path);
}

/**
 * Exclusive directory claim (mkdir without recursive).
 * Returns { ok: true } or { ok: false, error }.
 */
export function claimDirExclusive(path) {
	try {
		mkdirSync(path, { recursive: false });
		return { ok: true };
	} catch (error) {
		if (error && (error.code === "EEXIST" || error.code === "EPERM")) {
			return { ok: false, error };
		}
		// parent missing
		if (error && error.code === "ENOENT") {
			try {
				ensureDir(dirname(path));
				mkdirSync(path, { recursive: false });
				return { ok: true };
			} catch (error2) {
				if (error2 && error2.code === "EEXIST") return { ok: false, error: error2 };
				return { ok: false, error: error2 };
			}
		}
		return { ok: false, error };
	}
}

export function releaseDir(path) {
	if (!existsSync(path)) return;
	rmSync(path, { recursive: true, force: true });
}

/** Exclusive file create (wx). */
export function createFileExclusive(path, content = "") {
	ensureDir(dirname(path));
	try {
		const fd = openSync(path, "wx");
		try {
			writeFileSync(fd, content, "utf8");
		} finally {
			closeSync(fd);
		}
		return { ok: true };
	} catch (error) {
		if (error && error.code === "EEXIST") return { ok: false, error };
		return { ok: false, error };
	}
}

export function appendJsonl(path, record) {
	ensureDir(dirname(path));
	appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
}

export function listDirNames(path) {
	if (!existsSync(path)) return [];
	return readdirSync(path).filter((name) => {
		try {
			return statSync(join(path, name)).isDirectory();
		} catch {
			return false;
		}
	});
}

export function listFileNames(path, { suffix } = {}) {
	if (!existsSync(path)) return [];
	return readdirSync(path).filter((name) => {
		if (suffix && !name.endsWith(suffix)) return false;
		try {
			return statSync(join(path, name)).isFile();
		} catch {
			return false;
		}
	});
}

export function safeRealpath(path) {
	try {
		// Prefer the OS-native resolver. On Windows this collapses alternate
		// filesystem spellings (including 8.3 aliases) before path identity and
		// containment checks compare them.
		return realpathSync.native(path);
	} catch {
		try {
			return realpathSync(path);
		} catch {
			return path;
		}
	}
}

export function pathExists(path) {
	return existsSync(path);
}
