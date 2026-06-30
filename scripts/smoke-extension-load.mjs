import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const tempDir = mkdtempSync(join(tmpdir(), "heli-extension-"));
mkdirSync(join(tempDir, "extensions"), { recursive: true });
mkdirSync(join(tempDir, ".heli-harness"), { recursive: true });
writeFileSync(join(tempDir, ".heli-harness", "HARNESS.md"), "# Harness\n");
writeFileSync(join(tempDir, "package.json"), JSON.stringify({ version: "0.5.9" }));
mkdirSync(join(tempDir, ".heli-harness", "profiles"), { recursive: true });
writeFileSync(join(tempDir, ".heli-harness", "profiles", "demo.md"), `# Demo

Target repo mapping:

- Workspace index entry: demo
- Repo path: .
- Git root: .

## Policy references

- .heli-harness/policies/engineering.md

## Observed stack

- Fact: JavaScript package
- Evidence path: \`package.json\`

## Existing patterns

- Observed pattern: local status and lint helpers live in one extension file
- Classification:
  - fact only
- Evidence path: \`extensions/pi-extension.js\`
- Notes: keep shared logic small and inspectable

## Recommended conventions

- Recommended convention: keep harness behavior local and inspectable
- Why new work should follow it: matches the existing adapter shape
- Evidence path: \`extensions/pi-extension.js\`

## Known tech debt

- Debt: none recorded
- Why it is debt: not applicable
- Evidence path: \`README.md\`

## Forbidden patterns

- Forbidden pattern: introducing secret-bearing fixtures into the repo
- Policy backing or rationale: security policy forbids printing or hardcoding secrets
- Evidence path: \`.heli-harness/policies/security.md\`

## Safer alternatives

- Safer alternative: keep secret examples redacted and keep adapter logic local
- Replaces: copying weak token handling from application code
- Why it is safer: avoids treating risky existing patterns as recommendations
- Evidence path: \`.heli-harness/templates/repo-profile.md\`

## Command tiers

Safe:
- Command: \`node --check extensions/pi-extension.js\`
- Evidence path: \`package.json\`

Requires approval:
- Command: \`git tag\`
- Evidence path: \`.heli-harness/safety/command-tiers.md\`

Forbidden:
- Command: \`rm -rf\`
- Evidence path: \`.heli-harness/safety/command-tiers.md\`

## Repo risks

- Risk: hook host APIs may differ
- Evidence path: \`README.md\`

## Exceptions

- Exception: none recorded
- Scope: n/a
- Rationale: n/a
- Approval evidence: n/a

## Evidence paths

- Claim: package mode provides a lightweight extension
- Path: \`extensions/pi-extension.js\`
- What it proves: status, lint, and hook handling live in the extension
`);
writeFileSync(join(tempDir, ".heli-harness", "profiles", "bad.md"), `# Bad

## Observed stack

- Fact: JavaScript

## Existing patterns

- Use existing approach for API calls with raw fetch and token handling

## Recommended conventions

- Follow existing patterns with raw fetch and localStorage token use

## Forbidden patterns

- none

## Command tiers

Safe:
- \`rg\`

## Repo risks

- production publish path exists

## Exceptions

- none
`);
writeFileSync(join(tempDir, ".heli-harness", "profiles", "README.md"), `# Repo Profiles

Documentation for profile authors. This is not an active repo profile.
`);
writeFileSync(join(tempDir, ".heli-harness", "profiles", "sample.example.md"), `# Example Profile

Example/reference content. This is not an active repo profile.
`);
mkdirSync(join(tempDir, ".heli-harness", "policies"), { recursive: true });
for (const name of ["engineering", "release", "security", "testing"]) {
	writeFileSync(join(tempDir, ".heli-harness", "policies", `${name}.md`), `# ${name}

## Required

- Record what happened.

## Recommended

- Keep the rule readable.

## Forbidden

- Do not skip evidence.

## Requires approval

- Release actions.

## Exceptions

- Scope:
- Approval:
- Justification:
`);
}
mkdirSync(join(tempDir, ".heli-harness", "safety"), { recursive: true });
writeFileSync(join(tempDir, ".heli-harness", "safety", "command-tiers.md"), `# Command Tiers

T0
T1
T2
T3
T4
T5
T6
`);
writeFileSync(join(tempDir, ".heli-harness", "safety", "command-rules.json"), JSON.stringify({
	version: 1,
	defaultTierGuidance: {
		T0: "allow",
		T1: "allow",
		T2: "allow-with-context",
		T3: "ask-or-report",
		T4: "explicit-approval",
		T5: "explicit-approval",
		T6: "block",
	},
	rules: [
		{ id: "git-push", match: "git push", tier: "T5", reason: "Remote git writes need explicit approval" },
		{ id: "git-tag", match: "git tag", tier: "T5", reason: "Version tags are release actions" },
		{ id: "npm-publish", match: "npm publish", tier: "T5", reason: "Publish actions are release operations" },
		{ id: "pnpm-publish", match: "pnpm publish", tier: "T5", reason: "Publish actions are release operations" },
		{ id: "yarn-publish", match: "yarn publish", tier: "T5", reason: "Publish actions are release operations" },
		{ id: "npm-run-publish", match: "npm run publish", tier: "T5", reason: "Publish actions are release operations" },
		{ id: "destructive-delete", match: "rm -rf", tier: "T6", reason: "Recursive delete is destructive" },
		{ id: "git-clean-force", match: "git clean -fd", tier: "T6", reason: "git clean -fd is destructive" },
		{ id: "custom-smoke-rule", match: "custom-block-me", tier: "T5", reason: "Custom smoke command needs approval" },
	],
}));
writeFileSync(join(tempDir, ".heli-harness", "safety", "secrets.md"), `# Secret Handling

Do not print secrets.
Do not hardcode keys.
Adapter support varies.
Use approval when needed.
`);
mkdirSync(join(tempDir, ".heli-harness", "workspace"), { recursive: true });
writeFileSync(join(tempDir, ".heli-harness", "workspace", "index.json"), JSON.stringify({
	schemaVersion: 1,
	workspaceRoot: ".",
	repos: [
		{
			name: "demo",
			path: ".",
			gitRoot: ".",
			profile: ".heli-harness/profiles/demo.md",
			defaultTarget: true,
			notes: "local smoke repo",
		},
		{
			name: "ghost",
			path: "ghost",
			gitRoot: "ghost",
			profile: ".heli-harness/profiles/ghost.md",
			defaultTarget: false,
			notes: "intentionally missing to prove lint warnings",
		},
	],
}, null, 2));
writeFileSync(join(tempDir, ".heli-harness", "workspace", "target.json"), JSON.stringify({
	schemaVersion: 1,
	targetRepo: "demo",
	targetGitRoot: ".",
	writesAllowedUnder: ".",
	activeProfile: ".heli-harness/profiles/demo.md",
	selectedAt: "2026-01-01T00:00:00.000Z",
	selectedBy: "smoke",
	reason: "fixture",
}, null, 2));
mkdirSync(join(tempDir, ".heli-harness", "state", "reports"), { recursive: true });
writeFileSync(join(tempDir, ".heli-harness", "state", "current-task.md"), `# Current Task

Target repo: demo
`);
writeFileSync(join(tempDir, ".heli-harness", "state", "reports", "run.md"), `# Run Report

## Workspace root

.

## Target repo

demo

Target git root:
.

Writes allowed under:
.

## Active profile

demo

## Target context

Current cwd matched target:
yes

Workspace index used:
.heli-harness/workspace/index.json

Target selection method:
fixture

## Task

Smoke test.

## Files changed

None.

## Commands run

node scripts/smoke-extension-load.mjs

## Validation

Smoke passed.

## Policies loaded

engineering.md, release.md, security.md, testing.md

## Safety overlays loaded

command-tiers.md, command-rules.json, secrets.md

## Policy references used

.heli-harness/policies/engineering.md

## Profile taxonomy warnings

Avoid copying weak token handling if found.

## Profile-based decisions

Used the demo profile taxonomy and ignored the bad fixture pattern.

## Tech debt copied or avoided

Avoided copying raw fetch token handling from the bad fixture.

## Safer alternative chosen

Choice: keep extension logic local and inspectable

Rationale: matches the recommended convention and avoids copying risky auth patterns

## Profile deviations

Deviation: none

Reason: n/a

## Policy decisions

No deviations.

## Approval evidence

None.

## Safety events

None.

## Out-of-target warnings

None.

## Risks

None.

## Next steps

None.
`);

