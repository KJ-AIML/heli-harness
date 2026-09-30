/**
 * Differential check of comment stripping against the real shells.
 *
 * A random corpus is built from labelled pieces: code the shell runs, and comments it throws away. Each case is run through the
 * real shell twice, with the comments in and with them out, with stubs for rm, git and Remove-Item that log what they were asked
 * to do. Then, per case:
 *   1. generator: what the shell ran is the same with the comments in as with the comments out (else the corpus is wrong);
 *   2. recall (must never fail): what the shell ran (`rm -rf`, `git push`) is found by the analysis of the stripped text;
 *   3. exactness: the analysis of the stripped text finds what the analysis of the comment-free text finds. A miss in the safe
 *      direction (a comment still read as code) is `keptComment`; the unsafe one (code read as a comment) is `droppedCode`.
 * The text is only ever run by the stubs: nothing here deletes or pushes.
 *
 * Verified with GNU bash 5.3 (Git for Windows) and 5.2 (Debian), and with Windows PowerShell 5.1 and PowerShell 7.4. A shell that
 * is not installed is reported as unavailable, never as a pass.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A small seeded generator (mulberry32), so a failing corpus can be replayed from its seed. */
function createRandom(seed) {
	let state = seed | 0;
	const random = () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	return { random, pick: (list) => list[Math.floor(random() * list.length)], chance: (p) => random() < p };
}

// ------------------------------------------------------------------------------------------------ the corpus (POSIX)
const POSIX_SHAPES = 63;
const POWERSHELL_SHAPES = 42;
const RULE_WORDS_POSIX = ["rm -rf t9", "git push origin m9", "rm -rf /", "git push --force", "npm publish"];
const RULE_WORDS_PS = ["Remove-Item -Recurse -Force t9", "git push origin m9", "Remove-Item -Recurse -Force C:\\", "git push --force"];

function commentText({ random, pick, chance }, kind) {
	const junk = ["it's", "\"", "`", "$(", "${", "<<EOF", "\\", "#", ";", "&&", "|", "(", ")", "'", "$'x", "x #y", "EOF"];
	const parts = [];
	for (let i = 0; i < 1 + Math.floor(random() * 4); i += 1) parts.push(chance(0.4) ? pick(kind === "posix" ? RULE_WORDS_POSIX : RULE_WORDS_PS) : pick(junk));
	return parts.join(" ");
}

