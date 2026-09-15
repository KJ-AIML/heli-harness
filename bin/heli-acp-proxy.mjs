#!/usr/bin/env node
import { runAcpGovernanceProxy } from "../lib/acp/proxy.mjs";

const argv = process.argv.slice(2);
let cwd = process.cwd();
let separator = argv.indexOf("--");
if (argv[0] === "--cwd" && argv[1]) {
	cwd = argv[1];
	argv.splice(0, 2);
	separator = argv.indexOf("--");
}
const commandArgs = separator >= 0 ? argv.slice(separator + 1) : argv;
const [command, ...args] = commandArgs;
if (!command) {
	console.error("Usage: heli-acp-proxy [--cwd path] -- <agent-acp-command> [args...]");
	process.exit(1);
}

try {
	const result = await runAcpGovernanceProxy({ command, args, cwd });
	process.exitCode = result.code;
} catch (error) {
	console.error(`[heli-acp] ${error.code || "ACP_PROXY_ERROR"}: ${error.message}`);
	process.exitCode = 2;
}
