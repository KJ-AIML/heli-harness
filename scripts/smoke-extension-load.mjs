import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const tempDir = mkdtempSync(join(tmpdir(), "heli-extension-"));
mkdirSync(join(tempDir, "extensions"), { recursive: true });
mkdirSync(join(tempDir, ".heli-harness"), { recursive: true });
writeFileSync(join(tempDir, ".heli-harness", "HARNESS.md"), "# Harness\n");
writeFileSync(join(tempDir, "package.json"), JSON.stringify({ version: "0.4.0" }));
mkdirSync(join(tempDir, ".heli-harness", "profiles"), { recursive: true });
writeFileSync(join(tempDir, ".heli-harness", "profiles", "demo.md"), `# Demo

Policy references:

- .heli-harness/policies/engineering.md

## Observed stack

JavaScript.

## Existing patterns

Small extension file.

## Recommended conventions

Keep behavior local and inspectable.

## Known tech debt

None recorded.

## Forbidden patterns

Do not store secrets.

## Command tiers

Safe checks first.

## Repo risks

Hook host APIs may differ.

## Exceptions

None.
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
	rules: [{ id: "git-push", match: "git push", tier: "T5", reason: "Remote git writes need explicit approval" }],
}));
writeFileSync(join(tempDir, ".heli-harness", "safety", "secrets.md"), `# Secret Handling

Do not print secrets.
Do not hardcode keys.
Adapter support varies.
Use approval when needed.
`);
mkdirSync(join(tempDir, ".heli-harness", "state", "reports"), { recursive: true });
writeFileSync(join(tempDir, ".heli-harness", "state", "current-task.md"), `# Current Task

Target repo: demo
`);
writeFileSync(join(tempDir, ".heli-harness", "state", "reports", "run.md"), `# Run Report

## Target repo

demo

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

## Policy decisions

No deviations.

## Approval evidence

None.

## Safety events

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
]);

const toolCall = events.find((event) => event.name === "tool_call").handler;
assert.equal(await toolCall({ toolName: "bash", input: { command: "echo ok" } }, {}), undefined);
assert.deepEqual(await toolCall({ toolName: "bash", input: { command: "git push" } }, {}), {
	block: true,
	reason: "Blocked: git push is a remote operation. Run operation explicitly to override.",
});
assert.equal(await toolCall({ toolName: "write", input: { path: "notes.txt" } }, {}), undefined);
assert.deepEqual(await toolCall({ toolName: "write", input: { path: ".env" } }, {}), {
	block: true,
	reason: "Blocked: .env files contain secrets. Run operation explicitly to override.",
});

const sessionStart = events.find((event) => event.name === "session_start").handler;
const beforeAgentStart = events.find((event) => event.name === "before_agent_start").handler;
await sessionStart({}, ctx);
const baselinePrompt = await beforeAgentStart({ systemPrompt: "BASE" }, ctx);
assert(!baselinePrompt.systemPrompt.includes("HELI_HOOK_OK"));

await commands.find((command) => command.name === "hh-status").options.handler({}, ctx);
assert(notifications.some((item) => item.message === "Version: 0.4.0"));
assert(notifications.some((item) => item.message === "Mode: package + workspace"));
assert(notifications.some((item) => item.message === "Target repo: demo"));
assert(notifications.some((item) => item.message === "Policy directory: detected"));
assert(notifications.some((item) => item.message === "Safety directory: detected"));
assert(notifications.some((item) => item.message === "command-rules.json: parseable"));
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
	reason: "HELI_GUARD_OK: intercepted git push is a remote operation",
});
assert.deepEqual(await toolCall({ toolName: "bash", input: { command: "git push" } }, ctx), {
	block: true,
	reason: "Blocked: git push is a remote operation. Run operation explicitly to override.",
});

await commands.find((command) => command.name === "heli-hooks").options.handler("probe-off", ctx);
await commands.find((command) => command.name === "heli-hooks").options.handler({}, ctx);
await commands.find((command) => command.name === "heli-validate").options.handler("lint", ctx);
await commands.find((command) => command.name === "heli-validate").options.handler("policy", ctx);
await commands.find((command) => command.name === "heli-validate").options.handler("safety", ctx);
await commands.find((command) => command.name === "heli-help").options.handler({}, ctx);
assert(notifications.some((item) => item.message === "Heli-Harness Status"));
assert(notifications.some((item) => item.message === "Heli-Harness Auto Hooks Status"));
assert(notifications.some((item) => item.message === "Heli hook probe armed"));
assert(notifications.some((item) => item.message === "Heli tool_call guard probe armed"));
assert(notifications.some((item) => item.message === "test-guard probe: inactive"));
assert(notifications.some((item) => item.message === "Heli profile lint"));
assert(notifications.some((item) => item.message === "Heli policy lint"));
assert(notifications.some((item) => item.message === "Heli safety lint"));
assert(notifications.some((item) => item.message === "Heli report lint"));
assert.deepEqual(messages, ["/skill:heli-help"]);

console.log("extension smoke ok");