const tempExtension = join(tempDir, "extensions", "pi-extension.mjs");
copyFileSync(join(root, "extensions", "pi-extension.js"), tempExtension);
process.chdir(tempDir);

const events = [];
const commands = [];
const messages = [];
const notifications = [];
const pi = {
	on(name, handler) {
		events.push({ name, handler });
	},
	registerCommand(name, options) {
		commands.push({ name, options });
	},
	sendUserMessage(message) {
		messages.push(message);
	},
};
const ctx = {
	ui: {
		notify(message, level) {
			notifications.push({ message, level });
		},
		setStatus() {},
	},
};

const extension = await import(`file:///${tempExtension.split("\\").join("/")}`);
extension.default(pi);

assert.deepEqual(events.map((event) => event.name), [
	"session_start",
	"before_agent_start",
	"tool_call",
	"input",
]);

assert.deepEqual(commands.map((command) => command.name), [
	"heli-install",
	"hh-install",
	"hh-status",
	"heli-help",
	"heli-init",
	"heli-review",
	"heli-audit",
	"heli-validate",
	"heli-impact",
	"heli-hooks",
	"heli-target",
	"heli-lock",
]);

const toolCall = events.find((event) => event.name === "tool_call").handler;
assert.equal(await toolCall({ toolName: "bash", input: { command: "echo ok" } }, {}), undefined);
assert.deepEqual(await toolCall({ toolName: "bash", input: { command: "git push" } }, {}), {
	block: true,
	reason: "Blocked: Remote git writes need explicit approval. Target repo: demo. Run operation explicitly to override.",
});
assert.deepEqual(await toolCall({ toolName: "bash", input: { command: "git   push" } }, {}), {
	block: true,
	reason: "Blocked: Remote git writes need explicit approval. Target repo: demo. Run operation explicitly to override.",
});
assert.deepEqual(await toolCall({ toolName: "bash", input: { command: "GIT PUSH" } }, {}), {
	block: true,
	reason: "Blocked: Remote git writes need explicit approval. Target repo: demo. Run operation explicitly to override.",
});
assert.deepEqual(await toolCall({ toolName: "bash", input: { command: "bash -c \"git push\"" } }, {}), {
	block: true,
	reason: "Blocked: Remote git writes need explicit approval. Target repo: demo. Run operation explicitly to override.",
});
assert.deepEqual(await toolCall({ toolName: "bash", input: { command: "npm publish" } }, {}), {
	block: true,
	reason: "Blocked: Publish actions are release operations. Target repo: demo. Run operation explicitly to override.",
});
assert.deepEqual(await toolCall({ toolName: "bash", input: { command: "pnpm publish" } }, {}), {
	block: true,
	reason: "Blocked: Publish actions are release operations. Target repo: demo. Run operation explicitly to override.",
});
assert.deepEqual(await toolCall({ toolName: "bash", input: { command: "yarn publish" } }, {}), {
	block: true,
	reason: "Blocked: Publish actions are release operations. Target repo: demo. Run operation explicitly to override.",
});
assert.deepEqual(await toolCall({ toolName: "bash", input: { command: "npm run publish" } }, {}), {
	block: true,
	reason: "Blocked: Publish actions are release operations. Target repo: demo. Run operation explicitly to override.",
});
assert.deepEqual(await toolCall({ toolName: "bash", input: { command: "rm -r -f build" } }, {}), {
	block: true,
	reason: "Blocked: Recursive delete is destructive. Target repo: demo. Run operation explicitly to override.",
});
assert.deepEqual(await toolCall({ toolName: "bash", input: { command: "rm --recursive --force build" } }, {}), {
	block: true,
	reason: "Blocked: Recursive delete is destructive. Target repo: demo. Run operation explicitly to override.",
});
assert.deepEqual(await toolCall({ toolName: "bash", input: { command: "custom-block-me --flag" } }, {}), {
	block: true,
	reason: "Blocked: Custom smoke command needs approval. Target repo: demo. Run operation explicitly to override.",
});
assert.deepEqual(await toolCall({ toolName: "bash", input: { command: "echo hi > ../outside.txt" } }, {}), {
	block: true,
	reason: "Blocked: shell redirection writes outside writesAllowedUnder for demo",
});
assert.deepEqual(await toolCall({ toolName: "write", input: { path: ".env" } }, {}), {
	block: true,
	reason: "Blocked: .env files contain secrets. Run operation explicitly to override.",
});
assert.deepEqual(await toolCall({ toolName: "write", input: { path: ".env.local" } }, {}), {
	block: true,
	reason: "Blocked: env files contain secrets. Run operation explicitly to override.",
});
assert.deepEqual(await toolCall({ toolName: "write", input: { path: "secrets.json" } }, {}), {
	block: true,
	reason: "Blocked: secret files contain secrets. Run operation explicitly to override.",
});
assert.deepEqual(await toolCall({ toolName: "write", input: { path: "notes.txt", content: "OPENAI_API_KEY=sk-test" } }, {}), {
	block: true,
	reason: "Blocked: secret-like content detected. Run operation explicitly to override.",
});
assert.deepEqual(await toolCall({ toolName: "bash", input: { command: "cat .env" } }, {}), {
	block: true,
	reason: "Blocked: sensitive file read detected. Target repo: demo. Run operation explicitly to override.",
});
// v0.5.5: tool-agnostic command guard — non-bash tool names with input.command
assert.deepEqual(await toolCall({ toolName: "shell", input: { command: "git push" } }, {}), {
	block: true,
	reason: "Blocked: Remote git writes need explicit approval. Target repo: demo. Run operation explicitly to override.",
});
assert.deepEqual(await toolCall({ toolName: "bash", input: { command: "git clean -xdf" } }, {}), {
	block: true,
	reason: "Blocked: git clean -fd is destructive. Target repo: demo. Run operation explicitly to override.",
});
// v0.5.6: git global flags normalization
assert.deepEqual(await toolCall({ toolName: "bash", input: { command: "git -C repo push" } }, {}), {
	block: true,
	reason: "Blocked: Remote git writes need explicit approval. Target repo: demo. Run operation explicitly to override.",
});
assert.deepEqual(await toolCall({ toolName: "bash", input: { command: "git -c user.name=test push" } }, {}), {
	block: true,
	reason: "Blocked: Remote git writes need explicit approval. Target repo: demo. Run operation explicitly to override.",
});
assert.deepEqual(await toolCall({ toolName: "bash", input: { command: "git -C /tmp -c core.autocrlf=false push" } }, {}), {
	block: true,
	reason: "Blocked: Remote git writes need explicit approval. Target repo: demo. Run operation explicitly to override.",
});
// v0.5.5: multi-tool file write guard
assert.deepEqual(await toolCall({ toolName: "multi_edit", input: { path: "secrets.json" } }, {}), {
	block: true,
	reason: "Blocked: secret files contain secrets. Run operation explicitly to override.",
});
assert.deepEqual(await toolCall({ toolName: "file_write", input: { path: ".env.local" } }, {}), {
	block: true,
	reason: "Blocked: env files contain secrets. Run operation explicitly to override.",
});
// v0.5.5: backup suffix secret paths
assert.deepEqual(await toolCall({ toolName: "write", input: { path: "secrets.pem.bak" } }, {}), {
	block: true,
	reason: "Blocked: PEM files are private keys. Run operation explicitly to override.",
});

