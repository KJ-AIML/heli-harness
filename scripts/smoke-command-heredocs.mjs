#!/usr/bin/env node
/**
 * Here-documents a command only reads as data are text, and bash text is matched the way bash reads it.
 *
 * `git commit -F - <<'EOF'` with a message that mentions `rm -rf`, or `cat > clean.sh <<'EOF'` holding a script, used to be
 * a T6 hard deny that nothing could lift: every line of the body was read as a command. And the Windows reading of bash
 * text (where `\"` ends a quote) turned `git commit -m "a \" rm -rf b"` into one. For the text of a tool named for bash:
 *
 *  1. posixHeredocs lists the here-documents bash reads, with where each body starts and ends;
 *  2. a body is left out of the analysis only when nothing in the command can run it (see dropDataHeredocs): a body fed to
 *     a shell, a loop, a pipe or a descriptor into one, or with `$(...)` the shell expands, is still read; text of a shell
 *     that is not known is read as before;
 *  3. the same through the whole PreToolUse hook (the push gate and the protected-state check still read the command line);
 *  4. against the real bash, with stubs for rm, git, cat and sh: whatever bash runs is still found. Skipped, and said so,
 *     where bash is not installed.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeCommand, commandRunsGitPush, matchCommandRules, shellWriteTargets } from "../.heli-harness/adapters/shared/command-policy.mjs";
import { evaluatePreToolUse } from "../.heli-harness/adapters/shared/hook-core.mjs";
import { posixHeredocs, stripComments } from "../.heli-harness/adapters/shared/shell-comments.mjs";
import { scrubHeliProcessEnv } from "./lib/hermetic-env.mjs";
import { findShell, shellRuns } from "./lib/shell-differential.mjs";

scrubHeliProcessEnv();
const root = process.cwd();
const scratch = mkdtempSync(join(tmpdir(), "heli-command-heredocs-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
const env = { ...process.env, HELI_CONFIG_DIR: join(scratch, "config"), HELI_DATA_DIR: join(scratch, "data") };

// ------------------------------------------------------------------ 1. posixHeredocs
{
	const text = "cat > a <<'EOF'\nx\nEOF\necho done";
	const [heredoc, ...rest] = posixHeredocs(text);
	assert.equal(rest.length, 0);
	assert.equal(heredoc.delimiter, "EOF");
	assert.equal(heredoc.quoted, true);
	assert.equal(heredoc.plain, true);
	assert.equal(text.slice(heredoc.operator, heredoc.operator + 2), "<<");
	assert.equal(text.slice(heredoc.bodyStart, heredoc.bodyEnd), "x\nEOF\n");
	assert.equal(text.slice(heredoc.bodyEnd), "echo done");
}
for (const [text, expected] of [
	["cat <<EOF\nx\nEOF", [{ delimiter: "EOF", quoted: false, plain: true }]],
	["cat <<\"EOF\"\nx\nEOF", [{ delimiter: "EOF", quoted: true, plain: true }]],
	["cat <<\\EOF\nx\nEOF", [{ delimiter: "EOF", quoted: true, plain: true }]],
	["cat <<-'END_1'\n\tx\n\tEND_1", [{ delimiter: "END_1", quoted: true, plain: true, stripTabs: true }]],
	["cat <<$'EOF'\nx\nEOF", [{ delimiter: "$EOF", quoted: true, plain: false }]],
	["cat <<'A' <<'B'\na\nA\nb\nB", [{ delimiter: "A" }, { delimiter: "B" }]],
	["cat <<EOF # note\nx\nEOF", [{ delimiter: "EOF" }]],
	["echo \"$(cat <<'EOF'\nx\nEOF\n)\"", []], // inside a substitution: its output may be run
	["echo `cat <<EOF\nx\nEOF\n`", []],
	["echo '<<EOF'\nx\nEOF", []], // quoted: no here-document
	["cat <<< 'here string'", []],
	["echo no here-document", []],
]) {
	const found = posixHeredocs(text);
	assert.equal(found.length, expected.length, JSON.stringify(text));
	expected.forEach((fields, index) => {
		for (const [key, value] of Object.entries(fields)) assert.equal(found[index][key], value, `${JSON.stringify(text)} ${key}`);
	});
}
{
	const text = "cat <<'A' <<'B'\na\nA\nb\nB\nls";
	const [a, b] = posixHeredocs(text);
	assert.equal(text.slice(a.bodyStart, a.bodyEnd), "a\nA\n");
	assert.equal(text.slice(b.bodyStart, b.bodyEnd), "b\nB\n");
	assert.equal(text.slice(b.bodyEnd), "ls");
}
assert.equal(posixHeredocs("cat <<EOF\nnever ends\nls").at(0).bodyEnd, "cat <<EOF\nnever ends\nls".length, "an unterminated body runs to the end, as in bash");
assert.equal(posixHeredocs(`${"\"$(".repeat(40)}cat <<EOF`), null, "nested past the limit: null, for the caller to refuse");
// The comment stripper reads here-documents the same way it always did.
assert.equal(stripComments("cat <<EOF # note\nbody # kept\nEOF\n# after", "posix"), "cat <<EOF \nbody # kept\nEOF\n");

// ------------------------------------------------------------------ 2. the analysis
const RM = "rm -rf t9";
// "rm" for the recursive delete the cases use, "t6" for any other hard deny, "push" for the push gate; "clean" for none.
const verdict = (text, comments = "posix") => {
	const analysis = analyzeCommand(text, { comments });
	if (analysis.limitExceeded) return "too-complex";
	const hard = matchCommandRules(analysis).filter((match) => match.tier === "T6").map((match) => match.id);
	const found = [];
	if (hard.includes("destructive-delete")) found.push("rm");
	if (hard.some((id) => id !== "destructive-delete")) found.push("t6");
	if (commandRunsGitPush(analysis)) found.push("push");
	return found.join("+") || "clean";
};

// Data: the body is text the command reads, and nothing in the command runs it.
const DATA = [
	["git commit -F - <<'EOF'\nfix: stop using rm -rf in cleanup\n\nrun git push after review\nEOF", "clean"],
	["git commit -F - <<EOF\nfix: never rm -rf the cache\nEOF", "clean"], // unquoted, but nothing to expand
	["git tag -a v1 -F - <<'EOF'\nrelease notes: git reset --hard is gone\nEOF", "clean"],
	[`cat > clean.sh <<'EOF'\n#!/bin/sh\n${RM} dist\nEOF`, "clean"],
	["cat >> notes.md <<'EOF'\n- git push --force is blocked\nEOF", "clean"],
	["tee docs/x.md <<'EOF' >/dev/null\nrm -rf build && git push\nEOF", "clean"],
	["gh pr create --title fix --body-file - <<'EOF'\nThen git push origin main.\nEOF", "clean"],
	["gh issue create -t x -F - <<'EOF'\nrm -rf / happened\nEOF", "clean"],
	["cat <<-'EOF' > a.txt\n\trm -rf a\n\tEOF", "clean"],
	["cat > a <<'A' && cat > b <<'B'\nrm -rf a\nA\ngit push\nB", "clean"],
	["mkdir -p d && cd d && cat > x.sh <<'EOF'\nrm -rf x\nEOF\nchmod +x x.sh", "clean"],
	["cat > big.md <<'EOF'\n" + Array.from({ length: 300 }, (_, i) => `w${i}`).join(" ") + "\nEOF", "clean"], // one 300-word line
	// The command line itself is still read: what it runs outside the body is found.
	["git add -A && git commit -F - <<'EOF'\nfix: rm -rf\nEOF\ngit push origin feat/x", "push"],
	["cat > a <<'EOF' && git push\nbody\nEOF", "push"],
];
// Read: the body may be run, or the command is not one this reading trusts, so the body is read as commands.
const READ = [
	[`bash <<'EOF'\n${RM}\nEOF`, "rm"],
	[`sh -s <<'EOF'\n${RM}\nEOF`, "rm"],
	[`cat <<'EOF' | sh\n${RM}\nEOF`, "rm"],
	[`cat <<'EOF' |& sh\n${RM}\nEOF`, "rm"],
	[`cat <<'EOF' | tee x | sh\n${RM}\nEOF`, "rm"],
	[`while read -r c; do $c; done <<'EOF'\n${RM}\nEOF`, "rm"],
	[`xargs -I{} sh -c {} <<'EOF'\n${RM}\nEOF`, "rm"],
	[`eval "$(cat <<'EOF'\n${RM}\nEOF\n)"`, "rm"],
	[`source /dev/stdin <<'EOF'\n${RM}\nEOF`, "rm"],
	[`. /dev/stdin <<'EOF'\n${RM}\nEOF`, "rm"],
	[`cat <<EOF\n$(${RM})\nEOF`, "rm"], // unquoted: bash runs the substitution
	[`cat <<EOF\n\`${RM}\`\nEOF`, "rm"],
	[`cat <<EOF\n\${x:-$(${RM})}\nEOF`, "rm"],
	[`cat <<'EOF' > >(sh)\n${RM}\nEOF`, "rm"],
	[`exec 3> >(sh); cat <<'EOF' >&3\n${RM}\nEOF`, "rm"],
	[`cat <<'EOF' > /dev/fd/3\n${RM}\nEOF`, "rm"],
	[`GIT_EDITOR=sh git commit -e -F - <<'EOF'\n${RM}\nEOF`, "rm"],
	[`git -c alias.x='!sh' x <<'EOF'\n${RM}\nEOF`, "rm"],
	[`git config alias.x '!sh' && git x <<'EOF'\n${RM}\nEOF`, "rm"],
	[`git x <<'EOF'\n${RM}\nEOF`, "rm"], // not a subcommand known to read stdin as data
	[`gh myext <<'EOF'\n${RM}\nEOF`, "rm"], // may be an extension
	[`sudo cat <<'EOF'\n${RM}\nEOF`, "rm"],
	[`cat > x.sh <<'EOF'\n${RM}\nEOF\nsh x.sh`, "rm"],
	[`cat > x.sh <<'EOF'\n${RM}\nEOF\nnpm test`, "rm"], // a neighbour this reading does not know
	[`cat <<$'EOF'\nx\nEOF\n${RM}`, "rm"], // delimiter not plain: where the body ends is in doubt
	[`cat <<'EOF'\nx\nEOF\n${RM}`, "rm"], // after the body
	[`cat <<'EOF' && ${RM}\nx\nEOF`, "rm"], // on the line that opens it
	[`{ cat <<'EOF'; } | sh\n${RM}\nEOF`, "rm"],
	[`( cat <<'EOF' ) | sh\n${RM}\nEOF`, "rm"],
];
for (const [text, expected] of [...DATA, ...READ]) {
	assert.equal(verdict(text), expected, `bash: ${JSON.stringify(text)}`);
}
// A shell that is not known is read as before: every body line is a command.
for (const [text] of DATA.slice(0, 8)) {
	assert.notEqual(verdict(text, null), "clean", `unknown shell: ${JSON.stringify(text)}`);
}
assert.equal(verdict(DATA[11][0], null), "too-complex", "unknown shell: a 300-word body line is still over the budget");

// The Windows reading of bash text no longer reaches the rules; a real command after a quote is still found.
for (const [text, bash, unknown] of [
	["git commit -m \"docs: never use \\\" rm -rf dist\"", "clean", "rm"],
	["node -e \"\nconst s = \\\"rm -rf x\\\";\nconsole.log(s)\n\"", "clean", "rm"],
	["echo \"a \\\"\"; rm -rf x", "rm", "rm"],
	["git push origin \"$(echo \\\")\"", "push", "push"],
]) {
	assert.equal(verdict(text), bash, `bash: ${JSON.stringify(text)}`);
	assert.equal(verdict(text, null), unknown, `unknown shell: ${JSON.stringify(text)}`);
}
// The push gate and Heli's own protection still read it: a push, or an agent approving itself, is refused in any spelling.
for (const [text, expected] of [
	["node C:\\tools\\heli\\bin\\heli.mjs grant issue --action git.push", "t6"],
	["node 'C:\\tools\\heli\\bin\\heli.mjs' yolo on", "t6"],
	["git `\npush origin main", "push"],
	["git commit -m \"docs: \\\" then git push\"", "push"], // strict on purpose: a push is never read past
]) {
	assert.equal(verdict(text), expected, `bash: ${JSON.stringify(text)}`);
}
assert.ok(
	matchCommandRules(analyzeCommand("git `\npush --force origin main", { comments: "posix" })).some((match) => match.id === "git-push-force"),
	"the force-push rule reads every spelling too",
);
// ...and it still feeds the write-target check, as before.
{
	const text = "echo {} > C:\\Users\\me\\.heli\\grants.json";
	const paths = shellWriteTargets(analyzeCommand(text, { comments: "posix" })).map((target) => target.path);
	assert.ok(paths.includes("C:\\Users\\me\\.heli\\grants.json"), JSON.stringify(paths));
	assert.equal(analyzeCommand(text, { comments: "posix" }).segments.some((segment) => segment.dialect === "windows"), false);
}
// The line that opens a data here-document is still read for what it writes.
for (const [text, path] of [
	["cat > .heli-harness/state/yolo.json <<'EOF'\n{\"enabled\":true}\nEOF", ".heli-harness/state/yolo.json"],
	["tee .env <<'EOF'\nTOKEN=x\nEOF", ".env"],
]) {
	const paths = shellWriteTargets(analyzeCommand(text, { comments: "posix" })).map((target) => target.path);
	assert.ok(paths.includes(path), `${JSON.stringify(text)}: ${JSON.stringify(paths)}`);
}

// ------------------------------------------------------------------ 3. the hook
function workspace(name) {
	const dir = join(scratch, name);
	mkdirSync(join(dir, ".heli-harness", "state"), { recursive: true });
	mkdirSync(join(dir, ".heli-harness", "safety"), { recursive: true });
	writeFileSync(join(dir, ".heli-harness", "HARNESS.md"), "# Heli\n");
	writeFileSync(join(dir, ".heli-harness", "state", "current-task.md"), "# Current Task\n\nTarget repo: demo\n\nCurrent status: in progress\n\nFailed attempts count: 0\n");
	writeFileSync(join(dir, ".heli-harness", "safety", "command-rules.json"), readFileSync(join(root, ".heli-harness", "safety", "command-rules.json"), "utf8"));
	return dir;
}
const dir = workspace("ws");
const run = (toolName, command) => evaluatePreToolUse({ cwd: dir, host: "test", env, toolName, toolInput: { command } });
const hookVerdict = (result) => (result.deny ? result.code : "allow");
for (const [toolName, command, expected] of [
	["Bash", DATA[0][0], "allow"],
	["Bash", DATA[3][0], "allow"],
	["Bash", DATA[6][0], "allow"],
	["Bash", DATA[11][0], "allow"],
	["Bash", "git commit -m \"docs: never use \\\" rm -rf dist\"", "allow"],
	["Bash", DATA[12][0], "REMOTE_PUSH_DENIED"],
	["Bash", READ[0][0], "TIER_BLOCKED"],
	["Bash", READ[2][0], "TIER_BLOCKED"],
	["Bash", READ[7][0], "TIER_BLOCKED"],
	["Bash", READ[16][0], "TIER_BLOCKED"],
	["Bash", "cat > .heli-harness/state/yolo.json <<'EOF'\n{\"enabled\":true}\nEOF", "HELI_STATE_PROTECTED"],
	["Bash", "tee .env <<'EOF'\nTOKEN=x\nEOF", "ENV_WRITE_DENIED"],
	["shell", DATA[0][0], "TIER_BLOCKED"], // a shell tool that names no shell: read as before
	["mcp__shell__run", DATA[0][0], "TIER_BLOCKED"],
]) {
	assert.equal(hookVerdict(run(toolName, command)), expected, `${toolName}: ${JSON.stringify(command).slice(0, 80)}`);
}
{
	const message = Array.from({ length: 200 }, (_, i) => `line ${i}: rm -rf build, git push --force, git reset --hard`).join("\n");
	const startedAt = Date.now();
	assert.equal(hookVerdict(run("Bash", `git commit -F - <<'EOF'\n${message}\nEOF`)), "allow");
	assert.ok(Date.now() - startedAt < 3000, `a 200-line commit message took ${Date.now() - startedAt} ms`);
}

// ------------------------------------------------------------------ 4. against the real bash
// Only cases whose programs are all stubbed (rm, git, npm, cat, sh) or builtins are run: nothing here can delete or push.
const found = findShell("posix");
let differential = "skipped (no bash)";
if (found.bin) {
	const runnable = [
		...DATA.map(([text, expected]) => ({ text, expected, data: true })),
		...READ.filter(([text]) => !/^(bash|xargs|sudo|gh|git -c|git config|GIT_EDITOR)|>\(|exec 3|\/dev\/fd/.test(text)).map(([text, expected]) => ({ text, expected, data: false })),
	];
	// `chmod`, `mkdir`, `tee`, `cd` and redirections touch only the scratch directory the stub runner works in.
	const runs = shellRuns("posix", found.bin, runnable.map(({ text }) => text));
	let ranRm = 0;
	runnable.forEach(({ text, data }, index) => {
		const ran = runs[index];
		const seen = verdict(text);
		if (ran.rmrf) {
			ranRm += 1;
			assert.match(seen, /rm/, `bash ran the rm in ${JSON.stringify(text)}, the analysis must show it\n${ran.log}`);
		}
		if (ran.push) assert.match(seen, /push/, `bash ran the push in ${JSON.stringify(text)}, the analysis must show it\n${ran.log}`);
		if (data) assert.equal(ran.rmrf, false, `a data body is not run: ${JSON.stringify(text)}\n${ran.log}`);
	});
	assert.ok(ranRm >= 8, `the corpus makes bash run the body of the cases it reads (${ranRm})`);
	differential = `${runnable.length} cases through bash, ${ranRm} ran a delete, none missed`;
}

console.log(`command heredocs smoke ok (${DATA.length} data, ${READ.length} read; ${differential})`);
