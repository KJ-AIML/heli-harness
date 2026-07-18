/**
 * Canonical fresh-workspace operational seed for Heli installs.
 *
 * Distribution assets (HARNESS, adapters, skills, templates, …) may be copied
 * from the package. Operational runtime state must NEVER be copied from the
 * package checkout's live working tree — it is always constructed here.
 */
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
	cpSync,
	readdirSync,
	statSync,
} from "node:fs";
import { join, dirname } from "node:path";

/** Top-level entries under .heli-harness that are distribution assets. */
export const DISTRIBUTION_ENTRIES = [
	"HARNESS.md",
	"INSTALL.md",
	"README.md",
	"manifest.json",
	"adapters",
	"skills",
	"policies",
	"safety",
	"templates",
	"hooks",
	"profiles",
];

/**
 * Runtime / operational paths that must never be treated as install seeds
 * when present in a dogfooded source checkout.
 */
export const OPERATIONAL_ENTRIES = [
	"state",
	"sessions",
	"tasks",
	"bindings",
	"locks",
	"workspace",
];

export const IDLE_CURRENT_TASK = `# Current Task

Target repo:

Task: (none — idle)

Mode: idle

Risk tier: S0

Plan: n/a

Step count: 0

Files expected to change:
- none

Dirty files observed:
- none

Planned verification:
- n/a

Relevant skills consulted:
- none

Current status: complete

Failed attempts count: 0

Command friction count: 0

Next smallest action: await next user request

## Resume card

\`\`\`text
Last verified: n/a
Gate: READY
Blocker: none
Smoke/entry: n/a
Do not: n/a
Next: await next user request
\`\`\`
`;

export const FRESH_TARGET = {
	schemaVersion: 1,
	targetRepo: "",
	targetGitRoot: "",
	writesAllowedUnder: "",
	activeProfile: "",
	selectedAt: "",
	selectedBy: "",
	reason: "fresh install — no target selected",
};

export const FRESH_INDEX = {
	schemaVersion: 1,
	workspaceRoot: ".",
	repos: [],
};

export const FRESH_SCHEMA = {
	schemaVersion: 1,
	mode: "legacy",
	updatedAt: null,
	note: "fresh install seed; concurrent mode begins when tasks are created",
};

function ensureDir(path) {
	mkdirSync(path, { recursive: true });
}

