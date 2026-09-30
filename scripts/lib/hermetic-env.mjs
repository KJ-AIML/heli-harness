/**
 * Hermetic environment for tests that exercise host lifecycle code.
 *
 * lib/cli/host.mjs spawns real host CLIs (claude, codex, grok, ...). Tests must
 * never reach the developer's real CLIs or real home directory, so this helper
 * builds an environment from scratch:
 *   - HOME/USERPROFILE/APPDATA/LOCALAPPDATA and every Heli/host config dir point
 *     inside a fresh temp directory;
 *   - no HELI_* variable leaks in from the parent process (HELI_SESSION_ID etc.);
 *   - PATH = fake-bin (a shim for every host CLI) + node's own dir + the system
 *     dirs cmd.exe / sh need. Each shim appends its argv to a log file so a test
 *     can prove which host commands ran.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const FAKE_HOST_NAMES = Object.freeze([
	"claude",
	"codex",
	"grok",
	"kimi",
	"pi",
	"axga",
	"opencode",
	"cursor",
	"antigravity",
]);

const FAKE_HOST_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "fake-host-cli.mjs");
const LOG_KEYS = new Set(["HELI_FAKE_HOST_LOG", "HELI_FAKE_HOST_RESPONSES"]);
const WINDOWS_PASSTHROUGH = ["SystemRoot", "SystemDrive", "windir", "ComSpec", "PATHEXT", "OS", "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS"];

function systemPathDirs() {
	if (process.platform === "win32") {
		const systemRoot = process.env.SystemRoot || "C:\\Windows";
		return [
			join(systemRoot, "System32"),
			systemRoot,
			join(systemRoot, "System32", "Wbem"),
			join(systemRoot, "System32", "WindowsPowerShell", "v1.0"),
		];
	}
	return ["/usr/bin", "/bin"];
}

function writeShim(fakeBin, host) {
	if (process.platform === "win32") {
		const shim = join(fakeBin, `${host}.cmd`);
		writeFileSync(shim, `@echo off\r\n"${process.execPath}" "${FAKE_HOST_SCRIPT}" ${host} %*\r\nexit /b %ERRORLEVEL%\r\n`, "utf8");
		return shim;
	}
	const shim = join(fakeBin, host);
	writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${FAKE_HOST_SCRIPT}" ${host} "$@"\n`, "utf8");
	chmodSync(shim, 0o755);
	return shim;
}

/** Remove every HELI_* variable from process.env (for in-process kernel tests). */
export function scrubHeliProcessEnv() {
	for (const key of Object.keys(process.env)) {
		if (key.toUpperCase().startsWith("HELI_")) delete process.env[key];
	}
}

/**
 * @param {{ prefix?: string, hosts?: readonly string[] }} [options]
 */
export function createHermeticEnv({ prefix = "heli-hermetic-", hosts = FAKE_HOST_NAMES } = {}) {
	const root = mkdtempSync(join(tmpdir(), prefix));
	const home = join(root, "home");
	const fakeBin = join(root, "fake-bin");
	const tempDir = join(root, "tmp");
	const logPath = join(root, "fake-host-calls.jsonl");
	const responsesPath = join(root, "fake-host-responses.json");
	for (const dir of [home, fakeBin, tempDir, join(home, "AppData", "Roaming"), join(home, "AppData", "Local"), join(home, ".config")]) {
		mkdirSync(dir, { recursive: true });
	}
	writeFileSync(logPath, "", "utf8");
	writeFileSync(responsesPath, "{}\n", "utf8");
	for (const host of hosts) writeShim(fakeBin, host);

	const env = {};
	if (process.platform === "win32") {
		for (const key of WINDOWS_PASSTHROUGH) if (process.env[key]) env[key] = process.env[key];
	}
	for (const key of ["LANG", "LC_ALL", "TERM"]) if (process.env[key]) env[key] = process.env[key];
	Object.assign(env, {
		PATH: [fakeBin, dirname(process.execPath), ...systemPathDirs()].join(delimiter),
		HOME: home,
		USERPROFILE: home,
		APPDATA: join(home, "AppData", "Roaming"),
		LOCALAPPDATA: join(home, "AppData", "Local"),
		XDG_CONFIG_HOME: join(home, ".config"),
		TEMP: tempDir,
		TMP: tempDir,
		TMPDIR: tempDir,
		HELI_HOST_HOME: home,
		HELI_CONFIG_DIR: join(home, ".heli"),
		HELI_DATA_DIR: join(home, ".heli-data"),
		CLAUDE_CONFIG_DIR: join(home, ".claude"),
		CODEX_HOME: join(home, ".codex"),
		KIMI_CODE_HOME: join(home, ".kimi-code"),
		HELI_FAKE_HOST_LOG: logPath,
		HELI_FAKE_HOST_RESPONSES: responsesPath,
	});

	return {
		root,
		home,
		fakeBin,
		logPath,
		env,
		/** @returns {Array<{ host: string, args: string[] }>} */
		readLog() {
			if (!existsSync(logPath)) return [];
			return readFileSync(logPath, "utf8")
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line));
		},
		/** Canned output for one exact command line, e.g. "claude plugin list --json". */
		setResponse(key, response) {
			const current = JSON.parse(readFileSync(responsesPath, "utf8"));
			current[key] = response;
			writeFileSync(responsesPath, `${JSON.stringify(current, null, 2)}\n`, "utf8");
		},
		/**
		 * Point this process's PATH/HOME/config vars at the hermetic values too, so a
		 * host call that forgets to forward `env` still reaches a fake CLI. The fake-log
		 * variables are deliberately NOT copied: a call that drops `env` leaves no log
		 * line, which the test's log assertions then catch. Returns a restore function.
		 */
		applyToProcess() {
			scrubHeliProcessEnv();
			const saved = {};
			for (const [key, value] of Object.entries(env)) {
				if (LOG_KEYS.has(key)) continue;
				saved[key] = process.env[key];
				process.env[key] = value;
			}
			return () => {
				for (const [key, value] of Object.entries(saved)) {
					if (value === undefined) delete process.env[key];
					else process.env[key] = value;
				}
			};
		},
		/** Throw unless `host` resolves to this environment's fake shim. */
		assertFakeResolution(host) {
			const probe = process.platform === "win32"
				? spawnSync("where", [host], { env, encoding: "utf8", windowsHide: true })
				: spawnSync("sh", ["-c", `command -v ${host}`], { env, encoding: "utf8" });
			const first = String(probe.stdout || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
			// Windows may spell the same temp directory once as a long path and once
			// through its 8.3 alias (for example runneradmin vs RUNNER~1). Compare the
			// real directories instead of their textual spellings so the leak check
			// still proves the shim came from this hermetic fake-bin.
			const resolvedDir = first ? realpathSync.native(dirname(first)) : "";
			const expectedDir = realpathSync.native(fakeBin);
			const normalize = (value) => process.platform === "win32" ? value.toLowerCase() : value;
			if (normalize(resolvedDir) !== normalize(expectedDir)) {
				throw new Error(`hermetic env leak: ${host} resolves to "${first || "nothing"}", expected a shim in ${fakeBin}`);
			}
		},
		cleanup() {
			rmSync(root, { recursive: true, force: true });
		},
	};
}
