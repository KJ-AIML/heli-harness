#!/usr/bin/env node
/**
 * Prove install never copies package operational dogfood into a fresh workspace.
 */
import assert from "node:assert/strict";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { install } from "../lib/cli/install.mjs";
import { assertCleanInstall } from "../lib/cli/seed-workspace.mjs";
import { buildSessionContext } from "../.heli-harness/adapters/shared/hook-core.mjs";

const root = process.cwd();
const realSource = join(root, ".heli-harness");

// Build a deliberately polluted source harness
const pollutedRoot = mkdtempSync(join(tmpdir(), "heli-polluted-pkg-"));
const pollutedHarness = join(pollutedRoot, ".heli-harness");
cpSync(realSource, pollutedHarness, { recursive: true, force: true });

// Inject unmistakable pollution markers
mkdirSync(join(pollutedHarness, "state"), { recursive: true });
mkdirSync(join(pollutedHarness, "sessions"), { recursive: true });
mkdirSync(join(pollutedHarness, "tasks", "docs-overhaul"), { recursive: true });
mkdirSync(join(pollutedHarness, "locks", "tasks", "docs-overhaul.write.lock"), { recursive: true });
mkdirSync(join(pollutedHarness, "bindings", "worktrees"), { recursive: true });
mkdirSync(join(pollutedHarness, "state", "reports"), { recursive: true });

const MARKERS = [
	"DOCS_OVERHAUL_POLLUTION_MARKER",
	"heli-harness-polluted-target",
	"C:/fake/machine/path/pollution",
	"heli-ses-pollution-session",
	"heli-lease-pollution",
];

writeFileSync(
	join(pollutedHarness, "state", "current-task.md"),
	`# Current Task\n\nTask: docs-overhaul\n\nCurrent status: in progress\n\nFailed attempts count: 2\n\nNotes: ${MARKERS[0]}\n`,
);
writeFileSync(
	join(pollutedHarness, "state", "plan.md"),
	`# Plan: Pollution\n\n## Step 1\n\nStatus: pending\n\nEvidence:\n- ${MARKERS[0]}\n`,
);
writeFileSync(
	join(pollutedHarness, "state", "yolo.json"),
	JSON.stringify({ enabled: true, note: MARKERS[0] }, null, 2),
);
writeFileSync(
	join(pollutedHarness, "workspace", "target.json"),
	JSON.stringify(
		{
			schemaVersion: 1,
			targetRepo: "heli-harness-polluted-target",
			targetGitRoot: "C:/fake/machine/path/pollution",
			writesAllowedUnder: "C:/fake/machine/path/pollution",
			activeProfile: ".heli-harness/profiles/heli-harness.md",
			selectedAt: "2099-01-01",
			selectedBy: "pollution",
			reason: MARKERS[0],
		},
		null,
		2,
	),
);
writeFileSync(
	join(pollutedHarness, "sessions", "heli-ses-pollution-session.json"),
	JSON.stringify({ sessionId: "heli-ses-pollution-session", taskId: "docs-overhaul", status: "active" }),
);
writeFileSync(
	join(pollutedHarness, "tasks", "docs-overhaul", "task.json"),
	JSON.stringify({ taskId: "docs-overhaul", title: MARKERS[0], status: "active", revision: 1 }),
);
writeFileSync(
	join(pollutedHarness, "locks", "tasks", "docs-overhaul.write.lock", "lease.json"),
	JSON.stringify({ leaseId: "heli-lease-pollution", sessionId: "heli-ses-pollution-session", taskId: "docs-overhaul" }),
);
writeFileSync(
	join(pollutedHarness, "state", "reports", "pollution-report.md"),
	`# Report\n\n${MARKERS[0]}\n`,
);

const dest = mkdtempSync(join(tmpdir(), "heli-clean-dest-"));
try {
	// Node CLI install API
	install(pollutedHarness, dest);
	const installed = join(dest, ".heli-harness");
	const problems = assertCleanInstall(installed, { forbiddenSubstrings: MARKERS });
	assert.equal(problems.length, 0, `clean install pollution: ${problems.join("; ")}`);

	const taskText = readFileSync(join(installed, "state", "current-task.md"), "utf8");
	assert.match(taskText, /idle/i);
	assert.doesNotMatch(taskText, /docs-overhaul/);
	assert.ok(!existsSync(join(installed, "state", "plan.md")));
	assert.ok(!existsSync(join(installed, "state", "yolo.json")));
	assert.ok(!existsSync(join(installed, "tasks", "docs-overhaul")));
	assert.ok(!existsSync(join(installed, "sessions", "heli-ses-pollution-session.json")));

	const target = JSON.parse(readFileSync(join(installed, "workspace", "target.json"), "utf8"));
	assert.equal(target.targetRepo, "");

	// SessionStart must not inject pollution markers
	const ctx = buildSessionContext(dest, { host: "test", createIfMissing: false });
	for (const m of MARKERS) {
		assert.ok(!ctx.includes(m), `SessionStart leaked marker: ${m}`);
	}
	assert.ok(!/docs-overhaul/i.test(ctx), "SessionStart must not mention polluted task");
	console.log("smoke-clean-install: node install API ok");

	// bin/heli.mjs install path
	const dest2 = mkdtempSync(join(tmpdir(), "heli-clean-bin-"));
	try {
		// install from polluted package root: need polluted package layout with bin
		const pkg = mkdtempSync(join(tmpdir(), "heli-polluted-binpkg-"));
		cpSync(join(root, "bin"), join(pkg, "bin"), { recursive: true });
		cpSync(join(root, "lib"), join(pkg, "lib"), { recursive: true });
		// point bin install at polluted harness: overwrite package .heli-harness
		cpSync(pollutedHarness, join(pkg, ".heli-harness"), { recursive: true, force: true });
		const r = spawnSync(process.execPath, [join(pkg, "bin", "heli.mjs"), "install", dest2], {
			encoding: "utf8",
		});
		assert.equal(r.status, 0, r.stderr || r.stdout);
		const problems2 = assertCleanInstall(join(dest2, ".heli-harness"), {
			forbiddenSubstrings: MARKERS,
		});
		assert.equal(problems2.length, 0, problems2.join("; "));
		console.log("smoke-clean-install: bin/heli.mjs install ok");
	} finally {
		rmSync(dest2, { recursive: true, force: true });
	}

	// PowerShell / Bash delegate to node — verify scripts call heli.mjs
	const sh = readFileSync(join(root, "install.sh"), "utf8");
	assert.match(sh, /heli\.mjs["']?\s+install|heli\.mjs" install/);
	assert.match(sh, /bin\/heli\.mjs/);
	const ps = readFileSync(join(root, "install.ps1"), "utf8");
	assert.match(ps, /heli\.mjs/);
	assert.match(ps, /install/);
	console.log("smoke-clean-install: shell wrappers delegate to node ok");
} finally {
	rmSync(dest, { recursive: true, force: true });
	rmSync(pollutedRoot, { recursive: true, force: true });
}

console.log("smoke-clean-install: ok");
