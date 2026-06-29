import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { execSync } from "node:child_process";
import { platform } from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function detectWorkspaceHarness(cwd) {
	const harnessPath = join(cwd, ".heli-harness", "HARNESS.md");
	return existsSync(harnessPath);
}

function getPackageRoot() {
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
			execSync(`powershell -ExecutionPolicy Bypass -File "${script}" -Parent "${cwd}"`, { stdio: "inherit", cwd: packageRoot });
		} else {
			const script = join(packageRoot, "install.sh");
			execSync(`bash "${script}" "${cwd}"`, { stdio: "inherit", cwd: packageRoot });
		}
		return { success: true };
	} catch (error) {
		return { success: false, error: String(error) };
	}
}

function isSuspiciousHarnessRuntimePath(filePath) {
	const normalized = String(filePath || "").replaceAll("\\", "/");
	const hasHiddenHarnessFolder = /(^|\/)\.[^/]*harness(\/|$)/.test(normalized);
	const isCurrentRuntime =
		normalized.includes("/.heli-harness/") ||
		normalized.endsWith("/.heli-harness") ||
		normalized === ".heli-harness";
	return hasHiddenHarnessFolder && !isCurrentRuntime;
}

const DANGEROUS_BASH_PATTERNS = [
	{ pattern: /npm\s+publish/, reason: "npm publish is a release operation" },
	{ pattern: /npm\s+run\s+release/, reason: "npm run release is a release operation" },
	{ pattern: /npm\s+run\s+version/, reason: "npm run version is a versioning operation" },
	{ pattern: /git\s+push/, reason: "git push is a remote operation" },
	{ pattern: /git\s+tag/, reason: "git tag is a versioning operation" },
	{ pattern: /git\s+reset\s+--hard/, reason: "git reset --hard is destructive" },
	{ pattern: /git\s+clean\s+-fd/, reason: "git clean -fd is destructive" },
	{ pattern: /rm\s+-rf/, reason: "rm -rf is destructive" },
	{ pattern: /AXGA_ALLOW_LOCKFILE_CHANGE=1/, reason: "AXGA lockfile change override" },
	{ pattern: /\.\/axga-test\.sh/, reason: "axga-test.sh may consume API credits" },
	{ pattern: /npm\s+run\s+e2e:swarm/, reason: "e2e:swarm may consume API credits" },
];

const DANGEROUS_FILE_PATTERNS = [
	{ pattern: /\.env$/, reason: ".env files contain secrets" },
	{ pattern: /\.pem$/, reason: "PEM files are private keys" },
	{ pattern: /\.key$/, reason: "Key files are credentials" },
	{ pattern: /credentials/, reason: "Credential files contain secrets" },
];

