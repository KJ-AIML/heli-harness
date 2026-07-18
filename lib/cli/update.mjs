import { existsSync, mkdtempSync, cpSync, rmSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { DISTRIBUTION_ENTRIES, IDLE_CURRENT_TASK } from "./seed-workspace.mjs";

const PRESERVE_OVERLAY_DIRS = ["profiles", "workspace", "policies", "safety"];
/** Concurrent-session local state — always preserved unless --reset-state. */
const CONCURRENT_STATE_DIRS = ["tasks", "sessions", "bindings", "locks"];
const STATE_DIR = "state";

/**
 * Reset operational runtime only (not workspace/target overlays).
 * Never copies package dogfood — writes idle seed explicitly.
 */
function reseedOperationalRuntime(targetHarnessDir) {
	for (const name of [...CONCURRENT_STATE_DIRS, STATE_DIR]) {
		const p = join(targetHarnessDir, name);
		if (existsSync(p)) rmSync(p, { recursive: true, force: true });
	}
	const stateDir = join(targetHarnessDir, STATE_DIR);
	mkdirSync(join(stateDir, "reports"), { recursive: true });
	mkdirSync(join(stateDir, "runs"), { recursive: true });
	writeFileSync(join(stateDir, "current-task.md"), IDLE_CURRENT_TASK, "utf8");
	writeFileSync(join(stateDir, "decisions.md"), "# Decisions\n\n", "utf8");
	writeFileSync(
		join(stateDir, "README.md"),
		"# Harness State\n\nIdle seed after `heli update --reset-state`.\n",
		"utf8",
	);
}

/**
 * Update shipped distribution assets without importing package operational state.
 *
 * Install constructs clean seeds. Update preserves user operational state and
 * local overlays; it never copies live tasks/sessions/leases/targets from the
 * package checkout into the destination.
 */
export function update(sourceHarnessDir, parentDir, { resetState = false } = {}) {
	const parentFull = resolve(parentDir);
	const target = join(parentFull, ".heli-harness");
	if (!existsSync(target)) {
		throw new Error(`Target harness does not exist: ${target}. Run install first.`);
	}
	if (resolve(sourceHarnessDir) === resolve(target)) {
		throw new Error(`Source and target are the same directory: ${target} — nothing to update`);
	}

	const preserveDirs = resetState
		? [...PRESERVE_OVERLAY_DIRS]
		: [...PRESERVE_OVERLAY_DIRS, STATE_DIR, ...CONCURRENT_STATE_DIRS];

	const tempPreserve = mkdtempSync(join(tmpdir(), "heli-update-preserve-"));

	for (const dir of preserveDirs) {
		const from = join(target, dir);
		if (existsSync(from)) {
			cpSync(from, join(tempPreserve, dir), { recursive: true, force: true });
		}
	}

	// Replace distribution assets only — never full recursive source copy.
	// This prevents package dogfood (sessions/tasks/live state) from landing
	// in the installed workspace when those dirs were absent before update.
	for (const name of DISTRIBUTION_ENTRIES) {
		if (preserveDirs.includes(name)) {
			// Overlays (profiles/workspace/policies/safety) stay as preserved user content.
			continue;
		}
		const from = join(sourceHarnessDir, name);
		const to = join(target, name);
		if (existsSync(to)) {
			rmSync(to, { recursive: true, force: true });
		}
		if (!existsSync(from)) continue;
		const st = statSync(from);
		if (st.isDirectory()) {
			cpSync(from, to, { recursive: true, force: true });
		} else {
			mkdirSync(dirname(to), { recursive: true });
			cpSync(from, to, { force: true });
		}
	}

	// Restore preserved user overlays / operational state
	for (const dir of preserveDirs) {
		const preserved = join(tempPreserve, dir);
		if (existsSync(preserved)) {
			const targetDir = join(target, dir);
			if (existsSync(targetDir)) {
				rmSync(targetDir, { recursive: true, force: true });
			}
			cpSync(preserved, targetDir, { recursive: true, force: true });
		}
	}
	rmSync(tempPreserve, { recursive: true, force: true });

	if (resetState) {
		// Explicit reset of tasks/sessions/leases/state only; workspace/target preserved.
		reseedOperationalRuntime(target);
	}

	return { target, parentFull, preserveDirs };
}

export function runUpdate(packageRoot, args) {
	const resetState = args.includes("--reset-state");
	const parentArg = args.find((arg) => arg !== "--reset-state");
	const parentDir = parentArg || process.cwd();
	const sourceHarnessDir = join(packageRoot, ".heli-harness");
	if (!existsSync(sourceHarnessDir)) {
		throw new Error(`Source harness not found: ${sourceHarnessDir}`);
	}
	const result = update(sourceHarnessDir, parentDir, { resetState });
	console.log(`Updated Heli-Harness at ${result.target}`);
	if (!resetState) {
		console.log(
			"Preserved local overlays: profiles/, workspace/, policies/, safety/, state/, tasks/, sessions/, bindings/, locks/.",
		);
		console.log("Use --reset-state to reseed clean operational state (idle task, no target, strict YOLO).");
	} else {
		console.log("Preserved local overlays: profiles/, workspace/, policies/, safety/.");
		console.log(
			"state/ and concurrent task/session/bindings/locks were reseeded to a clean install seed (--reset-state).",
		);
	}
	console.log("AGENTS.md and CLAUDE.md were not modified.");
	console.log("Package operational dogfood is never copied during update.");
	console.log(
		"Workspace mode is preserved: heli update does NOT flip legacy → concurrent. Parallel agents on shared state/current-task.md still race until you migrate.",
	);
	console.log(`
Concurrent upgrade (when two+ agents may write in this workspace):
  heli task migrate-legacy --id <task-id> ${parentDir}
  # or: heli task create <id> --work-item <key> --repo <name>
  heli task claim <id> --mode write
  # export HELI_SESSION_ID from claim/start output
  See skill concurrent-upgrade and .heli-harness/state/README.md

Host plugin refresh (workspace update does not upgrade host marketplaces/plugins):
  - Codex (Git marketplace, recommended):
            codex plugin marketplace upgrade heli-harness
  - Codex (still on local marketplace — switch once for upgrade support):
            codex plugin remove heli-harness@heli-harness
            codex plugin marketplace remove heli-harness
            codex plugin marketplace add KJ-AIML/heli-harness
            codex plugin add heli-harness@heli-harness
            codex plugin marketplace upgrade heli-harness
  - Codex (workspace-local dogfood only; re-add after this update):
            codex plugin marketplace add ./.heli-harness/adapters/codex-plugin
            codex plugin add heli-harness@heli-harness
  - Claude: claude plugin install .heli-harness/adapters/claude-plugin
  - Grok:   node .heli-harness/adapters/grok-plugin/install-user-hooks.mjs
            (optional skills: grok plugin install .heli-harness/adapters/grok-plugin --trust)

See INSTALL.md for host-specific details.`);
}