const sessionStart = events.find((event) => event.name === "session_start").handler;
const beforeAgentStart = events.find((event) => event.name === "before_agent_start").handler;
await sessionStart({}, ctx);
const baselinePrompt = await beforeAgentStart({ systemPrompt: "BASE" }, ctx);
assert(!baselinePrompt.systemPrompt.includes("HELI_HOOK_OK"));

await commands.find((command) => command.name === "hh-status").options.handler({}, ctx);
assert(notifications.some((item) => item.message === "Version: 0.5.9"));
assert(notifications.some((item) => item.message === "Mode: package + workspace"));
assert(notifications.some((item) => item.message === "Target repo: demo"));
assert(notifications.some((item) => item.message === "Policy directory: detected"));
assert(notifications.some((item) => item.message === "Safety directory: detected"));
assert(notifications.some((item) => item.message === "command-rules.json: valid"));
assert(notifications.some((item) => item.message === "Workspace index: detected"));
assert(notifications.some((item) => item.message === "Known repos: 2"));
assert(notifications.some((item) => item.message === "Writes allowed under: ."));

await commands.find((command) => command.name === "heli-target").options.handler({}, ctx);
await commands.find((command) => command.name === "heli-target").options.handler("list", ctx);
await commands.find((command) => command.name === "heli-target").options.handler("clear", ctx);
assert.deepEqual(await toolCall({ toolName: "write", input: { path: "notes.txt" } }, {}), {
	block: true,
	reason: "Blocked: target repo not selected in multi-repo workspace",
});
assert.deepEqual(await toolCall({ toolName: "multi_edit", input: { path: "notes.txt" } }, {}), {
	block: true,
	reason: "Blocked: target repo not selected in multi-repo workspace",
});
await commands.find((command) => command.name === "heli-target").options.handler("set demo", ctx);
let targetState;
try {
	targetState = JSON.parse(readFileSync(join(tempDir, ".heli-harness", "workspace", "target.json"), "utf8"));
} catch (e) {
	throw new Error(`Failed to parse target.json: ${e.message}`);
}
assert.equal(targetState.targetRepo, "demo");
assert.equal(await toolCall({ toolName: "write", input: { path: "notes.txt" } }, {}), undefined);
assert.deepEqual(await toolCall({ toolName: "write", input: { path: "..\\outside.txt" } }, {}), {
	block: true,
	reason: "Blocked: write path is outside writesAllowedUnder for demo",
});
assert.deepEqual(await toolCall({ toolName: "multi_edit", input: { path: "..\\outside.txt" } }, {}), {
	block: true,
	reason: "Blocked: write path is outside writesAllowedUnder for demo",
});

