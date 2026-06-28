import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { execSync } from "node:child_process";
import { platform } from "node:os";
import { fileURLToPath } from "node:url";

/**
 * Heli-Harness Pi Extension
 *
 * Lightweight extension that:
 * - Announces Heli-Harness status on session start
 * - Detects whether workspace harness is installed in cwd
 * - Provides /heli-install and /hh-install commands to install workspace harness
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function detectWorkspaceHarness(cwd) {
	const harnessPath = join(cwd, ".heli-harness", "HARNESS.md");
	return existsSync(harnessPath);
}

function getPackageRoot() {
	// Extension is at extensions/pi-extension.js
	// Package root is one level up
	return join(__dirname, "..");
}

function verifyInstall(cwd) {
	const checks = [
		join(cwd, ".heli-harness", "HARNESS.md"),
		join(cwd, ".heli-harness", "manifest.json"),
		join(cwd, ".heli-harness", "skills", "test-validation", "SKILL.md"),
		join(cwd, "AGENTS.md"),
		join(cwd, "CLAUDE.md"),
	];

	const missing = checks.filter((path) => !existsSync(path));
	return { success: missing.length === 0, missing };
}

function runInstaller(cwd) {
	const packageRoot = getPackageRoot();
	const isWindows = platform() === "win32";

	try {
		if (isWindows) {
			const script = join(packageRoot, "install.ps1");
			execSync(
				`powershell -ExecutionPolicy Bypass -File "${script}" -Parent "${cwd}"`,
				{
					stdio: "inherit",
					cwd: packageRoot,
				},
			);
		} else {
			const script = join(packageRoot, "install.sh");
			execSync(`bash "${script}" "${cwd}"`, {
				stdio: "inherit",
				cwd: packageRoot,
			});
		}
		return { success: true };
	} catch (error) {
		return { success: false, error: String(error) };
	}
}

export default function heliHarnessExtension(pi) {
	// Shared handler for install commands
	const installHandler = async (_args, ctx) => {
		const cwd = process.cwd();

		// Check if already installed
		if (detectWorkspaceHarness(cwd)) {
			ctx?.ui?.notify?.(
				"Workspace harness already installed in this folder",
				"warning",
			);
			return;
		}

		// Ask for confirmation
		const confirmed = await ctx?.ui?.confirm?.(
			"Install Heli-Harness workspace harness into current folder?",
			"This will create .heli-harness/ and adapter pointer files (AGENTS.md, CLAUDE.md) in the current directory.",
		);

		if (!confirmed) {
			ctx?.ui?.notify?.("Install cancelled", "info");
			return;
		}

		ctx?.ui?.notify?.("Installing workspace harness...", "info");

		const result = runInstaller(cwd);

		if (result.success) {
			const verification = verifyInstall(cwd);
			if (verification.success) {
				ctx?.ui?.notify?.(
					"Workspace harness installed successfully",
					"success",
				);
				ctx?.ui?.notify?.(
					"Created: .heli-harness/, AGENTS.md, CLAUDE.md",
					"info",
				);
				ctx?.ui?.notify?.(
					"Next: Create a repo profile under .heli-harness/profiles/",
					"info",
				);
			} else {
				ctx?.ui?.notify?.(
					"Install completed but verification failed",
					"warning",
				);
				ctx?.ui?.notify?.(
					`Missing: ${verification.missing.join(", ")}`,
					"warning",
				);
			}
		} else {
			ctx?.ui?.notify?.("Install failed", "error");
			ctx?.ui?.notify?.(result.error || "Unknown error", "error");
		}
	};

	// Status handler for /hh-status
	const statusHandler = async (_args, ctx) => {
		const cwd = process.cwd();
		const harnessPath = join(cwd, ".heli-harness");
		const harnessMd = join(harnessPath, "HARNESS.md");
		const harnessDetected = detectWorkspaceHarness(cwd);

		ctx?.ui?.notify?.("Heli-Harness Status", "info");
		ctx?.ui?.notify?.(`CWD: ${cwd}`, "info");
		ctx?.ui?.notify?.(
			`Workspace harness: ${harnessDetected ? "detected" : "not installed"}`,
			harnessDetected ? "success" : "warning",
		);
		if (harnessDetected) {
			ctx?.ui?.notify?.(`HARNESS.md: ${harnessMd}`, "info");
		} else {
			ctx?.ui?.notify?.(
				"Run /heli-install or /hh-install to set up workspace harness",
				"info",
			);
		}
	};

	pi.on("session_start", async (_event, ctx) => {
		const cwd = process.cwd();
		const harnessDetected = detectWorkspaceHarness(cwd);

		ctx?.ui?.notify?.("Heli-Harness loaded", "info");

		if (harnessDetected) {
			ctx?.ui?.notify?.("Workspace harness detected", "info");
		} else {
			ctx?.ui?.notify?.(
				"Pi package loaded; workspace harness not installed in this folder",
				"info",
			);
			ctx?.ui?.notify?.(
				"Run /heli-install to set up workspace harness",
				"info",
			);
		}
	});

	// Register /heli-install (primary command)
	pi.registerCommand("heli-install", {
		description: "Install Heli-Harness workspace harness into current folder",
		handler: installHandler,
	});

	// Register /hh-install (short alias)
	pi.registerCommand("hh-install", {
		description: "Alias for /heli-install",
		handler: installHandler,
	});

	// Register /hh-status
	pi.registerCommand("hh-status", {
		description: "Report Heli-Harness status in current folder",
		handler: statusHandler,
	});
}
