import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { wantsJson, stripOutputFlags, printProtocolResult } from "./output.mjs";
import { protocolOk } from "../protocol/result.mjs";

const HOSTS = Object.freeze({
	codex: { label: "Codex", support: "enforced", cli: "codex", automatic: true },
	pi: { label: "Pi", support: "enforced", cli: "pi", automatic: true },
	claude: { label: "Claude Code", support: "enforced", cli: "claude", automatic: true },
	grok: { label: "Grok Build", support: "enforced", cli: "grok", automatic: true },
	opencode: { label: "OpenCode", support: "enforced", cli: "opencode", automatic: true },
	kimi: { label: "Kimi Code CLI", support: "enforced", cli: "kimi", automatic: true },
	cursor: { label: "Cursor", support: "plugin-wired", cli: "cursor", automatic: true },
	axga: { label: "AXGA", support: "documented", cli: "axga", automatic: true },
	antigravity: { label: "Antigravity CLI", support: "verified-plugin-wired", cli: "antigravity", automatic: false },
});

function quote(arg) {
	const value = String(arg);
	return /[\s"]/u.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
}

function run(command, args = [], options = {}) {
	if (process.platform === "win32") {
		const line = [command, ...args].map(quote).join(" ");
		return spawnSync(line, { encoding: "utf8", shell: true, ...options });
	}
	return spawnSync(command, args, { encoding: "utf8", ...options });
}

function commandPresent(command) {
	const result = run(command, ["--version"]);
	return !(result.error && result.error.code === "ENOENT") && result.status === 0;
}

function textOf(result) {
	return `${result?.stdout || ""}\n${result?.stderr || ""}`.trim();
}

function packageVersion(packageRoot) {
	try {
		return JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")).version || "0.10.0";
	} catch {
		try {
			return JSON.parse(readFileSync(join(packageRoot, ".heli-harness", "manifest.json"), "utf8")).version || "0.10.0";
		} catch {
			return "0.10.0";
		}
	}
}

function asset(packageRoot, ...parts) {
	return join(packageRoot, ".heli-harness", "adapters", ...parts);
}

function markerPresent(path, marker) {
	if (!existsSync(path)) return false;
	try {
		return readFileSync(path, "utf8").includes(marker);
	} catch {
		return false;
	}
}

export function inspectHost(packageRoot, id) {
	const spec = HOSTS[id];
	if (!spec) throw new Error(`unknown host: ${id}`);
	const cliPresent = commandPresent(spec.cli);
	let installed = false;
	let detail = "";

	if (id === "codex" && cliPresent) {
		const result = run("codex", ["plugin", "list"]);
		installed = result.status === 0 && /heli-harness@heli-harness\s+installed, enabled/i.test(result.stdout || "");
		detail = installed ? "plugin installed and enabled" : "plugin not detected";
	} else if ((id === "pi" || id === "axga") && cliPresent) {
		const result = run(spec.cli, ["list"]);
		installed = result.status === 0 && /heli-harness/i.test(textOf(result));
		detail = installed ? "Heli package listed by host" : "Heli package not detected";
	} else if (id === "claude" && cliPresent) {
		const result = run("claude", ["plugin", "list"]);
		installed = result.status === 0 && /heli-harness/i.test(textOf(result));
		detail = installed ? "plugin listed by Claude" : "plugin not detected";
	} else if (id === "grok") {
		const hooks = join(homedir(), ".grok", "hooks", "heli-harness.json");
		installed = existsSync(hooks);
		detail = installed ? `user hooks present: ${hooks}` : "user hooks not detected";
	} else if (id === "kimi") {
		const home = process.env.KIMI_CODE_HOME || join(homedir(), ".kimi-code");
		const config = join(home, "config.toml");
		installed = markerPresent(config, "# --- heli-harness hooks ---");
		detail = installed ? `Heli hooks present: ${config}` : "Heli hooks not detected";
	} else if (id === "opencode") {
		const entry = join(homedir(), ".config", "opencode", "plugins", "heli-harness.js");
		installed = existsSync(entry);
		detail = installed ? `global plugin present: ${entry}` : "global plugin not detected";
	} else if (id === "cursor") {
		const manifest = join(homedir(), ".cursor", "plugins", "local", "heli-harness", ".cursor-plugin", "plugin.json");
		installed = existsSync(manifest);
		detail = installed ? `local plugin present: ${manifest}` : "local plugin not detected";
	} else if (id === "antigravity") {
		detail = "automatic install unavailable: host plugin directory is version-specific";
	}

	return {
		id,
		label: spec.label,
		support: spec.support,
		cliPresent,
		installed,
		automatic: spec.automatic,
		detail,
		runtimeEvidence: "not inferred from installation; start the host in a linked project and run heli explain capabilities",
	};
}

export function inspectHosts(packageRoot) {
	return Object.keys(HOSTS).map((id) => inspectHost(packageRoot, id));
}

function step(command, args, { allowAlready = false } = {}) {
	const result = run(command, args);
	const output = textOf(result);
	if (result.status === 0) return { ok: true, command: [command, ...args], output };
	if (allowAlready && /already|exists|installed/i.test(output)) {
		return { ok: true, command: [command, ...args], output, already: true };
	}
	return { ok: false, command: [command, ...args], output, code: result.status, error: result.error?.message || null };
}

function copyContents(source, destination) {
	mkdirSync(destination, { recursive: true });
	for (const name of readdirSync(source)) {
		cpSync(join(source, name), join(destination, name), { recursive: true, force: true });
	}
}

export function planHostInstall(packageRoot, id) {
	const version = packageVersion(packageRoot);
	switch (id) {
		case "codex":
			return [
				["codex", "plugin", "marketplace", "add", "KJ-AIML/heli-harness"],
				["codex", "plugin", "add", "heli-harness@heli-harness"],
			];
		case "pi":
			return [["pi", "install", `git:github.com/KJ-AIML/heli-harness@v${version}`]];
		case "axga":
			return [["axga", "install", `git:github.com/KJ-AIML/heli-harness@v${version}`]];
		case "claude":
			return [["claude", "plugin", "install", asset(packageRoot, "claude-plugin")]];
		case "grok":
			return [
				[process.execPath, asset(packageRoot, "grok-plugin", "install-user-hooks.mjs")],
				["grok", "plugin", "install", asset(packageRoot, "grok-plugin"), "--trust"],
			];
		case "kimi":
			return [
				[process.execPath, asset(packageRoot, "kimi-plugin", "install-user-hooks.mjs")],
				["kimi", "doctor", "config"],
			];
		case "opencode":
			return [["copy", asset(packageRoot, "opencode-plugin"), join(homedir(), ".config", "opencode", "plugins")]];
		case "cursor":
			return [["copy", asset(packageRoot, "cursor-plugin", "plugins", "heli-harness"), join(homedir(), ".cursor", "plugins", "local", "heli-harness")]];
		case "antigravity":
			return [];
		default:
			throw new Error(`unknown host: ${id}`);
	}
}

export function installHost(packageRoot, id, { dryRun = false } = {}) {
	const spec = HOSTS[id];
	if (!spec) throw new Error(`unknown host: ${id}`);
	if (!spec.automatic) {
		return { id, ok: true, skipped: true, reason: "manual host-specific plugin location required", steps: [] };
	}
	const before = inspectHost(packageRoot, id);
	if (!before.cliPresent && !["opencode", "cursor"].includes(id)) {
		return { id, ok: true, skipped: true, reason: `${spec.label} CLI not found on PATH`, steps: [] };
	}
	const plan = planHostInstall(packageRoot, id);
	if (dryRun) return { id, ok: true, dryRun: true, plan, before };

	const steps = [];
	for (const [command, ...args] of plan) {
		if (command === "copy") {
			try {
				copyContents(args[0], args[1]);
				steps.push({ ok: true, command: ["copy", args[0], args[1]] });
			} catch (error) {
				steps.push({ ok: false, command: ["copy", args[0], args[1]], error: error.message });
				return { id, ok: false, before, after: inspectHost(packageRoot, id), steps };
			}
			continue;
		}
		const result = step(command, args, { allowAlready: ["codex", "claude", "grok", "pi", "axga"].includes(id) });
		steps.push(result);
		if (!result.ok) return { id, ok: false, before, after: inspectHost(packageRoot, id), steps };
	}
	const after = inspectHost(packageRoot, id);
	return { id, ok: after.installed || id === "grok" || id === "kimi", before, after, steps };
}

function parse(args) {
	const clean = stripOutputFlags(args);
	const flags = { dryRun: false };
	const positional = [];
	for (const item of clean) {
		if (item === "--dry-run") flags.dryRun = true;
		else positional.push(item);
	}
	return { positional, flags };
}

export function runHost(packageRoot, args = []) {
	const json = wantsJson(args);
	const { positional, flags } = parse(args);
	const sub = positional[0] || "status";

	if (sub === "list" || sub === "status") {
		const hosts = inspectHosts(packageRoot);
		const result = protocolOk("host.status", { hosts });
		if (json) printProtocolResult(result);
		else {
			console.log("Heli host integrations:");
			for (const host of hosts) {
				const mark = host.installed ? "✓" : host.cliPresent ? "○" : "–";
				console.log(`  ${mark} ${host.label.padEnd(16)} installed=${host.installed ? "yes" : "no"} cli=${host.cliPresent ? "yes" : "no"} support=${host.support}`);
				if (host.detail) console.log(`      ${host.detail}`);
			}
			console.log("");
			console.log("Runtime enforcement is session evidence, not installation state. After opening a linked project in a host, run: heli explain capabilities");
		}
		return result;
	}

	if (sub === "install") {
		const requested = positional.slice(1);
		const ids = !requested.length || requested.includes("all") ? Object.keys(HOSTS) : requested;
		const installs = ids.map((id) => installHost(packageRoot, id, { dryRun: flags.dryRun }));
		const result = protocolOk("host.install", { installs });
		if (json) printProtocolResult(result);
		else {
			for (const item of installs) {
				if (item.skipped) console.log(`- ${item.id}: skipped — ${item.reason}`);
				else if (item.dryRun) console.log(`- ${item.id}: dry-run — ${item.plan.map((p) => p.join(" ")).join(" ; ")}`);
				else console.log(`- ${item.id}: ${item.ok ? "installed/verified" : "FAILED"}`);
			}
			console.log("");
			console.log("Check installation: heli host status");
			console.log("Then start Codex/Pi/Claude/etc. from a linked project root and verify live callbacks with: heli explain capabilities");
		}
		if (installs.some((item) => item.ok === false)) process.exitCode = 1;
		return result;
	}

	throw new Error("Usage: heli host status|list|install [all|codex|pi|claude|grok|opencode|kimi|cursor|axga|antigravity] [--dry-run]");
}
