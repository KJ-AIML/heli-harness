import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { installCleanHarness } from "./seed-workspace.mjs";

const AGENTS_SNIPPET = "Read .heli-harness/adapters/codex/AGENTS.md first.\n";
const CLAUDE_SNIPPET = "Read .heli-harness/adapters/claude/CLAUDE.md first.\n";

/**
 * Install Heli-Harness into a parent workspace.
 * Copies distribution assets only, then seeds clean operational state.
 * Never copies package checkout dogfood (tasks, sessions, live current-task, YOLO, target).
 */
export function install(sourceHarnessDir, parentDir) {
	const parentFull = resolve(parentDir);
	if (!existsSync(parentFull)) {
		throw new Error(`Parent directory does not exist: ${parentFull}`);
	}
	const target = join(parentFull, ".heli-harness");
	if (resolve(sourceHarnessDir) === resolve(target)) {
		throw new Error(`Source and target are the same directory: ${target} — nothing to install`);
	}
	if (!existsSync(sourceHarnessDir)) {
		throw new Error(`Source harness not found: ${sourceHarnessDir}`);
	}

	installCleanHarness(sourceHarnessDir, parentFull);

	const agentsPath = join(parentFull, "AGENTS.md");
	const claudePath = join(parentFull, "CLAUDE.md");
	const messages = [];
	if (existsSync(agentsPath)) {
		messages.push(`AGENTS.md already exists at ${agentsPath}\nAppend manually if desired:\n${AGENTS_SNIPPET}`);
	} else {
		writeFileSync(agentsPath, AGENTS_SNIPPET);
	}
	if (existsSync(claudePath)) {
		messages.push(`CLAUDE.md already exists at ${claudePath}\nAppend manually if desired:\n${CLAUDE_SNIPPET}`);
	} else {
		writeFileSync(claudePath, CLAUDE_SNIPPET);
	}

	for (const check of ["HARNESS.md", "manifest.json", "skills", "adapters", "state/current-task.md", "workspace/target.json"]) {
		if (!existsSync(join(target, check))) {
			throw new Error(`Install validation failed: missing ${join(target, check)}`);
		}
	}

	return { target, parentFull, messages };
}

export function runInstall(packageRoot, args) {
	const [parentArg] = args;
	const parentDir = parentArg || process.cwd();
	const sourceHarnessDir = join(packageRoot, ".heli-harness");
	if (!existsSync(sourceHarnessDir)) {
		throw new Error(`Source harness not found: ${sourceHarnessDir}`);
	}
	const result = install(sourceHarnessDir, parentDir);
	for (const message of result.messages) console.log(message);
	console.log(`
Heli workspace governance installed:
  ${result.target}

Clean install seed:
  - idle current-task (no selected target)
  - strict YOLO (no yolo.json)
  - empty concurrent stores (tasks/sessions/bindings/locks created on demand)
  - package dogfood state is never copied

Host-native skills require host plugin activation (workspace install alone does not register them):
  - Codex (recommended, Git marketplace — upgradeable):
            codex plugin marketplace add KJ-AIML/heli-harness
            codex plugin add heli-harness@heli-harness
            codex plugin marketplace upgrade heli-harness
  - Codex (workspace-local dogfood after this install; not upgradeable):
            codex plugin marketplace add ./.heli-harness/adapters/codex-plugin
            codex plugin add heli-harness@heli-harness
  - Claude: claude plugin install .heli-harness/adapters/claude-plugin
  - Grok:   grok plugin install .heli-harness/adapters/grok-plugin --trust
            (hooks: node .heli-harness/adapters/grok-plugin/install-user-hooks.mjs)

See INSTALL.md and docs/INSTALL_MATRIX.md for other hosts. File presence of skills/ is not live activation.

Next steps:
  1. Add repo profiles under ${result.target}/profiles
  2. Activate the host plugin for native skills + hooks (commands above)
  3. Start agents from ${result.parentFull}
  4. Use this first-run prompt:

Start from this parent workspace. Read HARNESS.md, identify the target repo, read its profile if present, then inspect repo-local docs. Update state/current-task.md before non-trivial edits. Task: <describe task>.`);
}