/** Pieces are { code } (run), { comment } (thrown away, to the end of its line) or { block } (a PowerShell block comment). */
function posixCase(rng, first) {
	const { random, pick, chance } = rng;
	const pieces = [];
	// A comment runs to the end of its line: whatever comes after it starts a new line.
	let afterComment = false;
	const code = (text) => {
		pieces.push({ code: afterComment && !text.startsWith("\n") ? `\n${text}` : text });
		afterComment = false;
	};
	const comment = (text) => {
		pieces.push({ comment: text });
		afterComment = true;
	};
	const statements = 1 + Math.floor(random() * 4);
	for (let s = 0; s < statements; s += 1) {
		const shape = s === 0 && first !== undefined ? first : Math.floor(random() * POSIX_SHAPES);
		// The last line of a here-document is its delimiter: nothing may follow it on the line.
		const closesLine = shape === 22 || shape === 23 || shape === 24 || shape === 53;
		switch (shape) {
			case 0: code("rm -rf t1"); break;
			case 1: code("git push origin m1"); break;
			case 2: code("ls"); break;
			case 3: code("npm test"); break;
			case 4: code("echo hi"); break;
			case 5: code("echo a#b"); break;
			case 6: code("echo \"# not a comment\""); break;
			case 7: code("echo '# not a comment'"); break;
			case 8: code("echo \\# also literal"); break;
			case 9: code("echo $#"); break;
			case 10: code("echo ${#PATH}"); break;
			case 11: code("x=abc; echo ${x#a}"); break;
			case 12: code("echo $(ls)"); break;
			case 13: code("echo `ls`"); break;
			case 14: code("if true; then rm -rf t2; fi"); break;
			case 15: code("for i in 1; do git push o m2; done"); break;
			case 16: code("{ rm -rf t3; }"); break;
			case 17: code("( git push o m3 )"); break;
			case 18: code("f() { rm -rf t4; }; f"); break;
			case 19: code("case x in x) rm -rf t5;; esac"); break;
			case 20: code("[[ a == \"#\" ]] && rm -rf t6"); break;
			case 21: code("echo $((1 + 2))"); break;
			case 22: code("cat <<EOF\nbody line\n# a heredoc body line\nEOF"); break;
			case 23: code("sh <<EOF\nrm -rf t7\nEOF"); break;
			case 24: code("cat <<'EOF'\n# $(rm -rf t8)\nEOF"); break;
			case 25: code("echo a \\\n  b"); break;
			case 26: code("echo \"a\nb # still inside the quotes\""); break;
			case 27: code("echo x >/dev/null 2>&1"); break;
			case 28: code("a=(1 2 3); echo ${a[1]}"); break;
			// What looks like a comment and is not (the shell runs what follows), and comments in awkward places.
			case 30: code("echo \\# && rm -rf t1"); break;
			case 31: code("echo ${x:- #y}; rm -rf t1"); break;
			case 32: code("echo $(echo a #b\n); rm -rf t2"); break;
			case 33: code("echo `echo a #b`; rm -rf t3"); break;
			case 34: code("arr=(a #b\n c); rm -rf t4"); break;
			case 35: code("echo 'a'#b; rm -rf t5"); break;
			case 36: code("echo \"a\"#b; rm -rf t6"); break;
			case 37: code("echo ${x}#b; rm -rf t7"); break;
			case 38: code("echo $(echo x)#b; rm -rf t8"); break;
			case 39: code("echo a\\ #b; rm -rf t9"); break;
			case 40: code("echo \"a\\\"#b\"; rm -rf t1"); break;
			case 41: code("echo 'it'\\''s #b'; rm -rf t2"); break;
			case 42: code("echo $'it\\'s #b'; rm -rf t3"); break;
			case 43: code("echo ${x/#a/b}; rm -rf t4"); break;
			case 44: code("echo ${#x[@]}; rm -rf t5"); break;
			case 45: code("echo $((2#101)); rm -rf t6"); break;
			case 46: code("IFS=# read a b <<< \"x#y\"; rm -rf t7"); break;
			case 47: code("echo {a,#b}; rm -rf t8"); break;
			case 48: code("function g { #c\n rm -rf t9; }; g"); break;
			case 49: code("if true; then #c\n git push o m9\nfi"); break;
			case 50: code("for i in a #c\ndo rm -rf t1; done"); break;
			case 51: code("case x in\n # c\n x) rm -rf t2;;\nesac"); break;
			case 52: code("echo $(echo \"#\") #c\nrm -rf t3"); break;
			case 53: code("cat <<EOF # note\nbody\nEOF"); break;
			case 54: code("echo a \\\n#b\nrm -rf t4"); break;
			case 55: code("echo *#; rm -rf t5"); break;
			case 56: code("[[ -n x ]] # c\nrm -rf t6"); break;
			case 57: code("echo a  ;  #c\nrm -rf t7"); break;
			case 58: code("(echo a; #c\n rm -rf t8)"); break;
			case 59: code("echo $x#y; rm -rf t9"); break;
			case 60: code("echo a\\\n b "); comment("# c"); break;
			case 61: code("echo \"a $(echo b #c\n) d\"; rm -rf t1"); break;
			case 62: code("echo $'\\'' ; git push o m2"); break;
			default: code("echo one; echo two"); break;
		}
		// A comment after the statement, on its own line, or between statements.
		const trailing = closesLine ? 0.9 : random();
		if (trailing < 0.35) {
			code(pick([" ", "  ", "\t"]));
			comment(`# ${commentText(rng, "posix")}`);
		} else if (trailing < 0.45) {
			code(";");
			comment(`#${commentText(rng, "posix")}`);
		} else if (trailing < 0.55) {
			code(pick(["&&", "||", "|"]) + " ");
			// A comment cannot end a pipeline or a list: put a command after it on the next line.
			comment(`# ${commentText(rng, "posix")}`);
			code("\n" + pick(["true", "ls", "echo more"]));
		}
		if (s < statements - 1) {
			const sep = closesLine ? 0 : random();
			if (sep < 0.5) code("\n");
			else if (sep < 0.65) {
				code("\n");
				comment(`# ${commentText(rng, "posix")}`);
				code("\n");
			} else if (sep < 0.8) code("; ");
			else if (sep < 0.9) code(" && ");
			else code(" || ");
		}
	}
	if (chance(0.25)) {
		code("\n");
		comment(`# ${commentText(rng, "posix")}`);
	}
	return pieces;
}

