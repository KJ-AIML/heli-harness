#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const heli = join(root, "bin", "heli.mjs");

function snapshot(dir, prefix = "") {
	const out = [];
	for (const name of readdirSync(dir, { withFileTypes: true })) {
		const rel = prefix ? `${prefix}/${name.name}` : name.name;
		out.push(rel);
		if (name.isDirectory()) out.push(...snapshot(join(dir, name.name), rel));
	}
	return out.sort();
}

function runHelp(args, sandbox) {
	const cwd = join(sandbox, "workspace");
	const home = join(sandbox, "home");
	mkdirSync(cwd, { recursive: true });
	mkdirSync(home, { recursive: true });
	const before = snapshot(sandbox);
	const result = spawnSync(process.execPath, [heli, ...args], {
		cwd,
		encoding: "utf8",
		env: {
			...process.env,
			HOME: home,
			USERPROFILE: home,
			XDG_CONFIG_HOME: join(home, ".config"),
			XDG_DATA_HOME: join(home, ".local", "share"),
			HELI_CONFIG_HOME: join(home, ".heli"),
		},
	});
	assert.equal(result.status, 0, `heli ${args.join(" ")} should exit 0:\n${result.stdout}\n${result.stderr}`);
	assert.match(result.stdout, /Usage: heli/i, `heli ${args.join(" ")} should print help`);
	assert.equal(result.stderr, "", `heli ${args.join(" ")} should not print an error`);
	assert.deepEqual(snapshot(sandbox), before, `heli ${args.join(" ")} must be read-only`);
	return result.stdout;
}

const sandbox = mkdtempSync(join(tmpdir(), "heli-cli-help-"));
try {
	for (const args of [
		["--help"],
		["-h"],
		["help"],
		["help", "task"],
		["setup", "--help"],
		["link", "--help"],
		["host", "--help"],
		["grant", "--help"],
		["install", "--help"],
		["update", "--help"],
		["uninstall", "--help"],
		["target", "--help"],
		["status", "--help"],
		["resume", "--help"],
		["doctor", "--help"],
		["governance", "--help"],
		["yolo", "--help"],
		["task", "--help"],
		["handoff", "--help"],
		["diagnosis", "--help"],
		["session", "--help"],
		["conflicts", "--help"],
		["explain", "--help"],
		["trace", "--help"],
		["auth", "--help"],
		["ws", "--help"],
		["push", "--help"],
		["pull", "--help"],
		["sync", "--help"],
		["init", "--help"],
	]) runHelp(args, sandbox);

	for (const [group, subs] of Object.entries({
		host: ["status", "list", "install", "update", "repair", "remove"],
		grant: ["issue", "list", "revoke"],
		target: ["list", "show", "set", "clear"],
		task: ["create", "list", "show", "depends", "migrate-legacy", "claim", "release", "provenance", "complete", "takeover"],
		handoff: ["publish", "list", "show"],
		diagnosis: ["show", "init", "record", "route", "gate"],
		session: ["start", "attach", "transfer-write", "status", "list", "close"],
		governance: ["show", "set"],
		explain: ["authority", "task", "guard", "capabilities", "decision", "config"],
		trace: ["show"],
		auth: ["login", "logout", "status", "devices"],
		ws: ["create", "link", "unlink", "list", "versions", "delete"],
	})) {
		for (const sub of subs) {
			const out = runHelp([group, sub, "--help"], sandbox);
			assert.match(out, new RegExp(`\\b${sub.replace("-", "\\-")}\\b`, "i"));
		}
	}

	const linkHelp = runHelp(["link", "--help"], sandbox);
	assert.match(linkHelp, /link/i);
	assert.ok(!snapshot(sandbox).some((entry) => entry.includes(".heli")), "link help must not create .heli state");

	console.log("cli help smoke ok");
} finally {
	rmSync(sandbox, { recursive: true, force: true });
}
