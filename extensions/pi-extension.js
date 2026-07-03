import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
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

function safeWriteJson(path, value) {
	try {
		writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
		return true;
	} catch (_error) {
		return false;
	}
}

function taskField(text, label) {
	const match = new RegExp(`^${label}:\\s*(.*)$`, "m").exec(text || "");
	return match ? match[1].trim() : "";
}

function lastDecisionSections(text, max = 5) {
	if (!text) return "";
	const sections = text.split(/(?=^## )/m).filter((part) => part.startsWith("## "));
	return sections.slice(-max).join("").trim();
}

function safeListFiles(dir) {
	try {
		return readdirSync(dir).sort().map((name) => join(dir, name));
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

const FALLBACK_COMMAND_RULES = [
	{ id: "git-push", match: "git push", tier: "T5", reason: "Remote git writes need explicit approval" },
	{ id: "git-tag", match: "git tag", tier: "T5", reason: "Version tags are release actions" },
	{ id: "npm-publish", match: "npm publish", tier: "T5", reason: "Publish actions are release operations" },
	{ id: "pnpm-publish", match: "pnpm publish", tier: "T5", reason: "Publish actions are release operations" },
	{ id: "yarn-publish", match: "yarn publish", tier: "T5", reason: "Publish actions are release operations" },
	{ id: "npm-run-publish", match: "npm run publish", tier: "T5", reason: "Publish actions are release operations" },
	{ id: "npm-run-release", match: "npm run release", tier: "T5", reason: "npm run release is a release operation" },
	{ id: "pnpm-run-release", match: "pnpm run release", tier: "T5", reason: "pnpm run release is a release operation" },
	{ id: "yarn-release", match: "yarn release", tier: "T5", reason: "yarn release is a release operation" },
	{ id: "npm-run-version", match: "npm run version", tier: "T5", reason: "npm run version is a versioning operation" },
	{ id: "npm-version", match: "npm version", tier: "T5", reason: "npm version is a versioning operation" },
	{ id: "git-reset-hard", match: "git reset --hard", tier: "T6", reason: "git reset --hard is destructive" },
	{ id: "git-clean-force", match: "git clean -fd", tier: "T6", reason: "git clean -fd is destructive" },
	{ id: "destructive-delete", match: "rm -rf", tier: "T6", reason: "Recursive delete is destructive" },
	{ id: "windows-rmdir", match: "rmdir /s", tier: "T6", reason: "Recursive delete is destructive" },
	{ id: "windows-del", match: "del /s", tier: "T6", reason: "Recursive delete is destructive" },
	{ id: "find-delete", match: "find . -delete", tier: "T6", reason: "find -delete is destructive" },
	{ id: "axga-lockfile-override", match: "AXGA_ALLOW_LOCKFILE_CHANGE=1", tier: "T4", reason: "AXGA lockfile change override" },
	{ id: "axga-test-script", match: "./axga-test.sh", tier: "T4", reason: "axga-test.sh may consume API credits" },
	{ id: "npm-e2e-swarm", match: "npm run e2e:swarm", tier: "T4", reason: "e2e:swarm may consume API credits" },
];

const COMMAND_RULE_TIERS = new Set(["T0", "T1", "T2", "T3", "T4", "T5", "T6"]);

const DANGEROUS_FILE_PATTERNS = [
	{ pattern: /\.env(?:\.bak)?$/, reason: ".env files contain secrets" },
	{ pattern: /(^|\/)\.env\.(local|production|development|test)(?:\.bak)?$/, reason: "env files contain secrets" },
	{ pattern: /\.pem(?:\.bak)?$/, reason: "PEM files are private keys" },
	{ pattern: /\.key(?:\.bak)?$/, reason: "Key files are credentials" },
	{ pattern: /(^|\/)credentials(\.json)?(?:\.bak)?$/, reason: "Credential files contain secrets" },
	{ pattern: /(^|\/)secrets\.json(?:\.bak)?$/, reason: "secret files contain secrets" },
	{ pattern: /(^|\/)\.(npmrc|pypirc)$/, reason: "package registry config may contain secrets" },
	{ pattern: /(^|\/)\.ssh\/id_[^/]+$/, reason: "SSH private keys contain secrets" },
];

const FILE_WRITE_TOOL_NAMES = new Set([
	"write",
	"edit",
	"multi_edit",
	"file_write",
	"file_edit",
	"fs.write",
	"filesystem.write",
]);

function getFileWritePaths(input) {
	const paths = [];
	if (input && typeof input.path === "string" && input.path) paths.push(input.path);
	if (input && typeof input.filePath === "string" && input.filePath) paths.push(input.filePath);
	if (input && typeof input.file_path === "string" && input.file_path) paths.push(input.file_path);
	if (input && Array.isArray(input.paths)) {
		for (const p of input.paths) {
			if (typeof p === "string" && p) paths.push(p);
		}
	}
	return paths;
}

const SECRET_CONTENT_PATTERNS = [
	/sk-[A-Za-z0-9_-]{8,}/,
	/ghp_[A-Za-z0-9_]{8,}/,
	/xoxb-[A-Za-z0-9-]{8,}/,
	/AKIA[0-9A-Z]{12,}/,
	/-----BEGIN [A-Z ]*PRIVATE KEY-----/,
	/\b(OPENAI_API_KEY|ANTHROPIC_API_KEY|DASHSCOPE_API_KEY)\s*=\s*\S+/,
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

function getWorkspacePaths(cwd) {
	const workspaceDir = join(cwd, ".heli-harness", "workspace");
	return {
		workspaceDir,
		indexPath: join(workspaceDir, "index.json"),
		targetPath: join(workspaceDir, "target.json"),
	};
}

function readWorkspaceIndex(cwd) {
	return safeReadJson(getWorkspacePaths(cwd).indexPath);
}

function readTargetState(cwd) {
	return safeReadJson(getWorkspacePaths(cwd).targetPath);
}

function getLockPaths(cwd) {
	return {
		sessionLockPath: join(
			cwd, ".heli-harness", "state", "session.lock.json"
		),
		targetLockPath: join(
			cwd, ".heli-harness", "workspace", "target.lock.json"
		),
	};
}

function readSessionLock(cwd) {
	return safeReadJson(getLockPaths(cwd).sessionLockPath);
}

function readTargetLock(cwd) {
	return safeReadJson(getLockPaths(cwd).targetLockPath);
}

function isLockExpired(lock) {
	if (!lock || !lock.expiresAt) return false;
	try {
		const exp = new Date(lock.expiresAt);
		return exp < new Date();
	} catch (_e) {
		return false;
	}
}

function pathExists(path) {
	return !!path && (isFile(path) || isDirectory(path));
}

function pathIsInside(basePath, candidatePath) {
	if (!basePath || !candidatePath) return false;
	const base = resolve(basePath);
	const candidate = resolve(candidatePath);
	const rel = relative(base, candidate);
	return rel === "" || (!rel.startsWith("..") && !rel.includes(":"));
}

function getWorkspaceRoot(cwd, index) {
	if (index && typeof index.workspaceRoot === "string" && index.workspaceRoot.trim()) {
		return resolve(cwd, index.workspaceRoot.trim());
	}
	return cwd;
}

function normalizeRepoEntry(cwd, index, repo) {
	const workspaceRoot = getWorkspaceRoot(cwd, index);
	const rawPath = repo && typeof repo.path === "string" ? repo.path : "";
	const rawGitRoot = repo && typeof repo.gitRoot === "string" ? repo.gitRoot : "";
	const rawProfile = repo && typeof repo.profile === "string" ? repo.profile : "";
	return {
		name: repo && repo.name ? String(repo.name) : "",
		path: rawPath,
		gitRoot: rawGitRoot,
		profile: rawProfile,
		defaultTarget: !!(repo && repo.defaultTarget),
		notes: repo && repo.notes ? String(repo.notes) : "",
		resolvedPath: rawPath ? resolve(workspaceRoot, rawPath) : "",
		resolvedGitRoot: rawGitRoot ? resolve(workspaceRoot, rawGitRoot) : "",
		resolvedProfile: rawProfile ? resolve(cwd, rawProfile) : "",
	};
}

function getWorkspaceRepos(cwd) {
	const index = readWorkspaceIndex(cwd);
	if (!index || !Array.isArray(index.repos)) return [];
	return index.repos.map((repo) => normalizeRepoEntry(cwd, index, repo));
}

function findWorkspaceRepo(cwd, selector) {
	const repos = getWorkspaceRepos(cwd);
	const trimmed = String(selector || "").trim().toLowerCase();
	if (!trimmed) return null;
	for (const repo of repos) {
		const values = [repo.name, repo.path, repo.gitRoot, repo.resolvedPath, repo.resolvedGitRoot]
			.filter(Boolean)
			.map((value) => String(value).toLowerCase());
		if (values.includes(trimmed)) return repo;
	}
	return null;
}

function getTargetRepo(cwd) {
	const targetState = readTargetState(cwd);
	if (targetState && targetState.targetRepo) return targetState.targetRepo;
	const task = safeReadText(join(cwd, ".heli-harness", "state", "current-task.md"));
	const match = task.match(/^Target repo:\s*(.+)$/im);
	if (!match || !match[1].trim()) return "not configured";
	return match[1].trim();
}

function isActiveProfileFile(path) {
	const name = path.split(/[\\/]/).pop().toLowerCase();
	return (
		name.endsWith(".md") &&
		name !== "readme.md" &&
		!name.endsWith(".example.md")
	);
}

function getActiveProfile(cwd, targetRepo) {
	const profilesDir = join(cwd, ".heli-harness", "profiles");
	if (!isDirectory(profilesDir)) return "not installed in this workspace";
	if (targetRepo && targetRepo !== "not configured") {
		const direct = join(profilesDir, `${targetRepo}.md`);
		if (existsSync(direct)) return direct;
	}
	const profiles = safeListFiles(profilesDir).filter((path) => isActiveProfileFile(path) && isFile(path));
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

function getOverlayFiles(dir, extensions) {
	if (!isDirectory(dir)) return [];
	return safeListFiles(dir)
		.filter((path) => isFile(path) && extensions.some((extension) => path.endsWith(extension)))
		.map((path) => path.split(/[\\/]/).pop());
}

function getCommandRulesStatus(cwd) {
	const rulesPath = join(cwd, ".heli-harness", "safety", "command-rules.json");
	if (!isFile(rulesPath)) return "not configured";
	const config = safeReadJson(rulesPath);
	if (!config) return "invalid JSON";
	const validation = validateCommandRules(config);
	return validation.valid ? "valid" : `invalid schema: ${validation.warnings[0]}`;
}

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compileCommandMatch(match) {
	const pattern = escapeRegExp(match.trim()).replace(/\s+/g, "\\s+");
	return new RegExp(pattern, "i");
}

function normalizeSafetyPath(value) {
	return String(value || "").trim().replace(/^['"]|['"]$/g, "").replace(/\\/g, "/").toLowerCase();
}

function collapseCommand(value) {
	return String(value || "").replace(/\\/g, "/").replace(/\s+/g, " ").trim();
}

function stripOuterQuotes(value) {
	const text = String(value || "").trim();
	if ((text.startsWith("\"") && text.endsWith("\"")) || (text.startsWith("'") && text.endsWith("'"))) {
		return text.slice(1, -1);
	}
	return text;
}

function splitCommandChain(command) {
	return collapseCommand(command).split(/\s*(?:&&|\|\||;)\s*/).filter(Boolean);
}

function unwrapShellCommand(command) {
	const text = collapseCommand(command);
	const match =
		text.match(/^(?:bash|sh)\s+-c\s+([\s\S]+)$/i) ||
		text.match(/^cmd(?:\.exe)?\s+\/c\s+([\s\S]+)$/i) ||
		text.match(/^(?:powershell|pwsh)(?:\.exe)?\s+(?:-command|-c)\s+([\s\S]+)$/i);
	return match ? stripOuterQuotes(match[1]) : "";
}

function stripGitGlobalFlags(command) {
	const text = collapseCommand(command);
	if (!text.match(/^git\s/i)) return "";
	const tokens = text.split(/\s+/);
	const result = [tokens[0]];
	let i = 1;
	while (i < tokens.length) {
		if (tokens[i] === "-C" && i + 1 < tokens.length) {
			i += 2;
			continue;
		}
		if (tokens[i] === "-c" && i + 1 < tokens.length) {
			i += 2;
			continue;
		}
		if (tokens[i].startsWith("-c") && tokens[i].includes("=")) {
			i += 1;
			continue;
		}
		result.push(tokens[i]);
		i += 1;
	}
	return result.join(" ");
}

function commandTokens(command) {
	return collapseCommand(command).toLowerCase().split(" ").filter(Boolean);
}

function hasCombinedFlags(tokens, ...flags) {
	return tokens.some((token) => token.startsWith("-") && !token.startsWith("--") && flags.every((flag) => token.includes(flag)));
}

function classifyCommandAliases(command) {
	const tokens = commandTokens(command);
	const variants = [];
	if (tokens[0] === "rm" && (tokens.some((token) => token === "-rf" || token === "-fr") || (tokens.includes("-r") && tokens.includes("-f")) || hasCombinedFlags(tokens, "r", "f"))) variants.push("rm -rf");
	if (tokens[0] === "rm" && tokens.includes("--recursive") && tokens.includes("--force")) variants.push("rm -rf");
	if (tokens[0] === "git" && tokens[1] === "clean" && (tokens.includes("-fd") || tokens.includes("-df") || (tokens.includes("-f") && tokens.includes("-d")) || hasCombinedFlags(tokens, "f", "d"))) variants.push("git clean -fd");
	if (tokens[0] === "git" && tokens[1] === "reset" && tokens.includes("--hard")) variants.push("git reset --hard");
	if (tokens[0] === "rmdir" && tokens.includes("/s")) variants.push("rmdir /s");
	if (tokens[0] === "del" && tokens.includes("/s")) variants.push("del /s");
	if (tokens[0] === "find" && tokens.includes("-delete")) variants.push("find . -delete");
	return variants;
}

function commandVariants(command) {
	const seen = new Set();
	const variants = [];
	const visit = (value) => {
		const normalized = collapseCommand(value);
		if (!normalized || seen.has(normalized.toLowerCase())) return;
		seen.add(normalized.toLowerCase());
		variants.push(normalized);
		for (const part of splitCommandChain(normalized)) visit(part);
		const unwrapped = unwrapShellCommand(normalized);
		if (unwrapped) visit(unwrapped);
		const stripped = stripGitGlobalFlags(normalized);
		if (stripped && stripped !== normalized) visit(stripped);
		for (const alias of classifyCommandAliases(normalized)) visit(alias);
	};
	visit(command);
	return variants;
}

function getSensitivePathReason(filePath) {
	const normalized = normalizeSafetyPath(filePath);
	for (const { pattern, reason } of DANGEROUS_FILE_PATTERNS) {
		if (pattern.test(normalized)) return reason;
	}
	return "";
}

function getWriteContent(input) {
	return String(
		input && (
			input.content ||
			input.text ||
			input.newText ||
			input.value ||
			input.replacement ||
			input.data ||
			""
		)
	);
}

function hasSecretLikeContent(input) {
	const content = getWriteContent(input);
	return !!content && SECRET_CONTENT_PATTERNS.some((pattern) => pattern.test(content));
}

function findShellRedirectionWrite(command) {
	for (const variant of commandVariants(command)) {
		const match = variant.match(/\b(?:echo|cat|printf)\b[\s\S]*?(?:^|[^>])>{1,2}\s*("[^"]+"|'[^']+'|[^\s;&|]+)/i);
		if (match) return stripOuterQuotes(match[1]);
		const psMatch = variant.match(/\b(?:out-file|set-content|add-content)\b[\s\S]*?(?:-filepath|-path)?\s*("[^"]+"|'[^']+'|[^\s;&|]+)/i);
		if (psMatch) return stripOuterQuotes(psMatch[1]);
	}
	return "";
}

function isSensitiveReadCommand(command) {
	for (const variant of commandVariants(command)) {
		const match = collapseCommand(variant).match(/^(?:cat|type|get-content)\s+(.+)$/i);
		if (match && getSensitivePathReason(match[1].split(/\s+/)[0])) return true;
	}
	return false;
}

function validateCommandRules(config) {
	const warnings = [];
	if (!config || typeof config !== "object" || Array.isArray(config)) {
		return { valid: false, warnings: ["command-rules.json must be an object"] };
	}
	if (config.version !== 1) warnings.push("version must be 1");
	if (!Array.isArray(config.rules)) {
		warnings.push("rules must be an array");
	} else {
		const ids = new Set();
		for (const [index, rule] of config.rules.entries()) {
			const label = `rules[${index}]`;
			if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
				warnings.push(`${label} must be an object`);
				continue;
			}
			if (typeof rule.id !== "string" || !rule.id.trim()) {
				warnings.push(`${label}.id must be a non-empty string`);
			} else if (ids.has(rule.id)) {
				warnings.push(`${label}.id duplicates "${rule.id}"`);
			} else {
				ids.add(rule.id);
			}
			if (typeof rule.match !== "string" || !rule.match.trim()) {
				warnings.push(`${label}.match must be a non-empty string`);
			}
			if (typeof rule.tier !== "string" || !COMMAND_RULE_TIERS.has(rule.tier)) {
				warnings.push(`${label}.tier must be T0-T6`);
			}
			if (typeof rule.reason !== "string" || !rule.reason.trim()) {
				warnings.push(`${label}.reason must be a non-empty string`);
			}
		}
	}
	return { valid: warnings.length === 0, warnings };
}

function compileCommandRules(rules) {
	return rules.map((rule) => ({
		id: rule.id,
		tier: rule.tier,
		reason: rule.reason,
		pattern: compileCommandMatch(rule.match),
	}));
}

function loadCommandGuardRules(cwd) {
	const candidatePaths = [
		join(cwd, ".heli-harness", "safety", "command-rules.json"),
		join(getPackageRoot(), ".heli-harness", "safety", "command-rules.json"),
	];
	for (const path of candidatePaths) {
		if (!isFile(path)) continue;
		const config = safeReadJson(path);
		const validation = validateCommandRules(config);
		if (validation.valid) {
			return { rules: compileCommandRules(config.rules), source: path, warnings: [] };
		}
		return {
			rules: compileCommandRules(FALLBACK_COMMAND_RULES),
			source: "built-in fallback",
			warnings: [`${path}: ${validation.warnings.join("; ")}`],
		};
	}
	return {
		rules: compileCommandRules(FALLBACK_COMMAND_RULES),
		source: "built-in fallback",
		warnings: ["command-rules.json missing; using built-in fallback rules"],
	};
}

function normalizeText(text) {
	return String(text || "").replace(/\r\n/g, "\n");
}

const PROFILE_REQUIRED_SECTIONS = [
	"Policy references",
	"Observed stack",
	"Existing patterns",
	"Recommended conventions",
	"Known tech debt",
	"Forbidden patterns",
	"Safer alternatives",
	"Command tiers",
	"Repo risks",
	"Exceptions",
	"Evidence paths",
];

const PROFILE_RISKY_KEYWORDS = [
	"hardcoded",
	"localstorage",
	"raw fetch",
	"secret",
	"token",
	"api key",
	"no tests",
	"no lint",
	"unsafe",
	"bypass",
	"wildcard",
	"public",
	"admin",
	"production",
	"deploy",
	"publish",
];

function hasHeading(text, heading) {
	const pattern = new RegExp(`^#{1,6}\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "im");
	return pattern.test(text);
}

function getSectionBody(text, heading) {
	const normalized = normalizeText(text);
	const headingPattern = new RegExp(`^#{1,6}\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "im");
	const match = headingPattern.exec(normalized);
	if (!match) return "";
	const start = match.index + match[0].length;
	const rest = normalized.slice(start);
	const nextHeading = /\n#{1,6}\s+/m.exec(rest);
	return (nextHeading ? rest.slice(0, nextHeading.index) : rest).trim();
}

function sectionHasContent(text, heading) {
	return /[a-z0-9]/i.test(getSectionBody(text, heading));
}

function sectionHasEvidence(text, heading) {
	const body = getSectionBody(text, heading);
	return (
		/`[^`]+`/.test(body) ||
		/(evidence path|package\.json|readme|agents\.md|claude\.md|tsconfig|vite|webpack|docker|compose|makefile|script|command|docs\/|\/|\\)/i.test(body)
	);
}

function textHasRiskyKeyword(text) {
	return PROFILE_RISKY_KEYWORDS.some((keyword) => text.toLowerCase().includes(keyword));
}

function pushMissingSectionWarnings(warnings, label, text, sections) {
	for (const section of sections) {
		if (!hasHeading(text, section)) warnings.push(`${label}: missing section "${section}"`);
	}
}

function lintProfiles(cwd) {
	const profilesDir = join(cwd, ".heli-harness", "profiles");
	const policyFiles = getOverlayFiles(join(cwd, ".heli-harness", "policies"), [".md"]);
	if (!isDirectory(profilesDir)) return { checked: 0, warnings: ["No profile directory found."] };
	const profiles = safeListFiles(profilesDir).filter((path) => isActiveProfileFile(path) && isFile(path));
	if (profiles.length === 0) return { checked: 0, warnings: ["No repo profiles found."] };
	const warnings = [];
	for (const profile of profiles) {
		const label = profile.split(/[\\/]/).pop();
		const text = normalizeText(safeReadText(profile));
		const lower = text.toLowerCase();
		pushMissingSectionWarnings(warnings, label, text, PROFILE_REQUIRED_SECTIONS);
		if (/(follow existing patterns|use existing approach)/i.test(text) && !sectionHasContent(text, "Known tech debt")) {
			warnings.push(`${label}: references existing patterns without classifying possible tech debt`);
		}
		const descriptiveSections = ["Observed stack", "Existing patterns", "Repo risks"];
		for (const section of descriptiveSections) {
			const body = getSectionBody(text, section);
			if (/\b(must|required|forbidden|do not|requires approval)\b/i.test(body)) {
				warnings.push(`${label}: prescriptive language appears under "${section}"; move it to policy overlays`);
			}
		}
		if (textHasRiskyKeyword(text) && !/known tech debt|forbidden patterns|repo risks/i.test(lower)) {
			warnings.push(`${label}: mentions risky patterns without classifying them`);
		}
		const recommendedBody = getSectionBody(text, "Recommended conventions");
		if (textHasRiskyKeyword(recommendedBody) && !/justification|because|reason|policy/i.test(recommendedBody)) {
			warnings.push(`${label}: recommended conventions mention risky patterns without justification`);
		}
		if (sectionHasContent(text, "Existing patterns") && !sectionHasEvidence(text, "Existing patterns") && !sectionHasContent(text, "Evidence paths")) {
			warnings.push(`${label}: existing patterns section has no evidence paths`);
		}
		if (sectionHasContent(text, "Recommended conventions") && !sectionHasEvidence(text, "Recommended conventions") && !sectionHasContent(text, "Evidence paths")) {
			warnings.push(`${label}: recommended conventions section has no evidence paths`);
		}
		if (sectionHasContent(text, "Known tech debt") && !sectionHasContent(text, "Safer alternatives")) {
			warnings.push(`${label}: known tech debt has no safer alternatives`);
		}
		if (policyFiles.length > 0 && !sectionHasContent(text, "Policy references")) {
			warnings.push(`${label}: policy overlays exist but the profile has no policy references`);
		}
		if (/(safe|safety|policy compliance|compliance|policy-compliant)/i.test(text) && !sectionHasContent(text, "Policy references")) {
			warnings.push(`${label}: claims safety or compliance without policy references`);
		}
	}
	return { checked: profiles.length, warnings };
}

function lintPolicies(cwd) {
	const policiesDir = join(cwd, ".heli-harness", "policies");
	const expectedFiles = ["engineering.md", "security.md", "release.md", "testing.md"];
	const requiredSections = ["Required", "Recommended", "Forbidden", "Requires approval", "Exceptions"];
	if (!isDirectory(policiesDir)) return { checked: 0, warnings: ["No policy directory found."] };
	const policies = safeListFiles(policiesDir).filter((path) => path.endsWith(".md") && isFile(path));
	if (policies.length === 0) return { checked: 0, warnings: ["No policy overlays found."] };
	const warnings = [];
	const found = policies.map((path) => path.split(/[\\/]/).pop());
	for (const expected of expectedFiles) {
		if (!found.includes(expected)) warnings.push(`policies: missing suggested file "${expected}"`);
	}
	for (const policy of policies) {
		const label = policy.split(/[\\/]/).pop();
		const text = normalizeText(safeReadText(policy));
		pushMissingSectionWarnings(warnings, label, text, requiredSections);
		for (const section of requiredSections) {
			if (hasHeading(text, section) && !sectionHasContent(text, section)) {
				warnings.push(`${label}: section "${section}" is empty`);
			}
		}
		const strictBody = `${getSectionBody(text, "Required")}\n${getSectionBody(text, "Forbidden")}`;
		if (/(best practice|use judgment|be careful|as appropriate|where appropriate|reasonable)/i.test(strictBody)) {
			warnings.push(`${label}: required or forbidden rules are too vague to enforce consistently`);
		}
		const exceptionsBody = getSectionBody(text, "Exceptions");
		const noExceptions = /\bnone currently approved\b|\bno exceptions\b/i.test(exceptionsBody);
		if (/[a-z0-9]/i.test(exceptionsBody) && !noExceptions && !/(scope:|condition:|approval:|justification:)/i.test(exceptionsBody)) {
			warnings.push(`${label}: exceptions should record scope, approval, and justification`);
		}
	}
	return { checked: policies.length, warnings };
}

function lintSafety(cwd) {
	const safetyDir = join(cwd, ".heli-harness", "safety");
	const expectedFiles = ["command-tiers.md", "command-rules.json", "secrets.md"];
	if (!isDirectory(safetyDir)) return { checked: 0, warnings: ["No safety directory found."] };
	const warnings = [];
	const files = getOverlayFiles(safetyDir, [".md", ".json"]);
	for (const expected of expectedFiles) {
		if (!files.includes(expected)) warnings.push(`safety: missing suggested file "${expected}"`);
	}
	const commandTiers = safeReadText(join(safetyDir, "command-tiers.md"));
	if (commandTiers) {
		for (const tier of ["T0", "T1", "T2", "T3", "T4", "T5", "T6"]) {
			if (!new RegExp(`\\b${tier}\\b`).test(commandTiers)) warnings.push(`command-tiers.md: missing ${tier}`);
		}
	}
	const secrets = normalizeText(safeReadText(join(safetyDir, "secrets.md")));
	if (secrets && !/(do not print|do not hardcode|approval|adapter support)/i.test(secrets)) {
		warnings.push("secrets.md: expected guidance on printing secrets, hardcoding, approval, and adapter support");
	}
	const rulesStatus = getCommandRulesStatus(cwd);
	if (rulesStatus === "invalid JSON") warnings.push("command-rules.json: invalid JSON");
	if (rulesStatus.startsWith("invalid schema")) warnings.push(`command-rules.json: ${rulesStatus}`);
	if (rulesStatus === "not configured") warnings.push("command-rules.json: missing");
	return { checked: files.length, warnings };
}

function lintWorkspace(cwd) {
	const { workspaceDir, indexPath } = getWorkspacePaths(cwd);
	if (!isDirectory(workspaceDir)) return { checked: 0, warnings: ["No workspace directory found."] };
	if (!isFile(indexPath)) return { checked: 0, warnings: ["No workspace index found."] };
	const index = safeReadJson(indexPath);
	if (!index) return { checked: 0, warnings: ["workspace/index.json: invalid JSON"] };
	const warnings = [];
	if (index.schemaVersion !== 1) warnings.push("workspace/index.json: schemaVersion should be 1");
	if (!index.workspaceRoot || !String(index.workspaceRoot).trim()) warnings.push("workspace/index.json: workspaceRoot is missing");
	if (!Array.isArray(index.repos)) warnings.push("workspace/index.json: repos array is missing");
	const repos = Array.isArray(index.repos) ? index.repos.map((repo) => normalizeRepoEntry(cwd, index, repo)) : [];
	const names = new Set();
	let defaultTargets = 0;
	for (const repo of repos) {
		if (!repo.name) warnings.push("workspace/index.json: repo entry missing name");
		if (!repo.path) warnings.push(`${repo.name || "repo"}: path is missing`);
		if (!repo.gitRoot) warnings.push(`${repo.name || "repo"}: gitRoot is missing`);
		if (!repo.profile) warnings.push(`${repo.name || "repo"}: profile is missing`);
		if (repo.name && names.has(repo.name)) warnings.push(`workspace/index.json: duplicate repo name "${repo.name}"`);
		if (repo.name) names.add(repo.name);
		if (repo.defaultTarget) defaultTargets += 1;
		if (repo.resolvedPath && !pathExists(repo.resolvedPath)) warnings.push(`${repo.name || repo.path}: path does not exist`);
		if (repo.resolvedGitRoot && !pathExists(repo.resolvedGitRoot)) warnings.push(`${repo.name || repo.gitRoot}: gitRoot does not exist`);
		if (repo.resolvedProfile && !pathExists(repo.resolvedProfile)) warnings.push(`${repo.name || repo.profile}: profile does not exist`);
	}
	if (defaultTargets > 1) warnings.push("workspace/index.json: more than one defaultTarget is set");
	return { checked: repos.length, warnings };
}

function lintLocks(cwd) {
	const warnings = [];
	let checked = 0;
	const sessionLock = readSessionLock(cwd);
	const targetLock = readTargetLock(cwd);
	if (sessionLock) {
		checked++;
		if (!sessionLock.owner) {
			warnings.push("session.lock.json: missing owner");
		}
		if (!sessionLock.expiresAt) {
			warnings.push("session.lock.json: missing expiresAt");
		} else if (isLockExpired(sessionLock)) {
			warnings.push("session.lock.json: lock appears expired");
		}
	}
	if (targetLock) {
		checked++;
		if (!targetLock.owner) {
			warnings.push("target.lock.json: missing owner");
		}
		if (!targetLock.targetRepo) {
			warnings.push("target.lock.json: missing targetRepo");
		}
		if (!targetLock.expiresAt) {
			warnings.push("target.lock.json: missing expiresAt");
		} else if (isLockExpired(targetLock)) {
			warnings.push("target.lock.json: lock appears expired");
		}
		const target = readTargetState(cwd);
		if (
			target && target.targetRepo && targetLock.targetRepo
			&& target.targetRepo !== targetLock.targetRepo
		) {
			warnings.push(
				"target.lock.json: lock target does not match"
				+ " selected target repo"
			);
		}
	}
	return { checked, warnings };
}

function lintTarget(cwd) {
	const { workspaceDir, targetPath } = getWorkspacePaths(cwd);
	if (!isDirectory(workspaceDir)) return { checked: 0, warnings: ["No workspace directory found."] };
	if (!isFile(targetPath)) return { checked: 0, warnings: ["No target state found."] };
	const target = safeReadJson(targetPath);
	if (!target) return { checked: 0, warnings: ["workspace/target.json: invalid JSON"] };
	const warnings = [];
	if (target.schemaVersion !== 1) warnings.push("workspace/target.json: schemaVersion should be 1");
	if (!target.targetRepo) warnings.push("workspace/target.json: targetRepo is missing");
	if (!target.targetGitRoot) warnings.push("workspace/target.json: targetGitRoot is missing");
	if (!target.writesAllowedUnder) warnings.push("workspace/target.json: writesAllowedUnder is missing");
	if (!target.activeProfile) warnings.push("workspace/target.json: activeProfile is missing");
	const targetGitRoot = target.targetGitRoot ? resolve(cwd, target.targetGitRoot) : "";
	const writesAllowedUnder = target.writesAllowedUnder ? resolve(cwd, target.writesAllowedUnder) : "";
	const activeProfile = target.activeProfile ? resolve(cwd, target.activeProfile) : "";
	if (targetGitRoot && !pathExists(targetGitRoot)) warnings.push("workspace/target.json: targetGitRoot does not exist");
	if (activeProfile && !pathExists(activeProfile)) warnings.push("workspace/target.json: activeProfile does not exist");
	if (targetGitRoot && !pathIsInside(targetGitRoot, cwd)) warnings.push("workspace/target.json: current cwd is outside targetGitRoot");
	if (targetGitRoot && writesAllowedUnder && !pathIsInside(targetGitRoot, writesAllowedUnder)) warnings.push("workspace/target.json: writesAllowedUnder is outside targetGitRoot");
	return { checked: 1, warnings };
}

function lintReports(cwd) {
	const reportDirs = [join(cwd, ".heli-harness", "state", "reports"), join(cwd, ".heli-harness", "state")];
	const requiredSections = [
		"Workspace root",
		"Target repo",
		"Target git root",
		"Writes allowed under",
		"Active profile",
		"Current cwd matched target",
		"Workspace index used",
		"Target selection method",
		"Task",
		"Files changed",
		"Commands run",
		"Validation",
		"Policies loaded",
		"Safety overlays loaded",
		"Profile taxonomy warnings",
		"Profile-based decisions",
		"Tech debt copied or avoided",
		"Safer alternative chosen",
		"Profile deviations",
		"Policy references used",
		"Policy decisions",
		"Approval evidence",
		"Safety events",
		"Out-of-target warnings",
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
	const policyFiles = getOverlayFiles(join(cwd, ".heli-harness", "policies"), [".md"]);
	for (const report of reports) {
		const label = report.split(/[\\/]/).pop();
		const text = normalizeText(safeReadText(report));
		pushMissingSectionWarnings(warnings, label, text, requiredSections);
		if (/complete|completed|done/i.test(text) && !/validation|test|check/i.test(text)) {
			warnings.push(`${label}: claims completion without validation evidence`);
		}
		if (/policy deviation|deviation/i.test(text) && !/justification|because|reason/i.test(text)) {
			warnings.push(`${label}: mentions policy deviation without justification`);
		}
		if (/exception/i.test(text) && !/approval|approved|ticket|issue|pr|justification/i.test(text)) {
			warnings.push(`${label}: mentions an exception without approval evidence or justification`);
		}
		if (/policy compliance|complies with policy|policy-compliant/i.test(text) && !sectionHasContent(text, "Policies loaded")) {
			warnings.push(`${label}: claims policy compliance without listing loaded policies`);
		}
		if (/(approved|approval received|user approved)/i.test(text) && /(publish|push|deploy|release|delete|destructive|secret)/i.test(text) && !sectionHasContent(text, "Approval evidence")) {
			warnings.push(`${label}: records risky approval without approval evidence`);
		}
		if (/(followed the profile|per profile|using the profile)/i.test(text) && !sectionHasContent(text, "Active profile")) {
			warnings.push(`${label}: says it followed the profile but no active profile is recorded`);
		}
		if (/(known tech debt|tech debt)/i.test(text) && /(copied|reused|matched|kept the same pattern)/i.test(text) && !/justification|because|reason/i.test(text)) {
			warnings.push(`${label}: copies a known tech-debt pattern without justification`);
		}
		if (/safer alternative/i.test(text) && !/because|reason|rationale/i.test(text)) {
			warnings.push(`${label}: mentions a safer alternative without rationale`);
		}
		if (/profile deviation/i.test(text) && !/because|reason|justification/i.test(text)) {
			warnings.push(`${label}: mentions a profile deviation without reason`);
		}
		if (policyFiles.length > 0 && sectionHasContent(text, "Policies loaded") && !sectionHasContent(text, "Policy references used")) {
			warnings.push(`${label}: policies were loaded but policy references used are not recorded`);
		}
		if (/(implemented|implementation|edited|changed|write workflow|mutating)/i.test(text) && !sectionHasContent(text, "Target repo")) {
			warnings.push(`${label}: implementation work is recorded without a target repo`);
		}
		if (sectionHasContent(text, "Files changed") && !sectionHasContent(text, "Target git root")) {
			warnings.push(`${label}: files changed are recorded without a target git root`);
		}
		if (/target deviation/i.test(text) && !/because|reason|justification/i.test(text)) {
			warnings.push(`${label}: mentions a target deviation without reason`);
		}
		if (/profile/i.test(text) && !sectionHasContent(text, "Active profile")) {
			warnings.push(`${label}: references a profile but no active profile is recorded`);
		}
		if (/(multi-repo|multiple repos|workspace index)/i.test(text) && !sectionHasContent(text, "Workspace index used")) {
			warnings.push(`${label}: describes multi-repo work without recording the workspace index used`);
		}
		if (/skip|skipped/i.test(text) && /validation|test|check/i.test(text) && !/because|reason|not available|not applicable/i.test(text)) {
			warnings.push(`${label}: mentions skipped validation without a reason`);
		}
		if (/(parallel|multi-agent|concurrent)/i.test(text) && !sectionHasContent(text, "Lock context")) {
			warnings.push(`${label}: mentions parallel/multi-agent work but no lock state recorded`);
		}
		if (/lock conflict/i.test(text) && !/resolution|resolved|because|reason/i.test(text)) {
			warnings.push(`${label}: mentions lock conflict without resolution`);
		}
		if (/(implemented|edited|changed|write workflow|mutating)/i.test(text) && /(multi-repo|multiple repos)/i.test(text) && !sectionHasContent(text, "Lock context")) {
			warnings.push(`${label}: mutating work in multi-repo workspace without lock context`);
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
		const policiesDir = join(harnessPath, "policies");
		const safetyDir = join(harnessPath, "safety");
		const workspacePaths = getWorkspacePaths(cwd);
		const workspaceIndex = readWorkspaceIndex(cwd);
		const workspaceRepos = getWorkspaceRepos(cwd);
		const targetState = readTargetState(cwd);
		const policyFiles = getOverlayFiles(policiesDir, [".md"]);
		const safetyFiles = getOverlayFiles(safetyDir, [".md", ".json"]);
		const commandRulesStatus = getCommandRulesStatus(cwd);
		const targetGitRoot = targetState && targetState.targetGitRoot ? resolve(cwd, targetState.targetGitRoot) : "";
		const targetProfile = targetState && targetState.activeProfile ? resolve(cwd, targetState.activeProfile) : "";
		notify(ctx, "Heli-Harness Status", "info");
		notify(ctx, `Version: ${getPackageVersion()}`, "info");
		notify(ctx, `Mode: ${harnessDetected ? "package + workspace" : "package only"}`, harnessDetected ? "success" : "warning");
		notify(ctx, `CWD: ${cwd}`, "info");
		notify(ctx, `Workspace harness: ${harnessDetected ? "detected" : "not installed"}`, harnessDetected ? "success" : "warning");
		notify(ctx, `Target repo: ${targetRepo}`, "info");
		notify(ctx, `Active profile: ${getActiveProfile(cwd, targetRepo)}`, "info");
		notify(ctx, `Active policies: ${getActivePolicies(cwd)}`, "info");
		notify(ctx, `Policy directory: ${isDirectory(policiesDir) ? "detected" : "missing"}`, isDirectory(policiesDir) ? "success" : "warning");
		notify(ctx, `Policy files: ${policyFiles.length > 0 ? policyFiles.join(", ") : "none"}`, policyFiles.length > 0 ? "info" : "warning");
		notify(ctx, `Safety directory: ${isDirectory(safetyDir) ? "detected" : "missing"}`, isDirectory(safetyDir) ? "success" : "warning");
		notify(ctx, `Safety files: ${safetyFiles.length > 0 ? safetyFiles.join(", ") : "none"}`, safetyFiles.length > 0 ? "info" : "warning");
		notify(ctx, `command-rules.json: ${commandRulesStatus}`, commandRulesStatus === "valid" ? "success" : commandRulesStatus === "invalid JSON" || commandRulesStatus.startsWith("invalid schema") ? "warning" : "info");
		notify(ctx, `Workspace index: ${isFile(workspacePaths.indexPath) ? "detected" : "not configured"}`, isFile(workspacePaths.indexPath) ? "success" : "warning");
		notify(ctx, `Known repos: ${workspaceIndex && Array.isArray(workspaceIndex.repos) ? workspaceRepos.length : 0}`, "info");
		notify(ctx, `Target repo: ${targetState && targetState.targetRepo ? targetState.targetRepo : "not selected"}`, targetState && targetState.targetRepo ? "success" : "warning");
		notify(ctx, `Target git root: ${targetState && targetState.targetGitRoot ? targetState.targetGitRoot : "not selected"}`, "info");
		notify(ctx, `Writes allowed under: ${targetState && targetState.writesAllowedUnder ? targetState.writesAllowedUnder : "not selected"}`, "info");
		notify(ctx, `Target active profile: ${targetState && targetState.activeProfile ? targetState.activeProfile : "not selected"}`, "info");
		notify(ctx, `Target profile exists: ${targetProfile ? (pathExists(targetProfile) ? "yes" : "no") : "not selected"}`, targetProfile ? (pathExists(targetProfile) ? "success" : "warning") : "warning");
		notify(ctx, `CWD inside target root: ${targetGitRoot ? (pathIsInside(targetGitRoot, cwd) ? "yes" : "no") : "not selected"}`, targetGitRoot ? (pathIsInside(targetGitRoot, cwd) ? "success" : "warning") : "warning");
		const sessionLock = readSessionLock(cwd);
		const targetLock = readTargetLock(cwd);
		notify(ctx, `Session lock: ${sessionLock ? (isLockExpired(sessionLock) ? "expired" : "active") : "not present"}`, sessionLock ? (isLockExpired(sessionLock) ? "warning" : "success") : "info");
		if (sessionLock) {
			notify(ctx, `Session lock owner: ${sessionLock.owner || "unknown"}`, "info");
			notify(ctx, `Session lock expires: ${sessionLock.expiresAt || "never"}`, "info");
		}
		notify(ctx, `Target lock: ${targetLock ? (isLockExpired(targetLock) ? "expired" : "active") : "not present"}`, targetLock ? (isLockExpired(targetLock) ? "warning" : "success") : "info");
		if (targetLock) {
			notify(ctx, `Target lock owner: ${targetLock.owner || "unknown"}`, "info");
			notify(ctx, `Target lock target: ${targetLock.targetRepo || "none"}`, "info");
		}
		notify(ctx, `Skill count: ${getSkillCount(cwd)}`, "info");
		notify(ctx, "Active hooks: session_start, before_agent_start, tool_call, input", "info");
		notify(ctx, `Recent hooks: session_start=${lastSessionStartAt}; before_agent_start=${lastBeforeAgentStartAt}; tool_call_guard=${lastToolGuardAt}; input_shortcut=${lastInputShortcutAt}`, "info");
			notify(ctx, `Probe state: prompt=${hookProbePromptPending ? "armed" : "inactive"}; guard=${hookProbeGuardPending ? "armed" : "inactive"}`, hookProbePromptPending || hookProbeGuardPending ? "warning" : "info");
		if (harnessDetected) {
			notify(ctx, `HARNESS.md: ${harnessMd}`, "info");
			if (policyFiles.length === 0) {
				notify(ctx, "No policy overlays found. Current releases support .heli-harness/policies/. Use templates to create team rules.", "info");
			}
			if (safetyFiles.length === 0) {
				notify(ctx, "No safety overlays found. Current releases support .heli-harness/safety/. Use templates to define command tiers and secret handling.", "info");
			}
			if (!isFile(workspacePaths.indexPath)) {
				notify(ctx, "Workspace index: not configured. Create .heli-harness/workspace/index.json to track repos.", "info");
			}
			if ((!targetState || !targetState.targetRepo) && workspaceRepos.length > 1) {
				notify(ctx, "Target repo: not selected. Use /heli-target list or /heli-target set <repo> before write workflows.", "warning");
			}
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
		if (action === "lint" || action === "policy" || action === "policies") {
			notifyLintResult(ctx, "Heli policy lint", lintPolicies(cwd));
			if (action !== "lint") return;
		}
		if (action === "lint" || action === "safety") {
			notifyLintResult(ctx, "Heli safety lint", lintSafety(cwd));
			if (action !== "lint") return;
		}
		if (action === "lint" || action === "workspace") {
			notifyLintResult(ctx, "Heli workspace lint", lintWorkspace(cwd));
			if (action !== "lint") return;
		}
		if (action === "lint" || action === "target") {
			notifyLintResult(ctx, "Heli target lint", lintTarget(cwd));
			if (action !== "lint") return;
		}
		if (action === "lint" || action === "lock" || action === "locks") {
			notifyLintResult(ctx, "Heli lock lint", lintLocks(cwd));
			if (action !== "lint") return;
		}
		if (action === "lint" || action === "report" || action === "reports") {
			notifyLintResult(ctx, "Heli report lint", lintReports(cwd));
			return;
		}
		return workflowHandler("heli-validate", "test validation")(_args, ctx);
	};

	const lockHandler = async (_args, ctx) => {
		const cwd = process.cwd();
		const actionText = normalizeCommandText(_args);
		const parts = actionText ? actionText.split(/\s+/) : [];
		const command = parts[0] ? parts[0].toLowerCase() : "status";
		if (command === "status" || command === "show") {
			const sessionLock = readSessionLock(cwd);
			const targetLock = readTargetLock(cwd);
			notify(ctx, "Heli Lock Status", "info");
			notify(ctx, `Session lock: ${sessionLock ? (isLockExpired(sessionLock) ? "expired" : "active") : "not present"}`, sessionLock ? (isLockExpired(sessionLock) ? "warning" : "success") : "info");
			if (sessionLock) {
				notify(ctx, `  Owner: ${sessionLock.owner || "unknown"}`, "info");
				notify(ctx, `  Agent: ${sessionLock.agent || "unknown"}`, "info");
				notify(ctx, `  Target: ${sessionLock.targetRepo || "none"}`, "info");
				notify(ctx, `  Expires: ${sessionLock.expiresAt || "never"}`, "info");
			}
			notify(ctx, `Target lock: ${targetLock ? (isLockExpired(targetLock) ? "expired" : "active") : "not present"}`, targetLock ? (isLockExpired(targetLock) ? "warning" : "success") : "info");
			if (targetLock) {
				notify(ctx, `  Owner: ${targetLock.owner || "unknown"}`, "info");
				notify(ctx, `  Agent: ${targetLock.agent || "unknown"}`, "info");
				notify(ctx, `  Target: ${targetLock.targetRepo || "none"}`, "info");
				notify(ctx, `  Expires: ${targetLock.expiresAt || "never"}`, "info");
			}
			notify(ctx, "Locks are advisory. Copy .example.json templates to create lock files.", "info");
			return;
		}
		if (command === "help") {
			notify(ctx, "Heli Lock — Advisory Lock Management", "info");
			notify(ctx, "Locks are lightweight advisory files to signal intent.", "info");
			notify(ctx, "Copy session.lock.example.json or target.lock.example.json to create a lock.", "info");
			notify(ctx, "/heli-lock status — show current lock state", "info");
			notify(ctx, "/heli-lock help — show this message", "info");
			return;
		}
		notify(ctx, "Usage: /heli-lock status | /heli-lock help", "warning");
	};

	const targetHandler = async (_args, ctx) => {
		const cwd = process.cwd();
		const actionText = normalizeCommandText(_args);
		const parts = actionText ? actionText.split(/\s+/) : [];
		const command = parts[0] ? parts[0].toLowerCase() : "show";
		const selector = parts.slice(1).join(" ").trim();
		const { indexPath, targetPath } = getWorkspacePaths(cwd);
		const index = readWorkspaceIndex(cwd);
		const repos = getWorkspaceRepos(cwd);
		const target = readTargetState(cwd);

		if (!actionText || command === "show") {
			notify(ctx, "Heli target status", "info");
			notify(ctx, `Workspace index: ${isFile(indexPath) ? "detected" : "not configured"}`, isFile(indexPath) ? "success" : "warning");
			notify(ctx, `Target repo: ${target && target.targetRepo ? target.targetRepo : "not selected"}`, target && target.targetRepo ? "success" : "warning");
			notify(ctx, `Target git root: ${target && target.targetGitRoot ? target.targetGitRoot : "not selected"}`, "info");
			notify(ctx, `Writes allowed under: ${target && target.writesAllowedUnder ? target.writesAllowedUnder : "not selected"}`, "info");
			notify(ctx, `Active profile: ${target && target.activeProfile ? target.activeProfile : "not selected"}`, "info");
			notify(ctx, "Usage: /heli-target list | /heli-target show | /heli-target set <repo> | /heli-target clear", "info");
			return;
		}

		if (command === "list") {
			if (!index || !Array.isArray(index.repos)) {
				notify(ctx, "Workspace index is not configured", "warning");
				notify(ctx, "Create .heli-harness/workspace/index.json to track repos", "info");
				return;
			}
			notify(ctx, `Known repos: ${repos.length}`, "info");
			for (const repo of repos) {
				notify(ctx, `${repo.name || "(unnamed)"} -> path=${repo.path || "missing"}; gitRoot=${repo.gitRoot || "missing"}; profile=${repo.profile || "missing"}${repo.defaultTarget ? "; default" : ""}`, "info");
			}
			return;
		}

		if (command === "set") {
			if (!selector) {
				notify(ctx, "Usage: /heli-target set <repo-name-or-path>", "warning");
				return;
			}
			const repo = findWorkspaceRepo(cwd, selector);
			if (!repo) {
				notify(ctx, `No workspace repo matched "${selector}"`, "warning");
				return;
			}
			const nextTarget = {
				schemaVersion: 1,
				targetRepo: repo.name,
				targetGitRoot: repo.gitRoot || repo.path,
				writesAllowedUnder: repo.gitRoot || repo.path,
				activeProfile: repo.profile || "",
				selectedAt: new Date().toISOString(),
				selectedBy: "heli-target",
				reason: selector,
			};
			if (!safeWriteJson(targetPath, nextTarget)) {
				notify(ctx, "Failed to write workspace/target.json", "error");
				return;
			}
			notify(ctx, `Target repo set: ${repo.name}`, "success");
			notify(ctx, `Target git root: ${nextTarget.targetGitRoot}`, "info");
			return;
		}

		if (command === "clear") {
			const clearedTarget = {
				schemaVersion: 1,
				targetRepo: "",
				targetGitRoot: "",
				writesAllowedUnder: "",
				activeProfile: "",
				selectedAt: new Date().toISOString(),
				selectedBy: "heli-target",
				reason: "cleared",
			};
			if (!safeWriteJson(targetPath, clearedTarget)) {
				notify(ctx, "Failed to clear workspace/target.json", "error");
				return;
			}
			notify(ctx, "Target repo cleared", "info");
			return;
		}

		notify(ctx, "Usage: /heli-target list | /heli-target show | /heli-target set <repo> | /heli-target clear", "warning");
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
		const cwd = process.cwd();
		const heliInstructions = `
Heli-Harness workspace detected.

Before non-trivial work:
- Read .heli-harness/HARNESS.md.
- Read .heli-harness/workspace/index.json and target.json when present.
- Identify the target repo.
- Read .heli-harness/profiles/<repo>.md if present.
- Preserve dirty work.
- Update .heli-harness/state/current-task.md for meaningful tasks.
- Record durable decisions in .heli-harness/state/decisions.md when appropriate.
- Classify commands before running them.
- Do not run mutating, API-credit, release, publish, push, or destructive commands without explicit user approval.
- Prefer safe audit-only and non-mutating checks first.`;
		const taskText = safeReadText(join(cwd, ".heli-harness", "state", "current-task.md")).trim();
		const carriedOverTask = taskText
			? `\n\nCarried-over task state from .heli-harness/state/current-task.md:\n${taskText}\n\nAcknowledge this before your first edit this session: confirm with the user whether to resume, abandon, or reset it. If it shows 2+ failed attempts on an incomplete task, the tool_call guard will block file writes until you update current-task.md to resolve it.`
			: "";
		const recentDecisions = lastDecisionSections(safeReadText(join(cwd, ".heli-harness", "state", "decisions.md")));
		const decisionsContext = recentDecisions
			? `\n\nRecent durable decisions from .heli-harness/state/decisions.md:\n${recentDecisions}`
			: "";
		const probeInstructions = hookProbePromptPending
			? `

HELI_HOOK_PROBE_ACTIVE
For this one test turn only, start your next response with:
HELI_HOOK_OK`
			: "";
		hookProbePromptPending = false;
		return { systemPrompt: `${existingPrompt}\n\n${heliInstructions}${carriedOverTask}${decisionsContext}${probeInstructions}` };
	});

	pi.on("tool_call", async (event, ctx) => {
		const toolName = event && event.toolName;
		const input = event && event.input ? event.input : {};
		const cwd = process.cwd();
		const workspaceRepos = getWorkspaceRepos(cwd);
		const targetState = readTargetState(cwd);
		const hasMultiRepoIndex = workspaceRepos.length > 1;
		const hasTargetSelection = !!(targetState && targetState.targetRepo);
		const targetContext = hasTargetSelection
			? `Target repo: ${targetState.targetRepo}`
			: hasMultiRepoIndex
				? "No target repo selected in multi-repo workspace"
				: "No target context";

		if (input.command) {
			const command = String(input.command);
			const commandRules = loadCommandGuardRules(cwd);
			if (commandRules.warnings.length > 0) {
				for (const warning of commandRules.warnings) notify(ctx, `Command rules warning: ${warning}`, "warning");
			}
			const redirectionPath = findShellRedirectionWrite(command);
			if (redirectionPath && hasTargetSelection && targetState.writesAllowedUnder) {
				const allowedRoot = resolve(cwd, targetState.writesAllowedUnder);
				const resolvedPath = resolve(cwd, redirectionPath);
				if (!pathIsInside(allowedRoot, resolvedPath)) {
					lastToolGuardAt = new Date().toISOString();
					return { block: true, reason: `Blocked: shell redirection writes outside writesAllowedUnder for ${targetState.targetRepo}` };
				}
			}
			if (isSensitiveReadCommand(command)) {
				const reason = "sensitive file read detected";
				lastToolGuardAt = new Date().toISOString();
				if (hookProbeGuardPending) {
					hookProbeGuardPending = false;
					return { block: true, reason: `HELI_GUARD_OK: intercepted ${reason}` };
				}
				return confirmDangerous(ctx, "Dangerous command detected", `${reason}\n${targetContext}\n\nCommand: ${command}\n\nAllow?`, `${reason}. ${targetContext}`);
			}
			for (const variant of commandVariants(command)) {
				for (const { pattern, reason } of commandRules.rules) {
					if (!pattern.test(variant)) continue;
					lastToolGuardAt = new Date().toISOString();
					if (hookProbeGuardPending) {
						hookProbeGuardPending = false;
						return { block: true, reason: `HELI_GUARD_OK: intercepted ${reason}` };
					}
					return await confirmDangerous(ctx, "Dangerous command detected", `${reason}\n${targetContext}\n\nCommand: ${command}\n\nAllow?`, `${reason}. ${targetContext}`);
				}
			}
		}

		const writePaths = FILE_WRITE_TOOL_NAMES.has(String(toolName || "")) ? getFileWritePaths(input) : [];
		for (const path of writePaths) {
			const resolvedPath = resolve(cwd, path);
			const targetStatePath = resolve(getWorkspacePaths(cwd).targetPath);
			if (hasMultiRepoIndex && !hasTargetSelection && resolvedPath !== targetStatePath) {
				lastToolGuardAt = new Date().toISOString();
				return { block: true, reason: "Blocked: target repo not selected in multi-repo workspace" };
			}
			if (hasTargetSelection && targetState.writesAllowedUnder) {
				const allowedRoot = resolve(cwd, targetState.writesAllowedUnder);
				if (!pathIsInside(allowedRoot, resolvedPath) && resolvedPath !== targetStatePath) {
					lastToolGuardAt = new Date().toISOString();
					return { block: true, reason: `Blocked: write path is outside writesAllowedUnder for ${targetState.targetRepo}` };
				}
			}
			if (isSuspiciousHarnessRuntimePath(resolvedPath)) {
				const reason = "Suspicious harness runtime folder detected";
				lastToolGuardAt = new Date().toISOString();
				if (hookProbeGuardPending) {
					hookProbeGuardPending = false;
					return { block: true, reason: `HELI_GUARD_OK: intercepted ${reason}` };
				}
				return confirmDangerous(ctx, "Dangerous file operation", `${reason}\n\nPath: ${path}\n\nAllow?`, reason);
			}

			const sensitivePathReason = getSensitivePathReason(path);
			if (sensitivePathReason) {
				lastToolGuardAt = new Date().toISOString();
				if (hookProbeGuardPending) {
					hookProbeGuardPending = false;
					return { block: true, reason: `HELI_GUARD_OK: intercepted ${sensitivePathReason}` };
				}
				return confirmDangerous(ctx, "Dangerous file operation", `${sensitivePathReason}\n\nPath: ${path}\n\nAllow?`, sensitivePathReason);
			}
			if (hasSecretLikeContent(input)) {
				const reason = "secret-like content detected";
				lastToolGuardAt = new Date().toISOString();
				if (hookProbeGuardPending) {
					hookProbeGuardPending = false;
					return { block: true, reason: `HELI_GUARD_OK: intercepted ${reason}` };
				}
				return confirmDangerous(ctx, "Dangerous file operation", `${reason}\n\nPath: ${path}\n\nAllow?`, reason);
			}
		}

		if (writePaths.length) {
			// Only current-task.md is exempted here (unlike the Claude/Codex plugin hooks, which also
			// exempt target.json): this gate only checks the stuck-task condition, not target-mismatch —
			// Pi already enforces target boundaries separately via writesAllowedUnder.
			const taskStatePath = resolve(cwd, ".heli-harness", "state", "current-task.md");
			const isTaskStateWrite = writePaths.some((path) => resolve(cwd, path) === taskStatePath);
			if (!isTaskStateWrite) {
				const taskText = safeReadText(join(cwd, ".heli-harness", "state", "current-task.md"));
				const failedAttempts = parseInt(taskField(taskText, "Failed attempts count") || "0", 10) || 0;
				const status = taskField(taskText, "Current status");
				if (failedAttempts >= 2 && status.toLowerCase() !== "complete") {
					lastToolGuardAt = new Date().toISOString();
					return { block: true, reason: `Blocked: current-task.md shows ${failedAttempts} failed attempts and status "${status || "(empty)"}" on an incomplete task — update .heli-harness/state/current-task.md to resolve it before continuing.` };
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
	pi.registerCommand("heli-validate", { description: "Run test-validation workflow safely; use lint/profile/policy/safety/workspace/target/report for local checks", handler: validateHandler });
	pi.registerCommand("heli-impact", { description: "Impact analysis for planned changes", handler: workflowHandler("heli-impact", "impact analysis") });
	pi.registerCommand("heli-hooks", { description: "Show Heli-Harness auto hooks status", handler: hooksStatusHandler });
	pi.registerCommand("heli-target", { description: "Show or set the active target repo for multi-repo workspaces", handler: targetHandler });
	pi.registerCommand("heli-lock", { description: "Show advisory lock state for multi-agent coordination", handler: lockHandler });
}