await commands.find((command) => command.name === "heli-hooks").options.handler("probe", ctx);
const probePrompt = await beforeAgentStart({ systemPrompt: "BASE" }, ctx);
assert(probePrompt.systemPrompt.includes("HELI_HOOK_OK"));
const afterProbePrompt = await beforeAgentStart({ systemPrompt: "BASE" }, ctx);
assert(!afterProbePrompt.systemPrompt.includes("HELI_HOOK_OK"));
await commands.find((command) => command.name === "heli-hooks").options.handler({}, ctx);
assert(notifications.some((item) => item.message === "prompt probe: inactive"));
assert(notifications.some((item) => item.message.includes("HELI_HOOK_OK")));

await commands.find((command) => command.name === "heli-hooks").options.handler("test-guard", ctx);
assert.deepEqual(await toolCall({ toolName: "bash", input: { command: "git push" } }, ctx), {
	block: true,
	reason: "HELI_GUARD_OK: intercepted Remote git writes need explicit approval",
});
assert.deepEqual(await toolCall({ toolName: "bash", input: { command: "git push" } }, ctx), {
	block: true,
	reason: "Blocked: Remote git writes need explicit approval. Target repo: demo. Run operation explicitly to override.",
});

writeFileSync(join(tempDir, ".heli-harness", "safety", "command-rules.json"), JSON.stringify({
	version: 1,
	rules: [{ id: "invalid-missing-fields" }],
}));
await commands.find((command) => command.name === "heli-validate").options.handler("safety", ctx);
assert(notifications.some((item) => item.message.includes("command-rules.json: invalid schema")));
assert.deepEqual(await toolCall({ toolName: "bash", input: { command: "git tag v-test" } }, ctx), {
	block: true,
	reason: "Blocked: Version tags are release actions. Target repo: demo. Run operation explicitly to override.",
});
assert(notifications.some((item) => item.message.includes("Command rules warning:")));

