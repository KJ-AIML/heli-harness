import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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

function safeReadText(path) {
	try {
		return readFileSync(path, "utf8");
	} catch (_error) {
		return "";
	}
}

function safeReadJson(path) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch (_error) {
		return null;
	}
}

function safeListFiles(dir) {
	try {
		return readdirSync(dir).map((name) => join(dir, name));
	} catch (_error) {
		return [];
	}
}

function isFile(path) {
	try {
		return statSync(path).isFile();
	} catch (_error) {
		return false;
	}
}

function isDirectory(path) {
	try {
		return statSync(path).isDirectory();
	} catch (_error) {
		return false;
	}
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
	const normalized = String(filePath || "").split("\\").join("/");
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

function getUi(ctx) {
	if (!ctx || !ctx.ui) return null;
	return ctx.ui;
}

function notify(ctx, message, level) {
	const ui = getUi(ctx);
	if (ui && typeof ui.notify === "function") {
		ui.notify(message, level);
	}
}

function setStatus(ctx, key, value) {
	const ui = getUi(ctx);
	if (ui && typeof ui.setStatus === "function") {
		ui.setStatus(key, value);
	}
}

function canConfirm(ctx) {
	const ui = getUi(ctx);
	return !!(ui && typeof ui.confirm === "function");
}

function normalizeCommandText(args) {
	if (typeof args === "string") return args.trim();
	if (Array.isArray(args)) return args.map((value) => String(value)).join(" ").trim();
	if (args && typeof args === "object") {
		if (typeof args.text === "string") return args.text.trim();
		if (typeof args.command === "string") return args.command.trim();
		if (typeof args.args === "string") return args.args.trim();
		if (Array.isArray(args.args)) return args.args.map((value) => String(value)).join(" ").trim();
	}
	return "";
}

function getPackageVersion() {
	const packageJson = safeReadJson(join(getPackageRoot(), "package.json"));
	return packageJson && packageJson.version ? packageJson.version : "unknown";
}

function getSkillCount(cwd) {
	const manifest =
		safeReadJson(join(cwd, ".heli-harness", "manifest.json")) ||
		safeReadJson(join(getPackageRoot(), ".heli-harness", "manifest.json"));
	if (manifest && Array.isArray(manifest.skills)) return manifest.skills.length;
	return "unknown";
}

function getTargetRepo(cwd) {
	const task = safeReadText(join(cwd, ".heli-harness", "state", "current-task.md"));
	const match = task.match(/^Target repo:\s*(.+)$/im);
	if (!match || !match[1].trim()) return "not configured";
	return match[1].trim();
}

function getActiveProfile(cwd, targetRepo) {
	const profilesDir = join(cwd, ".heli-harness", "profiles");
	if (!isDirectory(profilesDir)) return "not installed in this workspace";
	if (targetRepo && targetRepo !== "not configured") {
		const direct = join(profilesDir, `${targetRepo}.md`);
		if (existsSync(direct)) return direct;
	}
	const profiles = safeListFiles(profilesDir).filter((path) => path.endsWith(".md") && isFile(path));
	if (profiles.length === 0) return "not configured";
	if (profiles.length === 1) return profiles[0];
	return `${profiles.length} profiles found; target repo not resolved`;
}

function getActivePolicies(cwd) {
	const policiesDir = join(cwd, ".heli-harness", "policies");
	if (!isDirectory(policiesDir)) return "not configured";
	const policies = safeListFiles(policiesDir).filter((path) => path.endsWith(".md") && isFile(path));
	if (policies.length === 0) return "not configured";
	return policies.map((path) => path.split(/[\\/]/).pop()).join(", ");
}

function hasHeading(text, heading) {
	const pattern = new RegExp(`^#{1,6}\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "im");
	return pattern.test(text);
}

function pushMissingSectionWarnings(warnings, label, text, sections) {
	for (const section of sections) {
		if (!hasHeading(text, section)) warnings.push(`${label}: missing section "${section}"`);
	}
}

function lintProfiles(cwd) {
	const profilesDir = join(cwd, ".heli-harness", "profiles");
	const requiredSections = [
		"Observed stack",
		"Existing patterns",
		"Recommended conventions",
		"Known tech debt",
		"Forbidden patterns",
		"Command tiers",
		"Repo risks",
		"Exceptions",
	];
	if (!isDirectory(profilesDir)) return { checked: 0, warnings: ["No profile directory found."] };
	const profiles = safeListFiles(profilesDir).filter((path) => path.endsWith(".md") && isFile(path));
	if (profiles.length === 0) return { checked: 0, warnings: ["No repo profiles found."] };
	const warnings = [];
	for (const profile of profiles) {
		const label = profile.split(/[\\/]/).pop();
		const text = safeReadText(profile);
		const lower = text.toLowerCase();
		pushMissingSectionWarnings(warnings, label, text, requiredSections);
		if (/follow existing patterns/i.test(text) && !hasHeading(text, "Known tech debt")) {
			warnings.push(`${label}: says "follow existing patterns" without a Known tech debt section`);
		}
		if (/(required|must|forbidden|do not|requires approval)/i.test(text) && !hasHeading(text, "Forbidden patterns")) {
			warnings.push(`${label}: may mix prescriptive policy with repo facts; move policy to overlays in v0.4.0`);
		}
		if (/(risky|unsafe|hardcoded|secret|credential|fragile|deprecated)/i.test(text) && !/known tech debt|forbidden patterns|repo risks/i.test(lower)) {
			warnings.push(`${label}: mentions risky patterns without classifying them`);
		}
	}
	return { checked: profiles.length, warnings };
}

function lintReports(cwd) {
	const reportDirs = [join(cwd, ".heli-harness", "state", "reports"), join(cwd, ".heli-harness", "state")];
	const requiredSections = [
		"Target repo",
		"Task",
		"Files changed",
		"Commands run",
		"Validation",
		"Policy decisions",
		"Risks",
		"Next steps",
	];
	const reports = [];
	for (const dir of reportDirs) {
		for (const file of safeListFiles(dir)) {
			const name = file.split(/[\\/]/).pop();
			if (!file.endsWith(".md") || !isFile(file)) continue;
			if (["README.md", "current-task.md", "decisions.md"].includes(name)) continue;
			reports.push(file);
		}
	}
	if (reports.length === 0) return { checked: 0, warnings: ["No run reports found."] };
	const warnings = [];
	for (const report of reports) {
		const label = report.split(/[\\/]/).pop();
		const text = safeReadText(report);
		pushMissingSectionWarnings(warnings, label, text, requiredSections);
		if (/complete|completed|done/i.test(text) && !/validation|test|check/i.test(text)) {
			warnings.push(`${label}: claims completion without validation evidence`);
		}
		if (/policy deviation|deviation/i.test(text) && !/justification|because|reason/i.test(text)) {
			warnings.push(`${label}: mentions policy deviation without justification`);
		}
		if (/skip|skipped/i.test(text) && /validation|test|check/i.test(text) && !/because|reason|not available|not applicable/i.test(text)) {
			warnings.push(`${label}: mentions skipped validation without a reason`);
		}
	}
	return { checked: reports.length, warnings };
}

function notifyLintResult(ctx, title, result) {
	notify(ctx, title, result.warnings.length === 0 ? "success" : "warning");
	notify(ctx, `Checked: ${result.checked}`, "info");
	if (result.warnings.length === 0) {
		notify(ctx, "Warnings: none", "success");
		return;
	}
	for (const warning of result.warnings) {
		notify(ctx, `Warning: ${warning}`, "warning");
	}
}

async function confirmDangerous(ctx, title, message, reason) {
	const ui = getUi(ctx);
	if (ui && typeof ui.confirm === "function") {
		const ok = await ui.confirm(title, message);
		if (ok) return undefined;
		return { block: true, reason: `Blocked: ${reason}` };
	}
	return { block: true, reason: `Blocked: ${reason}. Run operation explicitly to override.` };
}

export default function heliHarnessExtension(pi) {
	let workspaceDetected = false;
	let lastCtx = null;
	let hookProbePromptPending = false;
	let hookProbeGuardPending = false;
	let lastSessionStartAt = "not observed";
	let lastBeforeAgentStartAt = "not observed";
	let lastToolGuardAt = "not observed";
	let lastInputShortcutAt = "not observed";

	function syncStatus(ctx) {
		if (ctx) lastCtx = ctx;
		const c = ctx || lastCtx;
		if (workspaceDetected) {
			setStatus(c, "heli", "● Heli-Harness: active");
		} else {
			setStatus(c, "heli", "○ Heli-Harness: package-only");
		}
	}

	function armHookProbe(ctx) {
		hookProbePromptPending = true;
		hookProbeGuardPending = true;
		notify(ctx, "Heli hook probe armed", "info");
		notify(ctx, "Next turn should surface HELI_HOOK_OK in the prompt", "info");
		notify(ctx, "Run /heli-hooks test-guard, then a dangerous command, to surface HELI_GUARD_OK", "info");
	}

	function clearHookProbe(ctx) {
		hookProbePromptPending = false;
		hookProbeGuardPending = false;
		notify(ctx, "Heli hook probe cleared", "info");
	}

	const installHandler = async (_args, ctx) => {
		const cwd = process.cwd();
		if (detectWorkspaceHarness(cwd)) {
			notify(ctx, "Workspace harness already installed in this folder", "warning");
			return;
		}
		let confirmed = false;
		if (canConfirm(ctx)) {
			confirmed = await getUi(ctx).confirm("Install Heli-Harness workspace harness into current folder?", "This will create .heli-harness/ and adapter pointer files (AGENTS.md, CLAUDE.md) in the current directory.");
		}
		if (!confirmed) {
			notify(ctx, "Install cancelled", "info");
			return;
		}
		notify(ctx, "Installing workspace harness...", "info");
		const result = runInstaller(cwd);
		if (result.success) {
			const verification = verifyInstall(cwd);
			if (verification.success) {
				notify(ctx, "Workspace harness installed successfully", "success");
				notify(ctx, "Created: .heli-harness/, AGENTS.md, CLAUDE.md", "info");
				notify(ctx, "Next: Create a repo profile under .heli-harness/profiles/", "info");
				workspaceDetected = true;
				syncStatus(ctx);
			} else {
				notify(ctx, "Install completed but verification failed", "warning");
				notify(ctx, `Missing: ${verification.missing.join(", ")}`, "warning");
			}
		} else {
			notify(ctx, "Install failed", "error");
			notify(ctx, result.error || "Unknown error", "error");
		}
	};

	const statusHandler = async (_args, ctx) => {
		const cwd = process.cwd();
		const harnessPath = join(cwd, ".heli-harness");
		const harnessMd = join(harnessPath, "HARNESS.md");
		const harnessDetected = detectWorkspaceHarness(cwd);
		const targetRepo = getTargetRepo(cwd);
		notify(ctx, "Heli-Harness Status", "info");
		notify(ctx, `Version: ${getPackageVersion()}`, "info");
		notify(ctx, `Mode: ${harnessDetected ? "package + workspace" : "package only"}`, harnessDetected ? "success" : "warning");
		notify(ctx, `CWD: ${cwd}`, "info");
		notify(ctx, `Workspace harness: ${harnessDetected ? "detected" : "not installed"}`, harnessDetected ? "success" : "warning");
		notify(ctx, `Target repo: ${targetRepo}`, "info");
		notify(ctx, `Active profile: ${getActiveProfile(cwd, targetRepo)}`, "info");
		notify(ctx, `Active policies: ${getActivePolicies(cwd)}`, "info");
		notify(ctx, `Skill count: ${getSkillCount(cwd)}`, "info");
		notify(ctx, "Active hooks: session_start, before_agent_start, tool_call, input", "info");
		notify(ctx, `Recent hooks: session_start=${lastSessionStartAt}; before_agent_start=${lastBeforeAgentStartAt}; tool_call_guard=${lastToolGuardAt}; input_shortcut=${lastInputShortcutAt}`, "info");
		notify(ctx, `Probe state: prompt=${hookProbePromptPending ? "armed" : "inactive"}; guard=${hookProbeGuardPending ? "armed" : "inactive"}`, hookProbePromptPending || hookProbeGuardPending ? "warning" : "info");
		if (harnessDetected) {
			notify(ctx, `HARNESS.md: ${harnessMd}`, "info");
		} else {
			notify(ctx, "Next: run /heli-install or /hh-install to set up workspace harness", "info");
		}
	};

	const workflowHandler = (skillName, description) => {
		return async (_args, ctx) => {
			const cwd = process.cwd();
			const harnessDetected = detectWorkspaceHarness(cwd);
			if (!harnessDetected) {
				notify(ctx, "Workspace harness not installed", "warning");
				notify(ctx, "Run /heli-install or /hh-install to set up workspace harness", "info");
				return;
			}
			notify(ctx, `Running ${description}...`, "info");
			pi.sendUserMessage(`/skill:${skillName}`);
		};
	};

	const validateHandler = async (_args, ctx) => {
		const action = normalizeCommandText(_args).toLowerCase();
		const cwd = process.cwd();
		if (action === "lint" || action === "profile" || action === "profiles") {
			notifyLintResult(ctx, "Heli profile lint", lintProfiles(cwd));
			if (action !== "lint") return;
		}
		if (action === "lint" || action === "report" || action === "reports") {
			notifyLintResult(ctx, "Heli report lint", lintReports(cwd));
			return;
		}
		return workflowHandler("heli-validate", "test validation")(_args, ctx);
	};

	const hooksStatusHandler = async (_args, ctx) => {
		const action = normalizeCommandText(_args).toLowerCase();
		if (action === "probe") {
			armHookProbe(ctx);
			return;
		}
		if (action === "probe-off") {
			clearHookProbe(ctx);
			return;
		}
		if (action === "test-guard") {
			hookProbeGuardPending = true;
			notify(ctx, "Heli tool_call guard probe armed", "info");
			notify(ctx, "Next dangerous command should return HELI_GUARD_OK", "info");
			return;
		}
		const cwd = process.cwd();
		const harnessDetected = detectWorkspaceHarness(cwd);
		notify(ctx, "Heli-Harness Auto Hooks Status", "info");
		notify(ctx, `session_start hook: ${lastSessionStartAt === "not observed" ? "registered, not observed this session" : `observed at ${lastSessionStartAt}`}`, "info");
		notify(ctx, `before_agent_start injection: ${harnessDetected ? "active when workspace is detected" : "inactive; workspace not installed"}`, harnessDetected ? "success" : "warning");
		notify(ctx, "tool_call safety guard: active", "info");
		notify(ctx, "input shortcuts: active", "info");
		notify(ctx, `prompt probe: ${hookProbePromptPending ? "armed" : "inactive"}`, hookProbePromptPending ? "warning" : "info");
		notify(ctx, `test-guard probe: ${hookProbeGuardPending ? "armed" : "inactive"}`, hookProbeGuardPending ? "warning" : "info");
		notify(ctx, "/heli-hooks probe proves next-turn prompt injection by asking for HELI_HOOK_OK", "info");
		notify(ctx, "/heli-hooks test-guard proves tool_call interception by returning HELI_GUARD_OK before execution", "info");
		notify(ctx, "Probes do not prove every future host hook event; they prove this adapter path is active now", "info");
		notify(ctx, "Use /heli-hooks probe, /heli-hooks probe-off, or /heli-hooks test-guard", "info");
		if (!harnessDetected) {
			notify(ctx, "Run /heli-install to activate workspace hooks", "info");
		}
	};

	pi.on("session_start", async (_event, ctx) => {
		const cwd = process.cwd();
		workspaceDetected = detectWorkspaceHarness(cwd);
		lastSessionStartAt = new Date().toISOString();
		if (workspaceDetected) {
			notify(ctx, "Heli-Harness active", "success");
		} else {
			notify(ctx, "Heli-Harness package loaded; run /heli-install to set up workspace harness", "info");
		}
		syncStatus(ctx);
	});

	pi.on("before_agent_start", async (event) => {
		if (!workspaceDetected) return undefined;
		lastBeforeAgentStartAt = new Date().toISOString();
		const existingPrompt = event && event.systemPrompt ? event.systemPrompt : "";
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
		const probeInstructions = hookProbePromptPending
			? `

HELI_HOOK_PROBE_ACTIVE
For this one test turn only, start your next response with:
HELI_HOOK_OK`
			: "";
		hookProbePromptPending = false;
		return { systemPrompt: `${existingPrompt}\n\n${heliInstructions}${probeInstructions}` };
	});

	pi.on("tool_call", async (event, ctx) => {
		const toolName = event && event.toolName;
		const input = event && event.input ? event.input : {};

		if (toolName === "bash" && input.command) {
			const command = String(input.command);
			for (const { pattern, reason } of DANGEROUS_BASH_PATTERNS) {
				if (!pattern.test(command)) continue;
				lastToolGuardAt = new Date().toISOString();
				if (hookProbeGuardPending) {
					hookProbeGuardPending = false;
					return { block: true, reason: `HELI_GUARD_OK: intercepted ${reason}` };
				}
				return confirmDangerous(ctx, "Dangerous command detected", `${reason}\n\nCommand: ${command}\n\nAllow?`, reason);
			}
		}

		if ((toolName === "write" || toolName === "edit") && input.path) {
			const path = String(input.path);
			if (isSuspiciousHarnessRuntimePath(path)) {
				const reason = "Suspicious harness runtime folder detected";
				lastToolGuardAt = new Date().toISOString();
				if (hookProbeGuardPending) {
					hookProbeGuardPending = false;
					return { block: true, reason: `HELI_GUARD_OK: intercepted ${reason}` };
				}
				return confirmDangerous(ctx, "Dangerous file operation", `${reason}\n\nPath: ${path}\n\nAllow?`, reason);
			}

			for (const { pattern, reason } of DANGEROUS_FILE_PATTERNS) {
				if (pattern.test(path)) {
					lastToolGuardAt = new Date().toISOString();
					if (hookProbeGuardPending) {
						hookProbeGuardPending = false;
						return { block: true, reason: `HELI_GUARD_OK: intercepted ${reason}` };
					}
					return confirmDangerous(ctx, "Dangerous file operation", `${reason}\n\nPath: ${path}\n\nAllow?`, reason);
				}
			}
		}

		return undefined;
	});

	pi.on("input", async (event) => {
		if (event && event.source === "extension") return undefined;
		const text = String(event && event.text ? event.text : "").trim();
		if (text === "/review") {
			lastInputShortcutAt = new Date().toISOString();
			return { action: "transform", text: "/heli-review" };
		}
		if (text === "/audit") {
			lastInputShortcutAt = new Date().toISOString();
			return { action: "transform", text: "/heli-audit" };
		}
		if (text === "/validate") {
			lastInputShortcutAt = new Date().toISOString();
			return { action: "transform", text: "/heli-validate" };
		}
		if (text === "/impact") {
			lastInputShortcutAt = new Date().toISOString();
			return { action: "transform", text: "/heli-impact" };
		}
		return undefined;
	});

	pi.registerCommand("heli-install", { description: "Install Heli-Harness workspace harness into current folder", handler: installHandler });
	pi.registerCommand("hh-install", { description: "Alias for /heli-install", handler: installHandler });
	pi.registerCommand("hh-status", { description: "Report Heli-Harness status in current folder", handler: statusHandler });
	pi.registerCommand("heli-help", { description: "Show Heli-Harness commands and what they do", handler: workflowHandler("heli-help", "Heli-Harness help") });
	pi.registerCommand("heli-init", { description: "Bootstrap a repo profile for a target repo", handler: workflowHandler("heli-init", "repo profile bootstrap") });
	pi.registerCommand("heli-review", { description: "Review current repo/diff/task safely", handler: workflowHandler("heli-review", "repo review") });
	pi.registerCommand("heli-audit", { description: "Repo-wide audit for issues and risks", handler: workflowHandler("heli-audit", "repo audit") });
	pi.registerCommand("heli-validate", { description: "Run test-validation workflow safely; use lint/profile/report for local checks", handler: validateHandler });
	pi.registerCommand("heli-impact", { description: "Impact analysis for planned changes", handler: workflowHandler("heli-impact", "impact analysis") });
	pi.registerCommand("heli-hooks", { description: "Show Heli-Harness auto hooks status", handler: hooksStatusHandler });
}
