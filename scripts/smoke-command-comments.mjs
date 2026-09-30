#!/usr/bin/env node
/**
 * Comments in shell text are not commands, and nothing else is a comment.
 *
 * `npm test # then git push` and `# never rm -rf here` used to be hard denies that nothing could lift, because the
 * analysis read the comment as a command. Comments are now left out before the analysis, but only where the shell that
 * runs the text is known and only what that shell really ignores: text the shell RUNS must never be dropped (a
 * bypass), so `echo a#b; rm -rf x`, `echo "#"; rm -rf x` and `rm -rf x # note` stay denied, and anything unknown
 * (an MCP server, Monitor, cmd, a host's own shell tool) is read whole.
 *
 *  1. the stripper (shell-comments.mjs): what goes, what stays, how deep it reads, how fast;
 *  2. the analysis and the hook: the same text gives the verdict of the same text without its comments;
 *  3. against the real shells: each table row is run with and without its comments, and a corpus generated like Task 3's
 *     (one case per shape, then random ones with `node scripts/smoke-command-comments.mjs --cases 300 --seed 9`)
 *     is run through bash and PowerShell with stubs for rm, git and Remove-Item. Skipped, and said so, where a shell
 *     is not installed.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as policy from "../.heli-harness/adapters/shared/command-policy.mjs";
import { evaluatePreToolUse, isLikelyShellMutation, shellCommentSyntax } from "../.heli-harness/adapters/shared/hook-core.mjs";
import { MAX_SYNTAX_DEPTH, stripComments } from "../.heli-harness/adapters/shared/shell-comments.mjs";
import { scrubHeliProcessEnv } from "./lib/hermetic-env.mjs";
import { findShell, runDifferential, shellRuns } from "./lib/shell-differential.mjs";

const { COMMAND_ANALYSIS_LIMITS, analyzeCommand, commandRunsGitPush, matchCommandRules } = policy;

scrubHeliProcessEnv();
const root = process.cwd();
const scratch = mkdtempSync(join(tmpdir(), "heli-command-comments-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
const env = { ...process.env, HELI_CONFIG_DIR: join(scratch, "config"), HELI_DATA_DIR: join(scratch, "data") };
const argument = (name, fallback) => {
	const at = process.argv.indexOf(`--${name}`);
	return at === -1 ? fallback : Number(process.argv[at + 1]);
};

// ------------------------------------------------------------------ 1. the stripper
// [shell, text, what is left]: the comment goes to the end of its line (a block comment becomes one space), the rest stays.
const STRIPPED = [
	["posix", "ls # note", "ls "],
	["posix", "# only a comment", ""],
	["posix", "echo a #b\nrm x", "echo a \nrm x"],
	["posix", "echo a;#b\nls", "echo a;\nls"],
	["posix", "echo a && #b\nls", "echo a && \nls"],
	["posix", "(#c\nls)", "(\nls)"],
	["posix", "{ #c\nls; }", "{ \nls; }"],
	["posix", "x=1 # c", "x=1 "],
	["posix", "echo ${x#a} # c", "echo ${x#a} "],
	["posix", "echo $# ${#x} # c", "echo $# ${#x} "],
	["posix", "echo $((2#101)) # c", "echo $((2#101)) "],
	["posix", "[[ $x == \"#\"* ]] # c\nls", "[[ $x == \"#\"* ]] \nls"],
	["posix", "echo 'it'\\''s' # c", "echo 'it'\\''s' "],
	["posix", "echo $'it\\'s' # c", "echo $'it\\'s' "],
	["posix", "case x in\n # c\n x) ls;;\nesac", "case x in\n \n x) ls;;\nesac"],
	["posix", "cat <<EOF # note\nbody\nEOF\n# after", "cat <<EOF \nbody\nEOF\n"],
	["posix", "cat <<-EOF\n\t# body\n\tEOF\n# after", "cat <<-EOF\n\t# body\n\tEOF\n"],
	["posix", "echo a \\\n#b\nls", "echo a \\\n\nls"],
	["powershell", "Get-ChildItem # note", "Get-ChildItem "],
	["powershell", "<# block #> Get-ChildItem", "  Get-ChildItem"],
	["powershell", "Get-ChildItem <#\nmany\nlines\n#> Write-Host hi", "Get-ChildItem   Write-Host hi"],
	["powershell", "Write-Host a; #c\nGet-ChildItem", "Write-Host a; \nGet-ChildItem"],
	["powershell", "if ($true) { # c\n Get-ChildItem }", "if ($true) { \n Get-ChildItem }"],
	["powershell", "$x = @{ a = 1 # c\n b = 2 }", "$x = @{ a = 1 \n b = 2 }"],
	["powershell", "Write-Host 'a' # it's a comment", "Write-Host 'a' "],
];
for (const [shell, text, expected] of STRIPPED) {
	assert.equal(stripComments(text, shell), expected, `${shell}: ${JSON.stringify(text)}`);
}

// [shell, text, what the real shell runs that a comment would have hidden]: text that only looks like a comment stays whole.
// Stripping any of these would be a bypass: the shell runs what follows the `#`.
const KEPT = [
	["posix", "echo a#b; rm -rf x", "rm"],
	["posix", "echo \"#\"; rm -rf x", "rm"],
	["posix", "echo '#' && git push origin main", "push"],
	["posix", "echo \\# && rm -rf x", "rm"],
	["posix", "echo $#; echo ${#x}; echo ${x#a}; echo $((2#101)); rm -rf x", "rm"],
	["posix", "echo $'it\\'s #b'; rm -rf x", "rm"],
	["posix", "echo 'it'\\''s #b'; rm -rf x", "rm"],
	["posix", "echo ${x:- #y}; rm -rf x", "rm"],
	["posix", "echo ${x/#a/b #c}; rm -rf x", "rm"],
	["posix", "echo $(echo a # b\n rm -rf x)", "rm"],
	["posix", "echo `echo a # b\n rm -rf x`", "rm"],
	["posix", "echo \"a $(echo b # c\n rm -rf x) d\"", "rm"],
	["posix", "cat <<EOF\n# a heredoc body line\nEOF\nrm -rf x", "rm"],
	["posix", "sh <<'EOF'\n# note\nrm -rf x\nEOF", "rm"],
	["posix", "echo a\\\n#b; rm -rf x", "rm"],
	["posix", "echo {a,#b}; rm -rf x", "rm"],
	["posix", "echo *#; rm -rf x", "rm"],
	["posix", "IFS=# read a b <<< \"x#y\"; rm -rf x", "rm"],
	["powershell", "Write-Host a#b; Remove-Item -Recurse -Force x", "rm"],
	["powershell", "Write-Host \"#\"; Remove-Item -Recurse -Force x", "rm"],
	["powershell", "Write-Host '#'; git push origin main", "push"],
	["powershell", "Write-Host `# x; Remove-Item -Recurse -Force x", "rm"],
	["powershell", "$s = @'\n# a here-string line\n'@; Remove-Item -Recurse -Force x", "rm"],
	// A here-string may hold quotes of its own kind, so what is inside it cannot be found by reading it as a string.
	["powershell", "$s = @'\nit's here\n# a here-string line\n'@; Remove-Item -Recurse -Force x", "rm"],
	["powershell", "$s = @\"\nsay \"hi\"\n# a here-string line\n\"@; Remove-Item -Recurse -Force x", "rm"],
	// An escaped space keeps the next word in the same token, so a `#` there is not a comment.
	["powershell", "Write-Host a` #b\nRemove-Item -Recurse -Force x", "rm"],
	["powershell", "Write-Host ${a#b}; Remove-Item -Recurse -Force x", "rm"],
	["powershell", "Write-Host --% # to the program\nRemove-Item -Recurse -Force x", "rm"],
	["powershell", "Write-Host ‘# smart quotes’; Remove-Item -Recurse -Force x", "rm"],
	["powershell", "Write-Host ‘a # b’; Remove-Item -Recurse -Force x", "rm"],
	["powershell", "Write-Host “a # b”; Remove-Item -Recurse -Force x", "rm"],
	["powershell", "Write-Host 'a # b'; Remove-Item -Recurse -Force x", "rm"],
	["powershell", "Write-Host \"a # $(1 + 1) b\"; Remove-Item -Recurse -Force x", "rm"],
	["powershell", "Write-Host \"a $(1 + 1 # c\n) b\"; Remove-Item -Recurse -Force x", "rm"],
	// Text that is not valid to the shell (it refuses the script) is kept whole too.
	["powershell", "Write-Host a <# never closed\nRemove-Item -Recurse -Force x", null],
];
for (const [shell, text] of KEPT) {
	assert.equal(stripComments(text, shell), text, `${shell}: ${JSON.stringify(text)} stays whole`);
}
// Any other shell, or none known, keeps everything.
for (const shell of [null, undefined, "cmd", "fish", ""]) {
	assert.equal(stripComments("echo a # rm -rf x\n<# y #>", shell), "echo a # rm -rf x\n<# y #>", `shell ${shell}`);
}
assert.equal(stripComments("", "posix"), "");
assert.equal(stripComments("no comment here", "powershell"), "no comment here");

// Reading nested text is bounded: JavaScript runs out of stack near 10,000 levels, so text nested more than
// MAX_SYNTAX_DEPTH levels is refused (null) instead of crashing the hook, at the level and not one before.
const nestedQuotes = (levels, tail = " #") => "\"$(".repeat(levels) + tail;
assert.equal(MAX_SYNTAX_DEPTH, COMMAND_ANALYSIS_LIMITS.maxSyntaxNesting);
assert.notEqual(stripComments(nestedQuotes(MAX_SYNTAX_DEPTH / 2), "posix"), null, "the deepest allowed level is read");
assert.equal(stripComments(nestedQuotes(MAX_SYNTAX_DEPTH / 2 + 1), "posix"), null, "one level deeper is refused");
assert.equal(stripComments(nestedQuotes(MAX_SYNTAX_DEPTH / 2, "\" #"), "posix"), null, "the limit counts every open quote, substitution and brace, one by one");
assert.notEqual(stripComments(nestedQuotes(MAX_SYNTAX_DEPTH / 2 - 1, "\" #"), "posix"), null);
assert.equal(stripComments(nestedQuotes(MAX_SYNTAX_DEPTH / 2 + 1), "powershell"), null);
assert.notEqual(stripComments(nestedQuotes(MAX_SYNTAX_DEPTH / 2 + 1), "posix", MAX_SYNTAX_DEPTH + 2), null, "the depth is a parameter");
assert.notEqual(stripComments(nestedQuotes(6000), null), null, "text of an unknown shell is not read at all");
assert.equal(stripComments(nestedQuotes(6000, ""), "posix"), nestedQuotes(6000, ""), "no # means nothing is read");
assert.doesNotThrow(() => stripComments(nestedQuotes(20000), "posix"), "deep text is refused, never a stack overflow");
assert.equal(stripComments("echo a # b", "posix"), "echo a ", "an earlier refusal leaves no state behind");

// Fast at the size limit: every scanner reads each character once. The bound is far above the milliseconds it takes and below
// what a scan that restarts (620 ms for `<# ` x16,000 before the fix) would take.
const within = (limitMs, label, fn) => {
	const startedAt = Date.now();
	const value = fn();
	const elapsed = Date.now() - startedAt;
	assert.ok(elapsed < limitMs, `${label} took ${elapsed} ms (limit ${limitMs} ms)`);
	return value;
};
const SIZE = COMMAND_ANALYSIS_LIMITS.maxCommandChars;
const at = (unit, tail = " #") => unit.repeat(Math.floor(SIZE / unit.length)) + tail;
for (const [label, shell, text] of [
	["<# x16,000", "powershell", at("<# ")],
	["a #b x16,000", "posix", at("a #")],
	["'x x24,000", "posix", at("'x")],
	["\"$( x16,000", "posix", at("\"$(")],
	["$( x24,000", "posix", at("$(")],
	["${ x24,000", "posix", at("${")],
	["<<a x12,000", "posix", at("<<a ")],
	["[[ x16,000", "posix", at("[[ ")],
	["`x x24,000", "posix", at("`x")],
	["$'\\ x16,000", "posix", at("$'\\")],
	["@' x16,000", "powershell", at("@'\n")],
	["\"$( x16,000 in PowerShell", "powershell", at("\"$(")],
	["${ x24,000 in PowerShell", "powershell", at("${")],
]) {
	within(300, label, () => stripComments(text, shell));
}

// ------------------------------------------------------------------ 2. the analysis and the hook
const rulesOf = (command, options) => matchCommandRules(analyzeCommand(command, options)).map((match) => match.id).sort();
// The text of a known shell is read without its comments, wherever that shell is named; the option is the shell of the text itself.
assert.deepEqual(rulesOf("ls # rm -rf x", { comments: "posix" }), []);
assert.deepEqual(rulesOf("ls # rm -rf x", { comments: null }), ["destructive-delete"], "a shell that is not known has its text read whole");
assert.deepEqual(rulesOf("ls # rm -rf x"), ["destructive-delete"], "and so does the default");
assert.deepEqual(rulesOf("echo a#b; rm -rf x", { comments: "posix" }), ["destructive-delete"]);
assert.deepEqual(rulesOf("Get-ChildItem <# Remove-Item -Recurse -Force x #>", { comments: "powershell" }), []);
assert.deepEqual(rulesOf("git <# a comment #> reset --hard", { comments: "powershell" }), ["git-reset-hard"], "PowerShell runs `git reset --hard` here; the block comment used to hide it");
assert.equal(commandRunsGitPush(analyzeCommand("git <# a comment #> push", { comments: "powershell" })), true);
assert.equal(commandRunsGitPush(analyzeCommand("echo hi # git push", { comments: "posix" })), false);
// The commands a known shell runs inside a command are read its way, whatever shell the outer text is: `bash -c` and `eval` are
// POSIX, `pwsh -Command` is PowerShell, `cmd /c` has no comments.
for (const [command, expected] of [
	["bash -c 'ls # rm -rf x'", []],
	["bash -c 'npm test # rm -rf x'", []],
	["sh -lc 'ls # git reset --hard'", []],
	["bash -c \"echo a#b; rm -rf x\"", ["destructive-delete"]],
	["bash -c 'echo hi\nrm -rf x # note'", ["destructive-delete"]],
	["eval 'ls # rm -rf x'", []],
	["eval \"echo a\" \"# b\"", []],
	["pwsh -Command \"Get-ChildItem # Remove-Item -Recurse -Force x\"", []],
	["powershell -Command \"Get-ChildItem <# Remove-Item -Recurse -Force x #>\"", []],
	["pwsh -Command \"Write-Host a#b; Remove-Item -Recurse -Force x\"", ["powershell-remove-item-recurse-force"]],
	["cmd /c \"echo hi # rm -rf x\"", ["destructive-delete"]],
	["ssh host 'rm -rf x # note'", ["destructive-delete"]],
	["su -c 'rm -rf x # note'", ["destructive-delete"]],
]) {
	assert.deepEqual(rulesOf(command), expected, command);
}
// A text with the comments taken out has the rules of the text that never had them.
assert.deepEqual(rulesOf("rm -rf x # note", { comments: "posix" }), rulesOf("rm -rf x"));

// The stripper's refusal is the analysis's: a fail-closed limit, not a crash.
const deep = analyzeCommand(nestedQuotes(MAX_SYNTAX_DEPTH / 2 + 1), { comments: "posix" });
assert.equal(deep.limitExceeded?.limit, "syntax-nesting");
assert.equal(deep.limitExceeded.max, MAX_SYNTAX_DEPTH);
assert.match(deep.limitExceeded.message, new RegExp(`nested more than ${MAX_SYNTAX_DEPTH} levels`));
assert.equal(analyzeCommand(nestedQuotes(MAX_SYNTAX_DEPTH / 2), { comments: "posix" }).limitExceeded, null);
assert.equal(analyzeCommand(nestedQuotes(MAX_SYNTAX_DEPTH / 2 + 1)).limitExceeded, null, "nothing is read for comments where the shell is not known");
assert.equal(analyzeCommand(`bash -c '${nestedQuotes(MAX_SYNTAX_DEPTH / 2 + 1)}'`).limitExceeded?.limit, "syntax-nesting", "an unwrapped bash -c payload is read the same way");

// shellCommentSyntax: only a tool named for its shell says which one it is.
for (const [toolName, expected] of [
	["Bash", "posix"], ["bash", "posix"], ["run_bash", "posix"], ["PowerShell", "powershell"], ["powershell", "powershell"], ["pwsh", "powershell"],
	["Monitor", null], ["shell", null], ["shell_command", null], ["terminal", null], ["run_command", null], ["local_shell", null], ["Write", null],
	["BashOutput", null], ["mcp__server__bash", null], ["mcp__server__run", null], ["mcp__powershell__run", null], ["", null], [undefined, null],
]) {
	assert.equal(shellCommentSyntax(toolName), expected, String(toolName));
}

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
const verdictOf = (result) => (result.deny ? result.code : "allow");

// What the ruling asked to keep denied, through the whole hook: text the shell runs is never taken for a comment.
for (const [toolName, command, expected] of [
	["Bash", "echo a#b; rm -rf x", "TIER_BLOCKED"],
	["Bash", "echo \"#\"; rm -rf x", "TIER_BLOCKED"],
	["Bash", "rm -rf x # note", "TIER_BLOCKED"],
	["Bash", "echo '#' && git push", "REMOTE_PUSH_DENIED"],
	["Bash", "git push # note", "REMOTE_PUSH_DENIED"],
	["Bash", "echo $(echo hi # note\n rm -rf x)", "TIER_BLOCKED"],
	["Bash", "echo `echo hi # note\n git reset --hard`", "TIER_BLOCKED"],
	["Bash", "bash <<EOF\n# note\nrm -rf x\nEOF", "TIER_BLOCKED"],
	["Bash", "cat <<EOF\n# a heredoc body line\nEOF\nrm -rf x", "TIER_BLOCKED"],
	["Bash", "echo $'it\\'s #b'; rm -rf x", "TIER_BLOCKED"],
	["Bash", "echo 'it'\\''s #b'; rm -rf x", "TIER_BLOCKED"],
	["Bash", "echo a\\\n#b; rm -rf x", "TIER_BLOCKED"],
	["Bash", "bash -c \"echo a#b; rm -rf x\"", "TIER_BLOCKED"],
	["Bash", "echo ok\n# fine\nrm -rf x", "TIER_BLOCKED"],
	["PowerShell", "Write-Host a#b; Remove-Item -Recurse -Force x", "TIER_BLOCKED"],
	["PowerShell", "Write-Host \"#\"; Remove-Item -Recurse -Force x", "TIER_BLOCKED"],
	["PowerShell", "Remove-Item -Recurse -Force x # note", "TIER_BLOCKED"],
	["PowerShell", "Write-Host '#'; git push", "REMOTE_PUSH_DENIED"],
	["PowerShell", "git <# note #> push", "REMOTE_PUSH_DENIED"],
	["PowerShell", "$s = @'\n# a here-string line\n'@; Remove-Item -Recurse -Force x", "TIER_BLOCKED"],
]) {
	assert.equal(verdictOf(run(toolName, command)), expected, `${toolName}: ${JSON.stringify(command)}`);
}
// ...and a comment is no longer a hard deny.
for (const [toolName, command] of [
	["Bash", "npm test # then git push"],
	["Bash", "# rm -rf x\nnpm test"],
	["Bash", "git status # never git push --force"],
	["Bash", "ls # git reset --hard"],
	["Bash", "echo hi # rm -rf x; git push"],
	["Bash", "bash -c 'npm test # rm -rf x'"],
	["Bash", "eval 'ls # rm -rf x'"],
	["Bash", "cat <<EOF # rm -rf x\nbody\nEOF"],
	["PowerShell", "Get-ChildItem # Remove-Item -Recurse -Force x"],
	["PowerShell", "<# Remove-Item -Recurse -Force x #> Get-ChildItem"],
	["PowerShell", "git status # git push"],
	["PowerShell", "pwsh -Command \"Get-ChildItem # Remove-Item -Recurse -Force x\""],
]) {
	assert.equal(verdictOf(run(toolName, command)), "allow", `${toolName}: ${JSON.stringify(command)}`);
}
// A shell that is not known keeps its comments: a server's `command`, Monitor, and a shell tool that names none.
for (const [toolName, command] of [
	["mcp__shell__run", "npm test # rm -rf x"],
	["Monitor", "npm test # rm -rf x"],
	["shell", "npm test # rm -rf x"],
	["Bash", "cmd /c \"echo hi # rm -rf x\""],
	["Bash", "ssh host 'rm -rf x # note'"],
]) {
	assert.equal(verdictOf(run(toolName, command)), "TIER_BLOCKED", `${toolName}: ${JSON.stringify(command)}`);
}
// Nested deeper than the stripper reads: a fail-closed deny with the standard wording, in a fraction of a second.
for (const toolName of ["Bash", "PowerShell"]) {
	const startedAt = Date.now();
	const result = run(toolName, nestedQuotes(6000));
	assert.equal(result.code, "COMMAND_TOO_COMPLEX", toolName);
	assert.equal(result.hardDeny, true);
	assert.match(result.reason, /^Heli-Harness could not evaluate this action \(COMMAND_TOO_COMPLEX: its quotes and substitutions are nested more than 64 levels deep\); denying \(fail-closed\)\./);
	assert.ok(Date.now() - startedAt < 5000, `${toolName} took ${Date.now() - startedAt} ms`);
}
assert.notEqual(verdictOf(run("mcp__shell__run", nestedQuotes(6000))), "COMMAND_TOO_COMPLEX", "no comments are read for a server, so no depth either");

// A comment is not a write either: the heuristic that asks for the task gate, a lease or a protected-path check reads the same text.
for (const [toolName, command, expected] of [
	["Bash", "ls # rm -rf build", false],
	["Bash", "ls # > out.txt", false],
	["Bash", "git status # git add x", false],
	["Bash", "# mv a b\nls", false],
	["Bash", "echo a#b; rm x", true],
	["Bash", "ls; rm x # note", true],
	["Bash", "echo \"# no\" > out.txt", true],
	["Bash", "cat <<EOF\n# body\nEOF\ntouch x", true],
	["PowerShell", "Get-ChildItem # Set-Content x y", false],
	["PowerShell", "<# Remove-Item x #> Get-ChildItem", false],
	["PowerShell", "Write-Host a#b; Set-Content x y", true],
	["PowerShell", "Get-ChildItem <# c #> ; Set-Content x y", true],
	["Monitor", "npm test # rm x", true], // Monitor's shell is not known, so its comment is read like text
	["shell", "ls # rm x", true],
	["Bash", nestedQuotes(6000), true],
]) {
	assert.equal(isLikelyShellMutation(toolName, command), expected, `${toolName}: ${JSON.stringify(command).slice(0, 60)}`);
}

// The hook stays fast on a long command with a comment on every line: the comment scan is one more linear pass.
const manyComments = "echo a # x\n".repeat(1500);
within(3000, "a command of 1,500 lines with a comment each", () => assert.equal(verdictOf(run("Bash", manyComments)), "allow"));

// ------------------------------------------------------------------ 3. against the real shells
const shells = { posix: findShell("posix"), powershell: findShell("powershell") };
const ran = [];
for (const [name, found] of Object.entries(shells)) {
	if (!found.bin) {
		console.log(`command comments: ${name} differential skipped (${found.reason})`);
		continue;
	}
	// Every table row, with its comments and without: the shell must do the same, and the KEPT rows must really run what a
	// wrong strip would have hidden.
	const stripped = STRIPPED.filter(([shell]) => shell === name);
	const kept = KEPT.filter(([shell]) => shell === name);
	const runs = shellRuns(name, found.bin, [...stripped.flatMap(([, text, expected]) => [text, expected]), ...kept.map(([, text]) => text)]);
	stripped.forEach(([, text], index) => {
		assert.equal(runs[index * 2].log, runs[index * 2 + 1].log, `${name}: the shell runs ${JSON.stringify(text)} the same without its comment`);
	});
	kept.forEach(([, text, marker], index) => {
		const result = runs[stripped.length * 2 + index];
		if (marker === "rm") assert.ok(result.rmrf, `${name}: the shell runs the rm in ${JSON.stringify(text)}\n${result.log}`);
		if (marker === "push") assert.ok(result.push, `${name}: the shell runs the push in ${JSON.stringify(text)}\n${result.log}`);
	});
	// The corpus: one case per shape, then the random cases asked for. Nothing the shell ran may be missed by the analysis of
	// the stripped text, and the analysis of the stripped text must find what the analysis of the comment-free text finds.
	const shapes = name === "posix" ? 63 : 42;
	const cases = argument("cases", shapes);
	const seed = argument("seed", 20260930);
	const startedAt = Date.now();
	const { tally, problems } = runDifferential({ shell: name, bin: found.bin, cases, seed, sweep: cases === shapes, verifyGenerator: cases !== shapes, stripComments, analysis: policy });
	ran.push(`${name} ${tally.exact}/${tally.cases} exact, ${tally.recallMisses} missed, ${tally.droppedCode} dropped, ${tally.keptComment} kept, ${tally.baselineFlaggedNotRun}->${tally.strippedFlaggedNotRun} flagged though not run (${Date.now() - startedAt} ms)`);
	const detail = problems.map((problem) => problem.join("\n   ")).join("\n");
	assert.equal(tally.generatorMismatch, 0, `${name}: the corpus is not comment-neutral in this shell\n${detail}`);
	assert.equal(tally.recallMisses, 0, `${name}: the analysis of the stripped text missed a command the shell ran\n${detail}`);
	assert.equal(tally.droppedCode, 0, `${name}: code was taken for a comment\n${detail}`);
	assert.equal(tally.keptComment, 0, `${name}: a comment was still read as a command\n${detail}`);
	assert.equal(tally.exact, tally.cases, `${name}: every case reads as its comment-free text\n${detail}`);
	assert.ok(tally.ranRm > 0 && tally.ranPush > 0, `${name}: the corpus runs both a delete and a push (${JSON.stringify(tally)})`);
}

console.log(`command comments smoke ok${ran.length ? ` (${ran.join("; ")})` : ""}`);