await commands.find((command) => command.name === "heli-hooks").options.handler("probe-off", ctx);
await commands.find((command) => command.name === "heli-hooks").options.handler({}, ctx);
await commands.find((command) => command.name === "heli-validate").options.handler("lint", ctx);
await commands.find((command) => command.name === "heli-validate").options.handler("profile", ctx);
await commands.find((command) => command.name === "heli-validate").options.handler("policy", ctx);
await commands.find((command) => command.name === "heli-validate").options.handler("safety", ctx);
await commands.find((command) => command.name === "heli-validate").options.handler("workspace", ctx);
await commands.find((command) => command.name === "heli-validate").options.handler("target", ctx);
await commands.find((command) => command.name === "heli-validate").options.handler("lock", ctx);
await commands.find((command) => command.name === "heli-lock").options.handler({}, ctx);
await commands.find((command) => command.name === "heli-lock").options.handler("help", ctx);
await commands.find((command) => command.name === "heli-help").options.handler({}, ctx);

assert(notifications.some((item) => item.message === "Heli-Harness Status"));
assert(notifications.some((item) => item.message === "Heli Lock Status"));
assert(notifications.some((item) => item.message === "Heli-Harness Auto Hooks Status"));
assert(notifications.some((item) => item.message === "Heli hook probe armed"));
assert(notifications.some((item) => item.message === "Heli tool_call guard probe armed"));
assert(notifications.some((item) => item.message === "test-guard probe: inactive"));
assert(notifications.some((item) => item.message === "Heli profile lint"));
assert(notifications.some((item) => item.message === "Heli policy lint"));
assert(notifications.some((item) => item.message === "Heli safety lint"));
assert(notifications.some((item) => item.message === "Heli workspace lint"));
assert(notifications.some((item) => item.message === "Heli target lint"));
assert(notifications.some((item) => item.message === "Heli lock lint"));
assert(notifications.some((item) => item.message === "Heli report lint"));
assert(notifications.some((item) => item.message === "Checked: 2"));
assert(!notifications.some((item) => item.message.includes("README.md: missing section")));
assert(!notifications.some((item) => item.message.includes("sample.example.md: missing section")));
assert(notifications.some((item) => item.message.includes('bad.md: missing section "Known tech debt"')));
assert(!notifications.some((item) => item.message.includes('demo.md: missing section "Known tech debt"')));
assert(notifications.some((item) => item.message.includes("bad.md: existing patterns section has no evidence paths")));
assert(notifications.some((item) => item.message.includes("bad.md: references existing patterns without classifying possible tech debt")));
assert(notifications.some((item) => item.message.includes("ghost: path does not exist")));
assert(notifications.some((item) => item.message.includes("ghost: profile does not exist")));
assert(notifications.some((item) => item.message === "Target repo set: demo"));
assert.deepEqual(messages, ["/skill:heli-help"]);

console.log("extension smoke ok");
