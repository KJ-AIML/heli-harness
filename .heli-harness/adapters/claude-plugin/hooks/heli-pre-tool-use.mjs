#!/usr/bin/env node

import { stdin } from "node:process";

const input = await new Promise((resolve) => {
	let data = "";
	stdin.setEncoding("utf8");
	stdin.on("data", (chunk) => { data += chunk; });
	stdin.on("end", () => resolve(data));
});

function deny(reason) {
	process.stdout.write(JSON.stringify({
		hookSpecificOutput: {
			hookEventName: "PreToolUse",
			permissionDecision: "deny",
			permissionDecisionReason: reason,
		},
	}));
}

function commandFrom(event) {
	return String(event?.tool_input?.command ?? event?.tool_input?.description ?? "");
}

function pathsFrom(value, out = []) {
	if (!value || typeof value !== "object") return out;
	for (const [key, item] of Object.entries(value)) {
		if (/path|file/i.test(key) && typeof item === "string") out.push(item);
		else if (item && typeof item === "object") pathsFrom(item, out);
	}
	return out;
}

// apply_patch tools (Codex, and Bash-driven patch flows) send the target path
// inside a patch-format command string, not a path/file field:
//   *** Begin Patch
//   *** Add File: .env
//   +FOO=bar
//   *** End Patch
function patchPathsFrom(commandText, out = []) {
	const re = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;
	let match;
	while ((match = re.exec(commandText))) out.push(match[1].trim());
	const moveRe = /^\*\*\* Move to: (.+)$/gm;
	while ((match = moveRe.exec(commandText))) out.push(match[1].trim());
	return out;
}

const event = input.trim() ? JSON.parse(input) : {};
const rawCommand = commandFrom(event);
const command = rawCommand.replace(/\s+/g, " ").trim().toLowerCase();
const paths = [...pathsFrom(event.tool_input), ...patchPathsFrom(rawCommand)]
	.map((path) => path.replaceAll("\\", "/").toLowerCase());

if (/\bgit\s+push\b/.test(command)) deny("Heli-Harness blocks git push in agent sessions — this is a blanket rule, not gated on release approval. Push manually outside the session if needed.");
else if (paths.some((path) => /(^|\/)\.env(\.|$)/.test(path))) deny("Heli-Harness blocks writes to .env-style secret files.");