function writeJson(path, value) {
	ensureDir(dirname(path));
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readTemplate(sourceHarnessDir, name, fallback) {
	const p = join(sourceHarnessDir, "templates", name);
	if (existsSync(p)) {
		try {
			return readFileSync(p, "utf8");
		} catch {
			/* fall through */
		}
	}
	return fallback;
}

/**
 * Copy only distribution assets from source harness into target harness dir.
 * Skips operational runtime directories even if present in source.
 */
export function copyDistributionAssets(sourceHarnessDir, targetHarnessDir) {
	ensureDir(targetHarnessDir);
	for (const name of DISTRIBUTION_ENTRIES) {
		const from = join(sourceHarnessDir, name);
		if (!existsSync(from)) continue;
		const to = join(targetHarnessDir, name);
		const st = statSync(from);
		if (st.isDirectory()) {
			cpSync(from, to, { recursive: true, force: true });
		} else {
			ensureDir(dirname(to));
			writeFileSync(to, readFileSync(from));
		}
	}
}

/**
 * Remove any operational runtime trees under an installed harness and write
 * deterministic fresh seeds. Safe to call after a mistaken full recursive copy.
 */
export function seedFreshOperationalState(targetHarnessDir, sourceHarnessDir = null) {
	const root = targetHarnessDir;

	// Purge operational runtime (never leave source dogfood behind).
	for (const name of OPERATIONAL_ENTRIES) {
		const p = join(root, name);
		if (existsSync(p)) {
			rmSync(p, { recursive: true, force: true });
		}
	}
	// Also purge accidental session/task roots if nested differently
	for (const extra of ["sessions", "tasks", "bindings", "locks"]) {
		const p = join(root, extra);
		if (existsSync(p)) rmSync(p, { recursive: true, force: true });
	}

	const stateDir = join(root, "state");
	const reportsDir = join(stateDir, "reports");
	const runsDir = join(stateDir, "runs");
	const workspaceDir = join(root, "workspace");
	ensureDir(stateDir);
	ensureDir(reportsDir);
	ensureDir(runsDir);
	ensureDir(workspaceDir);
	// empty concurrent stores (created on demand, but presence of empty dirs is OK)
	// Do not create sessions/tasks/bindings/locks — absence is clean.

	const src = sourceHarnessDir || root;
	// Explicit idle seed — never copy live package current-task/plan/yolo.
	writeFileSync(join(stateDir, "current-task.md"), IDLE_CURRENT_TASK, "utf8");
	writeFileSync(join(stateDir, "decisions.md"), "# Decisions\n\n", "utf8");
	// No plan.md — absent is the documented clean default
	// No yolo.json — strict default
	const packagedStateReadme = join(src, "state", "README.md");
	if (existsSync(packagedStateReadme)) {
		writeFileSync(join(stateDir, "README.md"), readFileSync(packagedStateReadme, "utf8"));
	} else {
		writeFileSync(
			join(stateDir, "README.md"),
			"# Harness State\n\nIdle install seed. Concurrent task/session state is created on demand.\n",
			"utf8",
		);
	}

	// Example lock templates only (not live locks)
	const sessionEx = join(src, "state", "session.lock.example.json");
	if (existsSync(sessionEx)) {
		writeFileSync(join(stateDir, "session.lock.example.json"), readFileSync(sessionEx));
	}
	const targetEx = join(src, "workspace", "target.lock.example.json");
	if (existsSync(targetEx)) {
		writeFileSync(join(workspaceDir, "target.lock.example.json"), readFileSync(targetEx));
	}
	const wsReadme = join(src, "workspace", "README.md");
	if (existsSync(wsReadme)) {
		writeFileSync(join(workspaceDir, "README.md"), readFileSync(wsReadme));
	}

	writeJson(join(workspaceDir, "target.json"), FRESH_TARGET);
	writeJson(join(workspaceDir, "index.json"), FRESH_INDEX);
	const schema = { ...FRESH_SCHEMA, updatedAt: new Date().toISOString() };
	writeJson(join(workspaceDir, "schema.json"), schema);

	return {
		currentTaskPath: join(stateDir, "current-task.md"),
		targetPath: join(workspaceDir, "target.json"),
		indexPath: join(workspaceDir, "index.json"),
		schemaPath: join(workspaceDir, "schema.json"),
	};
}

/**
 * Full clean install of harness into parentDir/.heli-harness
 */
export function installCleanHarness(sourceHarnessDir, parentDir) {
	const target = join(parentDir, ".heli-harness");
	if (existsSync(target)) {
		// Replace distribution; always reseed operational
		// Remove entire target first for determinism of distribution tree
		rmSync(target, { recursive: true, force: true });
	}
	copyDistributionAssets(sourceHarnessDir, target);
	seedFreshOperationalState(target, sourceHarnessDir);
	return target;
}

/**
 * Assert installed harness contains none of the pollution markers (test helper).
 */
export function assertCleanInstall(targetHarnessDir, { forbiddenSubstrings = [] } = {}) {
	const problems = [];
	for (const name of ["sessions", "tasks", "bindings", "locks"]) {
		const p = join(targetHarnessDir, name);
		if (existsSync(p) && readdirSync(p).length > 0) {
			problems.push(`non-empty operational dir: ${name}`);
		}
	}
	if (existsSync(join(targetHarnessDir, "state", "yolo.json"))) {
		problems.push("yolo.json present (should be strict/absent)");
	}
	if (existsSync(join(targetHarnessDir, "state", "plan.md"))) {
		problems.push("plan.md present (should be absent on fresh install)");
	}
	const task = readFileSync(join(targetHarnessDir, "state", "current-task.md"), "utf8");
	if (!/idle|none — idle|Current status: complete/i.test(task)) {
		problems.push("current-task.md is not idle seed");
	}
	const target = JSON.parse(readFileSync(join(targetHarnessDir, "workspace", "target.json"), "utf8"));
	if (target.targetRepo) {
		problems.push(`target selected: ${target.targetRepo}`);
	}
	for (const marker of forbiddenSubstrings) {
		const hay = [
			task,
			JSON.stringify(target),
			existsSync(join(targetHarnessDir, "state", "decisions.md"))
				? readFileSync(join(targetHarnessDir, "state", "decisions.md"), "utf8")
				: "",
		].join("\n");
		if (hay.includes(marker)) {
			problems.push(`forbidden marker present: ${marker}`);
		}
	}
	return problems;
}