// ------------------------------------------------------------------------------------------------ the corpus (PowerShell)
function powershellCase(rng, first) {
	const { random, pick, chance } = rng;
	const pieces = [];
	let afterComment = false;
	const code = (text) => {
		pieces.push({ code: afterComment && !text.startsWith("\n") ? `\n${text}` : text });
		afterComment = false;
	};
	const comment = (text) => {
		pieces.push({ comment: text });
		afterComment = true;
	};
	const block = (text) => pieces.push({ block: text });
	const statements = 1 + Math.floor(random() * 4);
	for (let s = 0; s < statements; s += 1) {
		const shape = s === 0 && first !== undefined ? first : Math.floor(random() * POWERSHELL_SHAPES);
		// A here-string ends on its own line, and after `--%` the rest of the line is the program's.
		const closesLine = shape === 11 || shape === 12 || shape === 22;
		switch (shape) {
			case 0: code("Remove-Item -Recurse -Force t1"); break;
			case 1: code("git push origin m1"); break;
			case 2: code("Get-ChildItem"); break;
			case 3: code("Write-Host hi"); break;
			case 4: code("Write-Host a#b"); break;
			case 5: code("Write-Host \"# not a comment\""); break;
			case 6: code("Write-Host '# not a comment'"); break;
			case 7: code("Write-Host `# escaped"); break;
			case 8: code("Write-Host \"$(1 + 1) # in a string\""); break;
			case 9: code("if ($true) { Remove-Item -Recurse -Force t2 }"); break;
			case 10: code("1..2 | ForEach-Object { git push o m2 }"); break;
			case 11: code("$s = @'\n# a here-string line\nbody\n'@"); break;
			case 12: code("$s = @\"\n# a here-string line ($x)\nbody\n\"@"); break;
			case 13: code("Write-Host \u2018# smart quotes\u2019"); break;
			case 14: code("Write-Host ${my#var}"); break;
			case 15: code("Write-Host 'it''s # fine'"); break;
			case 16: code("Write-Host \"say \"\"# hi\"\"\""); break;
			case 17: code("$x = 1; Write-Host $x"); break;
			case 18: code("function f { Remove-Item -Recurse -Force t3 }; f"); break;
			case 19: code("try { git push o m3 } catch { }"); break;
			case 20: code("foreach ($i in 1..2) { Write-Host $i }"); break;
			case 21: code("Write-Host a; Write-Host b"); break;
			case 22: code("Write-Host --% # to the program, not a comment"); break;
			case 23: code("(1 + 1).ToString()"); break;
			case 24: code("$h = @{ a = 1 }; $h.a"); break;
			// What looks like a comment and is not, and comments in awkward places.
			case 26: code("Write-Host a; #c\nRemove-Item -Recurse -Force t1"); break;
			case 27: code("Write-Host \"a\"#b; Remove-Item -Recurse -Force t2"); break;
			case 28: code("Write-Host a `\n# c\ngit push o m3"); break;
			case 29: code("Write-Host a <# c #> b"); break;
			case 30: code("Write-Host 'a' "); comment("# c"); break;
			case 31: code("$x = @{ a = 1 # c\n b = 2 }; $x.b"); break;
			case 32: code("Write-Host $(# c\n 1 + 1)"); break;
			case 33: code("Write-Host \"a $( # c\n 1 + 1 ) b\"; git push o m4"); break;
			case 34: code("Write-Host a#b; Remove-Item -Recurse -Force t3"); break;
			case 35: code("Write-Host $x#y; git push o m5"); break;
			case 36: code("if ($true) { # c\n Remove-Item -Recurse -Force t4 }"); break;
			case 37: code("Write-Host "); block("<# a <# b #>"); code(" c "); comment("#> d; git push o m6"); break; // block comments do not nest: the last `#>` starts a line comment
			case 38: code("Write-Host 1,#c\n2; Remove-Item -Recurse -Force t7"); break;
			case 39: code("Write-Host (1)#c\nRemove-Item -Recurse -Force t8"); break;
			case 40: code("Write-Host ${a b}; git push o m7"); break;
			case 41: code("Write-Host ''''; Remove-Item -Recurse -Force t9"); break;
			default: code("Write-Host done"); break;
		}
		const trailing = closesLine ? 0.9 : random();
		if (trailing < 0.3) {
			code(pick([" ", "  ", "\t"]));
			comment(`# ${commentText(rng, "powershell")}`);
		} else if (trailing < 0.4) {
			code(";");
			comment(`#${commentText(rng, "powershell")}`);
		} else if (trailing < 0.55) {
			code(" ");
			block(`<# ${commentText(rng, "powershell")} #>`);
			code(" ");
		} else if (trailing < 0.62) {
			code("\n");
			block(`<#\n${commentText(rng, "powershell")}\n${commentText(rng, "powershell")}\n#>`);
		}
		if (s < statements - 1) {
			const sep = closesLine ? 0 : random();
			if (sep < 0.55) code("\n");
			else if (sep < 0.7) {
				code("\n");
				comment(`# ${commentText(rng, "powershell")}`);
				code("\n");
			} else code("; ");
		}
	}
	if (chance(0.25)) {
		code("\n");
		comment(`# ${commentText(rng, "powershell")}`);
	}
	return pieces;
}