export default function heliHarnessExtension(pi) {
	let workspaceDetected = false;
	let lastCtx = null;

	function syncStatus(ctx) {
		if (ctx) lastCtx = ctx;
		const c = ctx || lastCtx;
		if (!c?.ui?.setStatus) return;
		if (workspaceDetected) {
			c.ui.setStatus("heli", "● Heli-Harness: active");
		} else {
			c.ui.setStatus("heli", "○ Heli-Harness: package-only");
		}
	}

	const installHandler = async (_args, ctx) => {
		const cwd = process.cwd();
		if (detectWorkspaceHarness(cwd)) {
			ctx?.ui?.notify?.("Workspace harness already installed in this folder", "warning");
			return;
		}
		const confirmed = await ctx?.ui?.confirm?.("Install Heli-Harness workspace harness into current folder?", "This will create .heli-harness/ and adapter pointer files (AGENTS.md, CLAUDE.md) in the current directory.");
		if (!confirmed) {
			ctx?.ui?.notify?.("Install cancelled", "info");
			return;
		}
		ctx?.ui?.notify?.("Installing workspace harness...", "info");
		const result = runInstaller(cwd);
		if (result.success) {
			const verification = verifyInstall(cwd);
			if (verification.success) {
				ctx?.ui?.notify?.("Workspace harness installed successfully", "success");
				ctx?.ui?.notify?.("Created: .heli-harness/, AGENTS.md, CLAUDE.md", "info");
				ctx?.ui?.notify?.("Next: Create a repo profile under .heli-harness/profiles/", "info");
				workspaceDetected = true;
				syncStatus(ctx);
			} else {
				ctx?.ui?.notify?.("Install completed but verification failed", "warning");
				ctx?.ui?.notify?.(`Missing: ${verification.missing.join(", ")}`, "warning");
			}
		} else {
			ctx?.ui?.notify?.("Install failed", "error");
			ctx?.ui?.notify?.(result.error || "Unknown error", "error");
		}
	};

	const statusHandler = async (_args, ctx) => {
		const cwd = process.cwd();
		const harnessPath = join(cwd, ".heli-harness");
		const harnessMd = join(harnessPath, "HARNESS.md");
		const harnessDetected = detectWorkspaceHarness(cwd);
		ctx?.ui?.notify?.("Heli-Harness Status", "info");
		ctx?.ui?.notify?.(`CWD: ${cwd}`, "info");
		ctx?.ui?.notify?.(`Workspace harness: ${harnessDetected ? "detected" : "not installed"}`, harnessDetected ? "success" : "warning");
		if (harnessDetected) {
			ctx?.ui?.notify?.(`HARNESS.md: ${harnessMd}`, "info");
		} else {
			ctx?.ui?.notify?.("Run /heli-install or /hh-install to set up workspace harness", "info");
		}
	};

	const workflowHandler = (skillName, description) => {
		return async (_args, ctx) => {
			const cwd = process.cwd();
			const harnessDetected = detectWorkspaceHarness(cwd);
			if (!harnessDetected) {
				ctx?.ui?.notify?.("Workspace harness not installed", "warning");
				ctx?.ui?.notify?.("Run /heli-install or /hh-install to set up workspace harness", "info");
				return;
			}
			ctx?.ui?.notify?.(`Running ${description}...`, "info");
			pi.sendUserMessage(`/skill:${skillName}`);
		};
	};

	const hooksStatusHandler = async (_args, ctx) => {
		const cwd = process.cwd();
		const harnessDetected = detectWorkspaceHarness(cwd);
		ctx?.ui?.notify?.("Heli-Harness Auto Hooks Status", "info");
		ctx?.ui?.notify?.(`Workspace harness: ${harnessDetected ? "detected" : "not installed"}`, harnessDetected ? "success" : "warning");
		ctx?.ui?.notify?.(`before_agent_start injection: ${harnessDetected ? "active" : "inactive"}`, "info");
		ctx?.ui?.notify?.(`tool_call safety guard: active`, "info");
		ctx?.ui?.notify?.(`input shortcuts: active`, "info");
		if (!harnessDetected) {
			ctx?.ui?.notify?.("Run /heli-install to activate workspace hooks", "info");
		}
	};

	pi.on("session_start", async (_event, ctx) => {
		const cwd = process.cwd();
		workspaceDetected = detectWorkspaceHarness(cwd);
		if (workspaceDetected) {
			ctx?.ui?.notify?.("Heli-Harness active", "success");
		} else {
			ctx?.ui?.notify?.("Heli-Harness package loaded; run /heli-install to set up workspace harness", "info");
		}
		syncStatus(ctx);
	});

	pi.on("before_agent_start", async (event) => {
		if (!workspaceDetected) return;
		const heliInstructions = `
Heli-Harness workspace detected.

Before non-trivial work:
- Read .heli-harness/HARNESS.md.
- Identify the target repo.
- Read .heli-harness/profiles/<repo>.md if present.
- Preserve dirty work.
- Update .heli-harness/state/current-task.md for meaningful tasks.
- Classify commands before running them.
- Do not run mutating, API-credit, release, publish, push, or destructive commands without explicit user approval.
- Prefer safe audit-only and non-mutating checks first.`;
		return { systemPrompt: `${event.systemPrompt}\n\n${heliInstructions}` };
	});

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName === "bash" && event.input?.command) {
			const command = event.input.command;
			for (const { pattern, reason } of DANGEROUS_BASH_PATTERNS) {
				if (pattern.test(command)) {
					if (ctx?.ui?.confirm) {
						const ok = await ctx.ui.confirm("Dangerous command detected", `${reason}\n\nCommand: ${command}\n\nAllow?`);
						if (!ok) {
							return { block: true, reason: `Blocked: ${reason}` };
						}

					}
				} else {
					return { block: true, reason: `Blocked: ${reason}. Run command explicitly to override.` };
				}
			}
		}
	}
	if ((event.toolName === "write" || event.toolName === "edit") && event.input?.path) {
		const path = event.input.path;
		if (isSuspiciousHarnessRuntimePath(path)) {
			const reason = "Suspicious harness runtime folder detected";
			if (ctx?.ui?.confirm) {
				const ok = await ctx.ui.confirm("Dangerous file operation", `${reason}

Path: ${path}

Allow?`);
				if (!ok) {
					return { block: true, reason: `Blocked: ${reason}` };
				}
			} else {
				return { block: true, reason: `Blocked: ${reason}. Run operation explicitly to override.` };
			}
		}
		for (const { pattern, reason } of DANGEROUS_FILE_PATTERNS) {
			if (pattern.test(path)) {
				if (ctx?.ui?.confirm) {
					const ok = await ctx.ui.confirm("Dangerous file operation", `${reason}

Path: ${path}

Allow?`);
					if (!ok) {
						return { block: true, reason: `Blocked: ${reason}` };
					}
				} else {
					return { block: true, reason: `Blocked: ${reason}. Run operation explicitly to override.` };
				}
			}
		}
	}
});

pi.on("input", async (event) => {
	if (event?.source === "extension") return;
	const text = String(event?.text || "").trim();
	if (text === "/review") {
		return { action: "transform", text: "/heli-review" };
	}
	if (text === "/audit") {
		return { action: "transform", text: "/heli-audit" };
	}
	if (text === "/validate") {
		return { action: "transform", text: "/heli-validate" };
	}
	if (text === "/impact") {
		return { action: "transform", text: "/heli-impact" };
	}
});

pi.registerCommand("heli-install", { description: "Install Heli-Harness workspace harness into current folder", handler: installHandler });
pi.registerCommand("hh-install", { description: "Alias for /heli-install", handler: installHandler });
pi.registerCommand("hh-status", { description: "Report Heli-Harness status in current folder", handler: statusHandler });
pi.registerCommand("heli-help", { description: "Show Heli-Harness commands and what they do", handler: workflowHandler("heli-help", "Heli-Harness help") });
pi.registerCommand("heli-init", { description: "Bootstrap a repo profile for a target repo", handler: workflowHandler("heli-init", "repo profile bootstrap") });
pi.registerCommand("heli-review", { description: "Review current repo/diff/task safely", handler: workflowHandler("heli-review", "repo review") });
pi.registerCommand("heli-audit", { description: "Repo-wide audit for issues and risks", handler: workflowHandler("heli-audit", "repo audit") });
pi.registerCommand("heli-validate", { description: "Run test-validation workflow safely", handler: workflowHandler("heli-validate", "test validation") });
pi.registerCommand("heli-impact", { description: "Impact analysis for planned changes", handler: workflowHandler("heli-impact", "impact analysis") });
pi.registerCommand("heli-hooks", { description: "Show Heli-Harness auto hooks status", handler: hooksStatusHandler });
}
