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

/**
 * Atomic JSON write via temp file + rename into place.
 * On Windows, rename over existing may fail — unlink then rename as fallback.
 */
export function writeJsonAtomic(path, value, { spaces = 2 } = {}) {
	ensureDir(dirname(path));
	const payload = `${JSON.stringify(value, null, spaces)}\n`;
	const tmp = join(dirname(path), `.${randomBytes(8).toString("hex")}.tmp`);
	writeFileSync(tmp, payload, "utf8");
	try {
		renameSync(tmp, path);
	} catch {
		try {
			if (existsSync(path)) unlinkSync(path);
		} catch {
			/* ignore */
		}
		renameSync(tmp, path);
	}
	return path;
}

export function writeTextAtomic(path, text) {
	ensureDir(dirname(path));
	const tmp = join(dirname(path), `.${randomBytes(8).toString("hex")}.tmp`);
	writeFileSync(tmp, text, "utf8");
	try {
		renameSync(tmp, path);
	} catch {
		try {
			if (existsSync(path)) unlinkSync(path);
		} catch {
			/* ignore */
		}
		renameSync(tmp, path);
	}
	return path;
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
		return realpathSync(path);
	} catch {
		return path;
	}
}

export function pathExists(path) {
	return existsSync(path);
}
