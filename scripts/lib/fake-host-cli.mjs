#!/usr/bin/env node
/**
 * Fake host CLI used by hermetic tests (see scripts/lib/hermetic-env.mjs).
 *
 * Invoked by generated shims as: node fake-host-cli.mjs <host> [args...]
 * Appends one JSON line { host, args } to $HELI_FAKE_HOST_LOG, then prints the
 * canned response for "<host> <args joined by space>" from the JSON file at
 * $HELI_FAKE_HOST_RESPONSES (or a harmless default) and exits with its status.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const [host = "unknown", ...args] = process.argv.slice(2);
const logPath = process.env.HELI_FAKE_HOST_LOG;
if (logPath) appendFileSync(logPath, `${JSON.stringify({ host, args })}\n`, "utf8");

let responses = {};
const responsesPath = process.env.HELI_FAKE_HOST_RESPONSES;
if (responsesPath && existsSync(responsesPath)) {
	try {
		responses = JSON.parse(readFileSync(responsesPath, "utf8"));
	} catch {
		responses = {};
	}
}

const key = [host, ...args].join(" ");
const fallback = args[0] === "--version"
	? { stdout: `${host} 0.0.0-fake\n`, status: 0 }
	: key === "claude plugin list --json"
		? { stdout: "[]\n", status: 0 }
		: { stdout: "", status: 0 };
const response = { ...fallback, ...(responses[key] || {}) };
if (response.stdout) process.stdout.write(response.stdout);
if (response.stderr) process.stderr.write(response.stderr);
process.exit(Number.isInteger(response.status) ? response.status : 0);
