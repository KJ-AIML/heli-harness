import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const YOLO_REL = join(".heli-harness", "state", "yolo.json");

function yoloPath(cwd) {
	return join(cwd, YOLO_REL);
}

function readYolo(cwd) {
	const path = yoloPath(cwd);
	if (!existsSync(path)) return { enabled: false, path };
	try {
		const data = JSON.parse(readFileSync(path, "utf8"));
		if (data?.enabled === true && data.expiresAt) {
			const exp = Date.parse(data.expiresAt);
			if (!Number.isNaN(exp) && Date.now() > exp) {
				return { enabled: false, path, expired: true, data };
			}
		}
		return { enabled: data?.enabled === true, path, data };
	} catch {
		return { enabled: false, path, malformed: true };
	}
}

export function yoloOn(cwd, { hours } = {}) {
	const dir = join(cwd, ".heli-harness", "state");
	if (!existsSync(join(cwd, ".heli-harness", "HARNESS.md"))) {
		throw new Error(`No Heli-Harness install at ${cwd} (missing .heli-harness/HARNESS.md)`);
	}
	mkdirSync(dir, { recursive: true });
	const payload = {
		enabled: true,
		enabledAt: new Date().toISOString(),
		enabledBy: "heli yolo on",
		note: "Opt-in unguarded mode: Heli PreToolUse skips git-push/.env/stuck-task gates. Not a sandbox. Disable with: heli yolo off",
	};
	if (hours && Number(hours) > 0) {
		payload.expiresAt = new Date(Date.now() + Number(hours) * 3600_000).toISOString();
	}
	writeFileSync(yoloPath(cwd), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
	return payload;
}

export function yoloOff(cwd) {
	const path = yoloPath(cwd);
	if (existsSync(path)) unlinkSync(path);
	return { enabled: false, path };
}

export function yoloStatus(cwd) {
	const file = readYolo(cwd);
	const envYolo = /^(1|true|yes|on)$/i.test(String(process.env.HELI_YOLO ?? "").trim());
	const envGuardsOff = /^(0|false|off|disabled|yolo|none)$/i.test(String(process.env.HELI_GUARDS ?? "").trim());
	const allowPush = /^(1|true|yes|on)$/i.test(String(process.env.HELI_ALLOW_GIT_PUSH ?? "").trim());
	const allowEnv = /^(1|true|yes|on)$/i.test(String(process.env.HELI_ALLOW_ENV_WRITE ?? "").trim());
	const active = file.enabled || envYolo || envGuardsOff;
	return {
		active,
		file: file.enabled,
		filePath: file.path,
		expired: !!file.expired,
		env: { HELI_YOLO: envYolo, HELI_GUARDS_off: envGuardsOff, HELI_ALLOW_GIT_PUSH: allowPush, HELI_ALLOW_ENV_WRITE: allowEnv },
		data: file.data || null,
	};
}

/**
 * CLI: heli yolo on|off|status [path] [--hours N]
 */
export function runYolo(args) {
	const sub = (args[0] || "status").toLowerCase();
	let hours;
	const rest = [];
	for (let i = 1; i < args.length; i++) {
		if (args[i] === "--hours" && args[i + 1]) {
			hours = Number(args[++i]);
		} else {
			rest.push(args[i]);
		}
	}
	const cwd = rest[0] || process.cwd();

	if (sub === "on" || sub === "enable") {
		const data = yoloOn(cwd, { hours });
		console.log(`Heli YOLO ON for ${cwd}`);
		console.log(`  file: ${yoloPath(cwd)}`);
		if (data.expiresAt) console.log(`  expires: ${data.expiresAt}`);
		console.log("  PreToolUse will skip git-push / .env / stuck-task gates until you run: heli yolo off");
		console.log("  Shell alternative: set HELI_YOLO=1 for this process only.");
		return;
	}
	if (sub === "off" || sub === "disable") {
		yoloOff(cwd);
		console.log(`Heli YOLO OFF for ${cwd}`);
		console.log("  (HELI_YOLO / HELI_GUARDS env vars are unchanged — unset them in your shell if set.)");
		return;
	}
	if (sub === "status" || sub === "show") {
		const s = yoloStatus(cwd);
		console.log(`Heli YOLO status for ${cwd}`);
		console.log(`  active: ${s.active}`);
		console.log(`  file enabled: ${s.file}${s.expired ? " (expired)" : ""}`);
		console.log(`  file path: ${s.filePath}`);
		console.log(`  env HELI_YOLO: ${s.env.HELI_YOLO}`);
		console.log(`  env HELI_GUARDS off: ${s.env.HELI_GUARDS_off}`);
		console.log(`  env HELI_ALLOW_GIT_PUSH: ${s.env.HELI_ALLOW_GIT_PUSH}`);
		console.log(`  env HELI_ALLOW_ENV_WRITE: ${s.env.HELI_ALLOW_ENV_WRITE}`);
		if (s.data) console.log(`  file data: ${JSON.stringify(s.data)}`);
		return;
	}

	console.error("Usage: heli yolo <on|off|status> [path] [--hours N]");
	process.exit(1);
}
