import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const tempDir = mkdtempSync(join(tmpdir(), "heli-extension-"));
const tempExtension = join(tempDir, "pi-extension.mjs");
copyFileSync(join(root, "extensions", "pi-extension.js"), tempExtension);

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

await commands.find((command) => command.name === "hh-status").options.handler({}, ctx);
await commands.find((command) => command.name === "heli-hooks").options.handler({}, ctx);
await commands.find((command) => command.name === "heli-help").options.handler({}, ctx);
assert(notifications.some((item) => item.message === "Heli-Harness Status"));
assert(notifications.some((item) => item.message === "Heli-Harness Auto Hooks Status"));
assert.deepEqual(messages, ["/skill:heli-help"]);

console.log("extension smoke ok");