function render(pieces, withComments) {
	let text = "";
	for (const piece of pieces) {
		if (piece.code !== undefined) text += piece.code;
		else if (piece.comment !== undefined) {
			if (withComments) text += piece.comment;
		} else if (piece.block !== undefined) {
			text += withComments ? piece.block : " ";
		}
	}
	return text;
}

// ------------------------------------------------------------------------------------------------ the real shells
function parseRuns(stdout, count, read) {
	const blocks = stdout.split(/^@@CASE \d+\r?$/m).slice(1);
	if (blocks.length !== count) throw new Error(`the shell ran ${blocks.length} cases, expected ${count}`);
	return blocks.map(read);
}

function runPosix(bash, scripts) {
	const dir = mkdtempSync(join(tmpdir(), "heli-diff-bash-"));
	try {
		const lines = scripts.map((script) => Buffer.from(script, "utf8").toString("base64"));
		writeFileSync(join(dir, "cases.b64"), `${lines.join("\n")}\n`);
		writeFileSync(join(dir, "run.sh"), [
			// The stubs log on stderr: a command substitution captures stdout, and what runs inside one must still show.
			"rm() { echo \"EXEC rm $*\" >&2; }",
			"git() { echo \"EXEC git $*\" >&2; }",
			"npm() { echo \"EXEC npm $*\" >&2; }",
			"ls() { echo \"EXEC ls $*\" >&2; }",
			"cat() { echo \"EXEC cat $*\" >&2; command cat; }",
			"sh() { echo \"EXEC sh\" >&2; eval \"$(command cat)\"; }",
			"command_not_found_handle() { echo \"EXEC nf $*\" >&2; }",
			"n=0",
			"while IFS= read -r b64; do",
			"  n=$((n+1))",
			"  echo \"@@CASE $n\"",
			"  ( eval \"$(printf %s \"$b64\" | base64 -d)\" ) 2>&1 </dev/null || true",
			"done < cases.b64",
			"",
		].join("\n"));
		const result = spawnSync(bash, ["run.sh"], { cwd: dir, encoding: "utf8", timeout: 600000, maxBuffer: 1 << 28 });
		if (result.error) throw result.error;
		return parseRuns(result.stdout, scripts.length, (block) => ({
			rmrf: /^EXEC rm .*-rf/m.test(block),
			push: /^EXEC git push/m.test(block),
			// Sorted: the two ends of a pipeline run at once and write to the same stream in either order.
			log: block.split("\n").filter((line) => line.startsWith("EXEC ")).sort().join("|"),
		}));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function runPowerShell(powershell, scripts) {
	const dir = mkdtempSync(join(tmpdir(), "heli-diff-ps-"));
	try {
		writeFileSync(join(dir, "cases.json"), JSON.stringify(scripts), "utf8");
		writeFileSync(join(dir, "run.ps1"), [
			"$ErrorActionPreference = 'SilentlyContinue'",
			"function Remove-Item { \"EXEC Remove-Item $args\" }",
			"function git { \"EXEC git $args\" }",
			"function Get-ChildItem { \"EXEC Get-ChildItem\" }",
			"function Write-Host { \"EXEC Write-Host $args\" }",
			"$cases = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'cases.json') | ConvertFrom-Json",
			"$n = 0",
			"foreach ($case in @($cases)) {",
			"  $n++",
			"  \"@@CASE $n\"",
			"  try { Invoke-Expression $case } catch { }",
			"}",
			"",
		].join("\r\n"), "utf8");
		const result = spawnSync(powershell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(dir, "run.ps1")], { cwd: dir, encoding: "utf8", timeout: 600000, maxBuffer: 1 << 28 });
		if (result.error) throw result.error;
		return parseRuns(result.stdout, scripts.length, (block) => ({
			rmrf: /^EXEC Remove-Item .*-Recurse.*-Force/m.test(block),
			push: /^EXEC git push/m.test(block),
			log: block.split(/\r?\n/).filter((line) => line.startsWith("EXEC ")).join("|"),
		}));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/** What the real shell does with each script, as logged by the stubs: { rmrf, push, log } per script. */
export function shellRuns(shell, bin, scripts) {
	return shell === "posix" ? runPosix(bin, scripts) : runPowerShell(bin, scripts);
}

/**
 * The executable that runs `shell` here, or null with the reason. `BASH_BIN` and `POWERSHELL_BIN` pick one; otherwise bash, and
 * Windows PowerShell before pwsh on Windows (pwsh first elsewhere).
 */
export function findShell(shell, env = process.env) {
	const candidates = shell === "posix"
		? [env.BASH_BIN, "bash"]
		: [env.POWERSHELL_BIN, ...(process.platform === "win32" ? ["powershell", "pwsh"] : ["pwsh", "powershell"])];
	for (const candidate of candidates.filter(Boolean)) {
		const args = shell === "posix" ? ["-c", "echo ok"] : ["-NoProfile", "-Command", "'ok'"];
		const probe = spawnSync(candidate, args, { encoding: "utf8", timeout: 30000 });
		if (!probe.error && probe.status === 0 && /^ok\s*$/.test(probe.stdout)) return { bin: candidate, reason: null };
	}
	return { bin: null, reason: `no ${shell === "posix" ? "bash" : "PowerShell"} found on this machine` };
}

// ------------------------------------------------------------------------------------------------ the check
/**
 * `sweep` makes case i start with shape i (round and round), so every shape is met at least once in 63 (POSIX) or 42
 * (PowerShell) cases whatever the seed; `verifyGenerator: false` skips the second run of the shell (the comment-free text) that
 * only checks the corpus, which halves the time on a machine where starting processes is slow.
 * @param {{ shell: "posix"|"powershell", bin: string, cases: number, seed: number, sweep?: boolean, verifyGenerator?: boolean,
 *   stripComments: (text: string, shell: string) => string|null,
 *   analysis: { analyzeCommand: Function, matchCommandRules: Function, commandRunsGitPush: Function } }} options
 * @returns {{ tally: Record<string, number>, problems: string[][] }}
 */
export function runDifferential({ shell, bin, cases, seed, sweep = false, verifyGenerator = true, stripComments, analysis }) {
	const { analyzeCommand, matchCommandRules, commandRunsGitPush } = analysis;
	const rng = createRandom(seed);
	const verdict = (text) => {
		const found = analyzeCommand(text);
		const matches = matchCommandRules(found);
		const deleteRule = shell === "posix" ? "destructive-delete" : "powershell-remove-item-recurse-force";
		return { rmrf: matches.some((match) => match.id === deleteRule), push: commandRunsGitPush(found), limit: found.limitExceeded?.limit ?? null };
	};
	const corpus = [];
	for (let i = 0; i < cases; i += 1) {
		const first = sweep ? i % (shell === "posix" ? POSIX_SHAPES : POWERSHELL_SHAPES) : undefined;
		const pieces = shell === "posix" ? posixCase(rng, first) : powershellCase(rng, first);
		corpus.push({ full: render(pieces, true), plain: render(pieces, false) });
	}
	const run = (scripts) => shellRuns(shell, bin, scripts);
	const shellFull = run(corpus.map((c) => c.full));
	const shellPlain = verifyGenerator ? run(corpus.map((c) => c.plain)) : null;

	const tally = { cases, generatorMismatch: 0, recallMisses: 0, exact: 0, keptComment: 0, droppedCode: 0, ranRm: 0, ranPush: 0, baselineFlaggedNotRun: 0, strippedFlaggedNotRun: 0, limit: 0 };
	const problems = [];
	const note = (...lines) => {
		if (problems.length < 12) problems.push(lines);
	};
	corpus.forEach((c, i) => {
		const full = shellFull[i];
		const plain = shellPlain?.[i];
		if (plain && full.log !== plain.log) {
			tally.generatorMismatch += 1;
			note("GENERATOR: the shell ran different things with the comments out", c.full, full.log, plain.log);
		}
		const stripped = stripComments(c.full, shell);
		const seen = stripped === null ? { rmrf: false, push: false, limit: "syntax-nesting" } : verdict(stripped);
		const truth = verdict(c.plain);
		const baseline = verdict(c.full);
		if (seen.limit) tally.limit += 1;
		if (full.rmrf) tally.ranRm += 1;
		if (full.push) tally.ranPush += 1;
		if ((full.rmrf && !seen.rmrf) || (full.push && !seen.push)) {
			tally.recallMisses += 1;
			note("RECALL: the shell ran it, the stripped text does not show it", c.full, JSON.stringify(stripped), JSON.stringify(seen));
		}
		if (seen.rmrf === truth.rmrf && seen.push === truth.push) tally.exact += 1;
		else if ((seen.rmrf && !truth.rmrf) || (seen.push && !truth.push)) {
			tally.keptComment += 1;
			note("KEPT: a comment still shows a command", c.full, JSON.stringify(stripped), JSON.stringify(seen));
		} else {
			tally.droppedCode += 1;
			note("DROPPED: code the analysis of the comment-free text sees is gone", c.full, JSON.stringify(stripped), JSON.stringify(seen));
		}
		if ((baseline.rmrf && !full.rmrf) || (baseline.push && !full.push)) tally.baselineFlaggedNotRun += 1;
		if ((seen.rmrf && !full.rmrf) || (seen.push && !full.push)) tally.strippedFlaggedNotRun += 1;
	});
	return { tally, problems };
}
