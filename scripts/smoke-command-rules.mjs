#!/usr/bin/env node
/**
 * Command rules: every rule is evaluated, T6 can never be approved, each T5
 * needs its own approval, grants are consumed only on a final allow, and a
 * built-in T6 floor survives an empty/missing/malformed rules file.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILTIN_COMMAND_RULES, COMMAND_ANALYSIS_LIMITS, analyzeCommand, argvCommandText, commandProgramNames, commandRunsGitPush, evaluateCommandRules, loadCommandRules, matchCommandRules } from "../.heli-harness/adapters/shared/command-policy.mjs";
import { DEFAULT_FILE_WRITE_TOOL_NAMES, evaluatePreToolUse, isFileMutationTool, isFileWriteToolName, isLikelyShellMutation } from "../.heli-harness/adapters/shared/hook-core.mjs";
import { issueGrant, listGrants } from "../lib/concurrency/grant.mjs";
import { projectWorkspaceKey } from "../lib/concurrency/project-binding.mjs";
import { createTask } from "../lib/concurrency/task.mjs";
import { scrubHeliProcessEnv } from "./lib/hermetic-env.mjs";

scrubHeliProcessEnv();
const root = process.cwd();
const scratch = mkdtempSync(join(tmpdir(), "heli-command-rules-"));
const env = { ...process.env, HELI_CONFIG_DIR: join(scratch, "config"), HELI_DATA_DIR: join(scratch, "data") };
const shippedRules = readFileSync(join(root, ".heli-harness", "safety", "command-rules.json"), "utf8");

// ---------------------------------------------------------------- parsing
const T6_TABLE = [
	["rm -rf build", ["destructive-delete"]],
	["rm -fr build", ["destructive-delete"]],
	["rm -r -f build", ["destructive-delete"]],
	["rm -Rf build", ["destructive-delete"]],
	["rm --recursive --force build", ["destructive-delete"]],
	["sudo /bin/rm -rf /", ["destructive-delete"]],
	["\"rm\" -rf x", ["destructive-delete"]],
	["r\\m -rf x", ["destructive-delete"]],
	["git clean -fdx", ["git-clean-force"]],
	["git clean -xfd", ["git-clean-force"]],
	["git clean -f -d", ["git-clean-force"]],
	["git clean --force -x", ["git-clean-force"]],
	["rd /s /q build", ["windows-rmdir"]],
	["rmdir /s /q build", ["windows-rmdir"]],
	["RD /S/Q build", ["windows-rmdir"]],
	["del /s /q *.tmp", ["windows-del"]],
	["Remove-Item -Recurse -Force src", ["powershell-remove-item-recurse-force"]],
	["Remove-Item src -Force -Recurse", ["powershell-remove-item-recurse-force"]],
	["Remove-Item -r -fo src", ["powershell-remove-item-recurse-force"]],
	["git reset --hard", ["git-reset-hard"]],
	["git -C repo reset --hard HEAD~1", ["git-reset-hard"]],
	["find . -delete", ["find-delete"]],
	["find src -type f -delete", ["find-delete"]],
	["git push --force origin main", ["git-push-force"]],
	["git push -f", ["git-push-force"]],
	["git push --force-with-lease", ["git-push-force"]],
	["git push origin +main", ["git-push-force"]],
	["bash -c 'rm -rf /'", ["destructive-delete"]],
	["sh -c \"git reset --hard\"", ["git-reset-hard"]],
	["cmd /c rd /s /q C:\\build", ["windows-rmdir"]],
	["pwsh -Command \"Remove-Item -Recurse -Force src\"", ["powershell-remove-item-recurse-force"]],
	["powershell -EncodedCommand " + Buffer.from("Remove-Item -Recurse -Force src", "utf16le").toString("base64"), ["powershell-remove-item-recurse-force"]],
	["echo ok && rm -rf dist", ["destructive-delete"]],
	["true || rm -rf dist", ["destructive-delete"]],
	["ls | xargs rm -rf", ["destructive-delete"]],
	["echo $(rm -rf dist)", ["destructive-delete"]],
	["echo `git reset --hard`", ["git-reset-hard"]],
	["ls\nrm -rf dist", ["destructive-delete"]],
	["eval 'git reset --hard'", ["git-reset-hard"]],
	// Windows executable spellings read as the plain program: directory and a
	// trailing .exe/.cmd/.bat/.com/.ps1 are dropped, in any case.
	["git.exe reset --hard", ["git-reset-hard"]],
	["GIT.EXE -C . reset --hard", ["git-reset-hard"]],
	["\"C:\\Program Files\\Git\\cmd\\git.exe\" clean -fdx", ["git-clean-force"]],
	["& \"C:\\Program Files\\Git\\cmd\\git.exe\" push --force origin main", ["git-push-force"]],
	["git.cmd push -f", ["git-push-force"]],
	["git.bat push -f", ["git-push-force"]],
	["git.com push -f", ["git-push-force"]],
	["git.ps1 push -f", ["git-push-force"]],
	["rm.exe -rf build", ["destructive-delete"]],
	["\"C:\\Program Files\\Git\\usr\\bin\\rm.exe\" -rf build", ["destructive-delete"]],
	["/usr/bin/RM -Rf build", ["destructive-delete"]],
	["find.exe . -delete", ["find-delete"]],
	["bash.exe -c 'rm -rf /'", ["destructive-delete"]],
	["cmd.exe /c rd /s /q build", ["windows-rmdir"]],
	["powershell.exe -NoProfile -Command \"Remove-Item -Recurse -Force src\"", ["powershell-remove-item-recurse-force"]],
	["pwsh.exe -c \"git.exe reset --hard\"", ["git-reset-hard"]],
	["git.exe status", []],
	["git.exe push origin main", []],
	["rm.exe -f build.log", []],
	["mygit.exe reset --hard", []],
	// A shell's options never hide its -c payload: options that take a value (-o, +o, -O, +O,
	// --rcfile, --init-file) are skipped whole, -c may sit in a cluster (-lc, -euxc), options
	// may follow -c, and long flags without a value are skipped.
	["bash -o pipefail -c 'rm -rf /'", ["destructive-delete"]],
	["bash -euo pipefail -c 'rm -rf /'", ["destructive-delete"]],
	["bash -o pipefail -o errexit -c 'rm -rf /'", ["destructive-delete"]],
	["bash --rcfile x -c 'rm -rf /'", ["destructive-delete"]],
	["bash --rcfile=x -c 'rm -rf /'", ["destructive-delete"]],
	["bash --init-file x -c 'rm -rf /'", ["destructive-delete"]],
	["bash -O extglob -c 'rm -rf /'", ["destructive-delete"]],
	["bash +O extglob -c 'rm -rf /'", ["destructive-delete"]],
	["bash +o pipefail -c 'rm -rf /'", ["destructive-delete"]],
	["bash -lc 'rm -rf /'", ["destructive-delete"]],
	["bash -ec 'rm -rf /'", ["destructive-delete"]],
	["bash -euxc 'rm -rf /'", ["destructive-delete"]],
	["bash -xc 'rm -rf /'", ["destructive-delete"]],
	["bash -l -c 'rm -rf /'", ["destructive-delete"]],
	["bash --login --norc --noprofile --posix --restricted -c 'rm -rf /'", ["destructive-delete"]],
	["bash -c -o pipefail 'rm -rf /'", ["destructive-delete"]],
	["bash -c -x 'rm -rf /'", ["destructive-delete"]],
	["bash -c -- 'rm -rf /'", ["destructive-delete"]],
	["sh -o errexit -c 'rm -rf /'", ["destructive-delete"]],
	["dash -o errexit -c 'rm -rf /'", ["destructive-delete"]],
	["ksh -o errexit -c 'rm -rf /'", ["destructive-delete"]],
	["zsh -o errexit -c 'rm -rf /'", ["destructive-delete"]],
	["zsh -fc 'rm -rf /'", ["destructive-delete"]],
	["bash.exe -o pipefail -c 'rm -rf /'", ["destructive-delete"]],
	["\"C:\\Program Files\\Git\\bin\\bash.exe\" -o pipefail -c 'rm -rf /'", ["destructive-delete"]],
	["/bin/bash -o pipefail -c 'rm -rf /'", ["destructive-delete"]],
	["bash -o pipefail -c 'git reset --hard'", ["git-reset-hard"]],
	["bash -euo pipefail -c 'git push --force origin main'", ["git-push-force"]],
	["bash -o pipefail -c 'echo hi'", []],
	["bash -o pipefail script.sh", []],
	["bash -o pipefail", []],
	["bash -o", []],
	["bash -c", []],
	// Common prefixes never hide the real program from the floor.
	["sudo rm -rf /", ["destructive-delete"]],
	["sudo -u root rm -rf /", ["destructive-delete"]],
	["sudo -E -- rm -rf /", ["destructive-delete"]],
	["doas rm -rf /", ["destructive-delete"]],
	["env FOO=1 git push --force origin main", ["git-push-force"]],
	["env -i -u NAME FOO=1 rm -rf /", ["destructive-delete"]],
	["env -i -u NAME FOO=1 git push --force origin main", ["git-push-force"]],
	["nohup rm -rf x", ["destructive-delete"]],
	["nice -n 10 rm -rf x", ["destructive-delete"]],
	["time rm -rf x", ["destructive-delete"]],
	["timeout 5 rm -rf x", ["destructive-delete"]],
	["timeout -s KILL 5 rm -rf x", ["destructive-delete"]],
	["timeout --preserve-status 5 git push --force origin main", ["git-push-force"]],
	["timeout 5 bash -c 'rm -rf x'", ["destructive-delete"]],
	["timeout 5 bash -o pipefail -c 'rm -rf x'", ["destructive-delete"]],
	["exec rm -rf /", ["destructive-delete"]],
	["command rm -rf /", ["destructive-delete"]],
	["builtin rm -rf /", ["destructive-delete"]],
	["busybox rm -rf /", ["destructive-delete"]],
	["busybox sh -c 'rm -rf /'", ["destructive-delete"]],
	["sudo bash -euo pipefail -c 'rm -rf /'", ["destructive-delete"]],
	["env FOO=1 bash -euo pipefail -c 'git push --force origin main'", ["git-push-force"]],
	// git's global options that take a value (from `git help git`) are skipped in both spellings.
	["git --config-env a.b=HOME reset --hard", ["git-reset-hard"]],
	["git --config-env=a.b=HOME reset --hard", ["git-reset-hard"]],
	["git --attr-source HEAD clean -fdx", ["git-clean-force"]],
	["git --attr-source=HEAD clean -fdx", ["git-clean-force"]],
	["git --config-env a.b=HOME push --force origin main", ["git-push-force"]],
	["git --shallow-file /x reset --hard", ["git-reset-hard"]],
	["git --super-prefix p reset --hard", ["git-reset-hard"]],
	["git --super-prefix=p reset --hard", ["git-reset-hard"]],
	["git --namespace n reset --hard", ["git-reset-hard"]],
	["git --namespace=n reset --hard", ["git-reset-hard"]],
	["git --work-tree w reset --hard", ["git-reset-hard"]],
	["git --work-tree=w reset --hard", ["git-reset-hard"]],
	["git --git-dir g reset --hard", ["git-reset-hard"]],
	["git --git-dir=g reset --hard", ["git-reset-hard"]],
	["git --exec-path=/x reset --hard", ["git-reset-hard"]],
	["git --exec-path reset --hard", ["git-reset-hard"]],
	["git --list-cmds=main reset --hard", ["git-reset-hard"]],
	["git -P reset --hard", ["git-reset-hard"]],
	["git -p reset --hard", ["git-reset-hard"]],
	["git --no-pager --bare --no-replace-objects --literal-pathspecs -C . -c a=b reset --hard", ["git-reset-hard"]],
	["git -c a=b --config-env x=Y -C . --attr-source HEAD --namespace n reset --hard", ["git-reset-hard"]],
	["git --attr-source HEAD status", []],
	// A Windows switch is a standalone token (/s, /S/Q), never a segment of a POSIX path.
	["rmdir /s", ["windows-rmdir"]],
	["rmdir /S /Q build", ["windows-rmdir"]],
	["rd /s/q build", ["windows-rmdir"]],
	["del /f/s/q x", ["windows-del"]],
	["rmdir /tmp/s /s", ["windows-rmdir"]],
	["rmdir /tmp/s", []],
	["rmdir /var/s/x", []],
	["rd /tmp/s", []],
	["del /tmp/s/file.txt", []],
	["rmdir /s/tmp/s", []],
	// A quoted command line handed to a program that runs it (su -c, sudo -s, env -S, ssh, watch,
	// flock -c, script -c, docker/kubectl exec) is read as a command when its first command word is a
	// program some rule targets: `VAR=value` and transparent prefixes such as sudo are skipped.
	["su -c 'rm -rf /'", ["destructive-delete"]],
	["su root -c 'rm -rf /'", ["destructive-delete"]],
	["sudo -s 'rm -rf /'", ["destructive-delete"]],
	["sudo -i 'rm -rf /'", ["destructive-delete"]],
	["env -S 'rm -rf /'", ["destructive-delete"]],
	["ssh host 'rm -rf /'", ["destructive-delete"]],
	["ssh host \"rm -rf /\"", ["destructive-delete"]],
	["ssh -o StrictHostKeyChecking=no host 'rm -rf /'", ["destructive-delete"]],
	["ssh host 'git push --force origin main'", ["git-push-force"]],
	["ssh host 'git reset --hard'", ["git-reset-hard"]],
	["ssh host 'git clean -fdx'", ["git-clean-force"]],
	["ssh host 'find . -delete'", ["find-delete"]],
	["ssh host 'rd /s /q x'", ["windows-rmdir"]],
	["ssh host 'Remove-Item -Recurse -Force x'", ["powershell-remove-item-recurse-force"]],
	["watch 'rm -rf /'", ["destructive-delete"]],
	["watch -n 5 'rm -rf /'", ["destructive-delete"]],
	["flock f -c 'rm -rf /'", ["destructive-delete"]],
	["script -c 'rm -rf /' out", ["destructive-delete"]],
	["docker exec c sh -c 'rm -rf /'", ["destructive-delete"]],
	["docker exec c 'rm -rf /'", ["destructive-delete"]],
	["kubectl exec pod -- 'rm -rf /'", ["destructive-delete"]],
	["ssh host 'sudo rm -rf /'", ["destructive-delete"]],
	["ssh host 'FOO=1 git push --force origin main'", ["git-push-force"]],
	["ssh host 'nohup rm -rf x'", ["destructive-delete"]],
	["ssh host 'timeout 5 rm -rf x'", ["destructive-delete"]],
	["ssh host 'nice -n 5 rm -rf x'", ["destructive-delete"]],
	["ssh host 'env FOO=1 rm -rf x'", ["destructive-delete"]],
	["ssh host '/bin/rm -rf /'", ["destructive-delete"]],
	["wsl -e 'rm -rf /'", ["destructive-delete"]],
	["xterm -e 'git reset --hard'", ["git-reset-hard"]],
	// A shell or wrapper the analysis unwraps also starts a command line: bash -c, cmd /c, powershell -Command, eval.
	["ssh host 'bash -c \"rm -rf /\"'", ["destructive-delete"]],
	["ssh host 'sudo sh -c \"git reset --hard\"'", ["git-reset-hard"]],
	["watch 'sh -c \"rm -rf /\"'", ["destructive-delete"]],
	["su -c 'bash -lc \"find . -delete\"'", ["find-delete"]],
	["ssh host 'cmd /c rd /s /q x'", ["windows-rmdir"]],
	["ssh host 'powershell -Command \"Remove-Item -Recurse -Force x\"'", ["powershell-remove-item-recurse-force"]],
	["ssh host 'eval rm -rf x'", ["destructive-delete"]],
	["ssh host 'git status'", []],
	// ...but a quoted word that is text stays text: it does not start with a rule program, it follows
	// a program that only prints or searches, it is the value of a message or pattern flag, or it sits
	// in a line of prose (a capitalized first word, a bullet).
	["git commit -m \"fix: rm -rf handling\"", []],
	["git commit -m \"Tighten the guard\n\nThe old matcher flagged rm -rf and git push --force anywhere in a message,\neven when the text only talked about them.\"", []],
	["notes \"Tighten the guard\n\nThe old matcher flagged rm -rf and git push --force mid-sentence.\"", []],
	["git commit -m 'git push wrapper notes'", []],
	["git commit -am 'git push wrapper notes'", []],
	["git commit --message 'rm -rf guard'", []],
	["git tag -a v1 -m 'rm -rf docs'", []],
	["echo 'git push is blocked'", []],
	["echo \"rm -rf /\"", []],
	["printf 'rm -rf /\\n'", []],
	["Write-Host 'git push is blocked'", []],
	["grep -rn 'rm -rf' scripts", []],
	["grep -e 'git reset --hard' docs", []],
	["git grep -e 'rm -rf' docs", []],
	["echo 'bash -c \"rm -rf /\"'", []],
	["git commit -m 'bash -c \"rm -rf x\" example'", []],
	["notes 'bash scripts are fine'", []],
	["ssh host 'bash script.sh'", []],
	["rg 'git push --force' docs", []],
	["findstr \"rm -rf\" notes.txt", []],
	["Select-String -Pattern 'git reset --hard' notes.txt", []],
	["git log --grep 'git push'", []],
	["gh pr create --title \"git push gate\" --body \"rm -rf build notes\"", []],
	["gh issue create --title 'rm -rf guard' --body 'git push --force is blocked'", []],
	["gh release create v1 --notes 'git reset --hard removed'", []],
	["Send-MailMessage -Subject 'rm -rf report' -Body 'git push --force report'", []],
	["Set-Content -Path notes.txt -Value 'rm -rf build'", []],
	["Add-Content notes.txt 'rm -rf build'", []],
	["sed -e 's/rm -rf/x/' file", []],
	["cat <<< 'rm -rf /'", []],
	["notes 'Find rm -rf usage in docs'", []],
	["notes 'Git push is blocked'", []],
	["notes 'fix: rm -rf handling'", []],
	["He said 'git push is blocked' twice.", []],
	["- Use 'rm -rf build' with care", []],
	// Data and code keep their strings too: a value after `key:` or `=`, a list item, a `for` list.
	["reason: 'git reset --hard is destructive'", []],
	["\"reason\": \"git reset --hard is destructive\",", []],
	["toolInput: { command: \"git push --force origin main\" },", []],
	["const cmd = \"rm -rf build\";", []],
	["cmd = 'git reset --hard'", []],
	["if [ \"$x\" = \"rm -rf x\" ]; then echo hi; fi", []],
	["[[ $x == \"git reset --hard\"* ]]", []],
	["for c in \"git reset --hard\" \"rm -rf x\"; do echo $c; done", []],
	["for command of [\"git push --force\", \"rm -rf build\", \"git reset --hard\"]", []],
	["cat > probe.mjs <<'EOF'\nfor (const command of [\"git push --force\", \"rm -rf build\", \"find . -delete\"]) {\n\tconst r = run({ command: \"git reset --hard\", reason: \"rm -rf build is destructive\" });\n}\nEOF", []],
	// Known gaps of this heuristic (recorded, not fixed): python -c and other interpreters, a command
	// word that is not the first (`cd x && rm -rf y`), and a prefix option that takes a value.
	["python -c \"import os; os.system('rm -rf /')\"", []],
	["ssh host 'cd /x && rm -rf y'", []],
	["ssh host 'sudo -u root rm -rf /'", []],
	// Legitimate, non-destructive commands must not match any built-in rule.
	["rm -f build.log", []],
	["rm -r build", []],
	["git clean -n", []],
	["git clean -fdn", []],
	["Remove-Item file.txt", []],
	["Remove-Item -Recurse src", []],
	["find . -name '*.pyc' -delete", []],
	["git reset --soft HEAD~1", []],
	["git push origin main", []],
	["echo 'a; b'", []],
	["npm test", []],
];
for (const [command, expected] of T6_TABLE) {
	const got = matchCommandRules(analyzeCommand(command)).map((match) => match.id).sort();
	assert.deepEqual(got, [...expected].sort(), `built-in rules for ${JSON.stringify(command)}`);
}

const PUSH_TABLE = [
	["git push", true],
	["git -C . push", true],
	["git -c user.name=x push", true],
	["git --git-dir=.git push", true],
	["git --no-pager push", true],
	["\"git\" push", true],
	["g\\it push", true],
	["GIT PUSH", true],
	["git \\\npush", true],
	["bash -c 'git push'", true],
	["cmd /c git push", true],
	["pwsh -Command git push", true],
	["echo digit pushups", false],
	["getprop | grep push", false],
	["git pull", false],
	["git -C push status", false],
	["git.exe push", true],
	["GIT.EXE -C . push", true],
	["git.cmd push", true],
	["git.bat push", true],
	["git.com push", true],
	["git.ps1 push", true],
	["\"C:\\Program Files\\Git\\cmd\\git.exe\" push origin main", true],
	["& \"C:\\Program Files\\Git\\cmd\\git.exe\" push origin main", true],
	["'C:\\Program Files\\Git\\cmd\\git.exe' -c core.editor=x push", true],
	["cmd /c git.exe push", true],
	["mygit.exe push", false],
	["git.exe pull", false],
	["echo git.exe pushups", false],
	["sudo git push", true],
	["env FOO=1 git push", true],
	["nohup git push", true],
	["timeout 5 git push", true],
	["bash -o pipefail -c 'git push'", true],
	["bash -euo pipefail -c 'git push'", true],
	["bash --rcfile x -c 'git push'", true],
	["git --config-env a.b=HOME push", true],
	["git --config-env=a.b=HOME push", true],
	["git --attr-source HEAD push", true],
	["git --attr-source=HEAD push", true],
	["git --shallow-file x push", true],
	["git --super-prefix p push", true],
	["git --namespace n push", true],
	["git --work-tree w push", true],
	["git --git-dir g push", true],
	["git --exec-path=/x push", true],
	["git -P push", true],
	["git -p push", true],
	["git --attr-source push status", false],
	["git --config-env push status", false],
	["git --exec-path=push status", false],
	["ssh host 'git push'", true],
	["su -c 'git push origin main'", true],
	["watch 'git push'", true],
	["ssh host 'FOO=1 git push'", true],
	["ssh host 'bash -c \"git push\"'", true],
	["ssh host 'bash script.sh'", false],
	["echo 'git push is blocked'", false],
	["git commit -m 'git push wrapper notes'", false],
	["grep -rn 'git push' docs", false],
	["notes 'Git push is blocked'", false],
	["gh pr create --title 'git push gate' --body 'git push notes'", false],
	["const cmd = \"git push origin main\";", false],
	["toolInput: { command: \"git push origin main\" },", false],
	["if [ \"$x\" = \"git push\" ]; then echo hi; fi", false],
	["for c in \"git push\" \"git push --force\"; do echo $c; done", false],
	["He said 'git push is blocked' twice.", false],
	["- Use 'git push' with care", false],
];
for (const [command, expected] of PUSH_TABLE) {
	assert.equal(commandRunsGitPush(analyzeCommand(command)), expected, `git push detection for ${JSON.stringify(command)}`);
}

// Rules-file layer: the shipped project rules match Windows spellings like the plain
// ones (npm is npm.cmd and git is git.exe on Windows), without loosening anything else.
const shipped = loadCommandRules(root);
assert.equal(shipped.status, "ok");
// A quoted command line (`ssh host 'rm -rf /'`) is only read for the programs some rule targets: the
// built-in rules name theirs in `programs` (a rule added later must too, or it is never checked there),
// and each rules-file rule contributes the program it starts with.
for (const rule of BUILTIN_COMMAND_RULES) {
	assert.ok(Array.isArray(rule.programs) && rule.programs.length > 0, `built-in rule ${rule.id} lists no programs; add them so quoted command lines are checked against it`);
}
// The unwrapped shells and destructive-command programs, then the self-protection rules' programs: every way to start
// the Heli CLI (heli, heli-harness, node .../heli.mjs, the package runners) and the host CLIs whose plugin removal is denied.
assert.deepEqual([...commandProgramNames()].sort(), [
	"axga", "bash", "bun", "bunx", "claude", "cmd", "codex", "cursor", "dash", "del", "deno", "erase", "eval", "find", "fish", "git", "grok", "heli", "heli-harness", "heli.mjs", "kimi", "ksh", "node", "npm", "npx", "opencode", "pi", "pnpm", "pnpx", "powershell", "pwsh", "rd", "remove-item", "ri", "rm", "rmdir", "sh", "yarn", "zsh",
]);
for (const program of ["npm", "pnpm", "yarn", "git", "heli", "heli.mjs", "rm"]) {
	assert.ok(commandProgramNames(shipped.projectRules).has(program), `${program} is a rule program`);
}
assert.ok(!commandProgramNames(shipped.projectRules).has("ssh"), "ssh runs commands but no rule targets it");
const RULES_TABLE = [
	["npm publish", ["npm-publish"]],
	["npm.cmd publish", ["npm-publish"]],
	["NPM.CMD PUBLISH --tag next", ["npm-publish"]],
	["\"C:\\Program Files\\nodejs\\npm.cmd\" publish", ["npm-publish"]],
	["pnpm.cmd publish", ["pnpm-publish"]],
	["yarn.cmd publish", ["yarn-publish"]],
	["npm.cmd run release", ["npm-run-release"]],
	["npm.cmd version patch", ["npm-version"]],
	["git.exe tag v1.0.0", ["git-tag"]],
	["GIT.EXE -C repo tag v1.0.0", ["git-tag"]],
	["heli.cmd push", ["heli-cloud-push"]],
	["heli.exe sync", ["heli-cloud-sync"]],
	["heli.ps1 sync --auto on", ["heli-cloud-sync"]],
	["node .heli-harness/heli.mjs push", ["heli-mjs-cloud-push"]],
	["node.exe .heli-harness\\heli.mjs sync", ["heli-mjs-cloud-sync"]],
	["npm.cmd test", []],
	["npmx.cmd publish", []],
	["mynpm.cmd publish", []],
	["git.exe status", []],
	["heli.cmd status", []],
	["echo npm.cmd publisher", []],
	// A quoted command line whose first command word is a program the rules file targets.
	["ssh host 'npm publish'", ["npm-publish"]],
	["ssh host 'npm.cmd publish'", ["npm-publish"]],
	["ssh host 'heli push'", ["heli-cloud-push"]],
	["su -c 'git tag v1.0.0'", ["git-tag"]],
	["watch 'pnpm publish'", ["pnpm-publish"]],
	["ssh host 'npm test'", []],
	["echo 'npm publish is blocked'", []],
	["git commit -m 'npm publish flow notes'", []],
	["notes 'Npm publish is blocked'", []],
	["\"reason\": \"npm publish is a release operation\",", []],
	["const cmd = 'heli push';", []],
];
// The programs the rules file names come from the loaded rules, so this goes through evaluateCommandRules.
for (const [command, expected] of RULES_TABLE) {
	const evaluation = evaluateCommandRules(root, command, {});
	const got = [...evaluation.hardDenies, ...evaluation.approvals].map((match) => match.id).sort();
	assert.deepEqual(got, [...expected].sort(), `rules-file layer for ${JSON.stringify(command)}`);
}

// A command given as an argv list reads as the shell-quoted join of its elements: every element
// stays one word, whatever it holds, and words that need no quoting are left alone.
assert.equal(argvCommandText(["bash", "-lc", "git push --force"]).text, "bash -lc 'git push --force'");
assert.equal(argvCommandText(["echo", "it's", "", "a b"]).text, "echo 'it'\\''s' '' 'a b'");
assert.equal(argvCommandText(["git", "-C", "/repo/x", "commit", "-m", "wip"]).text, "git -C /repo/x commit -m wip");
assert.equal(argvCommandText([]).text, "");
for (const notWords of [["a", 1], ["a", null], [["a"]], [undefined], "bash -c x", null, 5]) {
	assert.ok(argvCommandText(notWords).error, `${JSON.stringify(notWords)} is not a list of strings`);
}
for (const word of ["a b", "it's", "say \"hi\"", "$HOME", "`x`", "a;b", "a&&b", "a|b", "(x)", "*", "~", "a\nb", "C:\\Program Files\\x", "x=y", "#c", "{a,b}", "a>b"]) {
	const posix = analyzeCommand(argvCommandText(["run", word, "end"]).text).segments.find((segment) => segment.dialect === "posix");
	assert.deepEqual(posix.rawTokens, ["run", word, "end"], `${JSON.stringify(word)} survives the quoting as one word`);
}

// ------------------------------------------------------ analysis budget
// Hosts treat a hook that times out as an allow, so analysis runs on a deterministic
// budget (counts, never wall-clock) and a command over it is denied fail-closed. Without
// one, `rm` x20000 took 60 s, `sed ` x50000 took 8 s and `eval` x400 took 3 s here (the
// hook timeout is 30 s), and nesting deeper than four layers was skipped silently.
const LIMITS = COMMAND_ANALYSIS_LIMITS;
const nestedBash = (levels, inner) => {
	let command = inner;
	for (let i = 0; i < levels; i += 1) command = `bash -c ${JSON.stringify(command)}`;
	return command;
};
const exceeded = (command, options) => analyzeCommand(command, options).limitExceeded;

// Each limit on its own: just inside is analyzed in full, just outside is refused.
assert.equal(exceeded("x".repeat(LIMITS.maxCommandChars)), null);
assert.equal(exceeded("x".repeat(LIMITS.maxCommandChars + 1))?.limit, "command-chars");
assert.equal(exceeded("w ".repeat(LIMITS.maxSegmentTokens)), null);
assert.equal(exceeded("w ".repeat(LIMITS.maxSegmentTokens + 1))?.limit, "segment-tokens");
assert.equal(exceeded("a;".repeat(Math.floor(LIMITS.maxTokens / 4))), null);
assert.equal(exceeded("a;".repeat(LIMITS.maxTokens))?.limit, "tokens");
assert.equal(exceeded(nestedBash(LIMITS.maxNesting, "echo hi")), null);
assert.equal(analyzeCommand(nestedBash(LIMITS.maxNesting, "echo hi")).work.nesting, LIMITS.maxNesting, "the deepest allowed layer is really analyzed");
assert.equal(exceeded(nestedBash(LIMITS.maxNesting + 1, "echo hi"))?.limit, "nesting", "deeper nesting used to be skipped silently");
assert.equal(exceeded("eval eval eval eval rm -rf build"), null, "four nested evals still fit");
assert.equal(exceeded("eval eval eval eval eval rm -rf build")?.limit, "nesting");
assert.equal(exceeded("bash -c 'a b' && bash -c 'c d'", { limits: { ...LIMITS, maxScanChars: 20 } })?.limit, "scan-chars");
const oversizedSegment = exceeded("w ".repeat(LIMITS.maxSegmentTokens + 1));
assert.equal(oversizedSegment.max, LIMITS.maxSegmentTokens);
assert.match(oversizedSegment.message, new RegExp(String(LIMITS.maxSegmentTokens)), "the message names the limit");

// Regexes that backtrack quadratically on one long token or whitespace run would defeat
// the counters above (they see only a couple of words), so they are pinned separately.
// The 1 s bound is below what the unfixed code took here (2.3 s, 1.8 s, 1.8 s) and far
// above what the fixed code takes (under 50 ms).
function within(limitMs, label, fn) {
	const startedAt = Date.now();
	const value = fn();
	const elapsed = Date.now() - startedAt;
	assert.ok(elapsed < limitMs, `${label} took ${elapsed} ms (limit ${limitMs} ms)`);
	return value;
}
const nearLimit = LIMITS.maxCommandChars - 10;
assert.equal(within(1000, "bash -ccc...c! at the size limit", () => analyzeCommand(`bash -${"c".repeat(nearLimit)}!`)).limitExceeded, null, "a long flag token is analyzed, quickly");
assert.equal(within(1000, "sed regex, 4x the size limit", () => isLikelyShellMutation("Bash", "sed ".repeat(LIMITS.maxCommandChars))), true, "over the command limit the heuristics are skipped");
assert.equal(within(1000, "sed + spaces to the size limit", () => isLikelyShellMutation("Bash", `sed${" ".repeat(nearLimit)}`)), true);
assert.equal(within(1000, "perl + tabs to the size limit", () => isLikelyShellMutation("Bash", `perl${"\t".repeat(nearLimit)}`)), true);
// Short text keeps the exact in-place check; long text treats any sed/perl as an edit.
assert.equal(isLikelyShellMutation("Bash", "sed -i s/a/b/ f"), true);
assert.equal(isLikelyShellMutation("Bash", "sed -n p f"), false);
assert.equal(isLikelyShellMutation("Bash", "echo hello; ".repeat(1100)), false, "a long command without a writer is not a mutation");
assert.equal(isLikelyShellMutation("Bash", `${"echo hello; ".repeat(1100)}sed -n p f`), true, "a long command that runs sed counts as an edit");

// ------------------------------------------------------------ evaluation
function workspace(name, rulesText = shippedRules, taskText = "# Current Task\n\nTarget repo: demo\n\nCurrent status: in progress\n\nFailed attempts count: 0\n") {
	const dir = join(scratch, name);
	mkdirSync(join(dir, ".heli-harness", "state"), { recursive: true });
	writeFileSync(join(dir, ".heli-harness", "HARNESS.md"), "# Heli\n");
	writeFileSync(join(dir, ".heli-harness", "state", "current-task.md"), taskText);
	if (rulesText != null) {
		mkdirSync(join(dir, ".heli-harness", "safety"), { recursive: true });
		writeFileSync(join(dir, ".heli-harness", "safety", "command-rules.json"), rulesText);
	}
	return dir;
}

function bash(cwd, command, extraEnv = {}) {
	return evaluatePreToolUse({ cwd, host: "test", env: { ...env, ...extraEnv }, toolName: "Bash", toolInput: { command } });
}

function writeFile(cwd, filePath) {
	return evaluatePreToolUse({ cwd, host: "test", env, toolName: "Write", toolInput: { file_path: filePath, content: "x" } });
}

function tool(cwd, toolName, toolInput, extraEnv = {}) {
	return evaluatePreToolUse({ cwd, host: "test", env: { ...env, ...extraEnv }, toolName, toolInput });
}

function grant(ws, action) {
	return issueGrant(ws, { action, scope: "once", resource: { type: "workspace", id: projectWorkspaceKey(ws, { env }) }, env });
}

function remainingUses(ws, grantId) {
	return listGrants(ws, { activeOnly: false, env }).find((item) => item.grantId === grantId).remainingUses;
}

const FAIL_CLOSED_PREFIX = "Heli-Harness could not evaluate this action (COMMAND_TOO_COMPLEX: ";

/** A command over the analysis budget is a hard deny in the fail-closed format, decided fast. */
function assertTooComplex(dir, command, label, extraEnv = {}, toolInput = null) {
	const startedAt = Date.now();
	const result = toolInput ? tool(dir, "Bash", toolInput, extraEnv) : bash(dir, command, extraEnv);
	const elapsed = Date.now() - startedAt;
	assert.equal(result.code, "COMMAND_TOO_COMPLEX", `${label}: ${result.reason}`);
	assert.equal(result.deny, true, label);
	assert.equal(result.hardDeny, true, label);
	assert.ok(result.reason.startsWith(FAIL_CLOSED_PREFIX), `${label}: ${result.reason}`);
	assert.match(result.reason, /\); denying \(fail-closed\)\./, label);
	assert.match(result.reason, /Write or Edit tool for large file content/, label);
	assert.match(result.reason, /split the command/, label);
	assert.ok(elapsed < 5000, `${label}: took ${elapsed} ms`);
}

// Deterministic prose for the large-command pins. Apostrophes, double quotes and backticks
// come in pairs on every line, so the text stays balanced however the parser pairs them up.
const PROSE_LINES = [
	(n) => `Step ${n}: keep the parser's limits pinned; don't let one large note trip them.`,
	(n) => `The hook reads note ${n} once (it is cheap), then moves on to the next line & the next.`,
	(n) => `Use \`git status\` first, then compare the result with \`git diff\` before item ${n}.`,
	(n) => `| item ${n} | owner | status | next step |`,
	(n) => `Review item ${n}: the rollout plan, the rollback plan, and who signs off on each of them.`,
	(n) => `Item ${n} says "check twice" and "commit once", which is the whole point of this note.`,
	(n) => `Paragraph ${n}: this line keeps going for a while, mixing plain words with commas, a colon: like this, and a dash - like that, so words per line look like a real document instead of a list of short items.`,
	() => "",
	(n) => `Item ${n} reads "git push is blocked" in the log, and "rm -rf build" only in the docs.`,
];
// Inside a double-quoted commit message only lines without double quotes or backticks are used.
const QUOTE_FREE_LINES = [0, 1, 3, 4, 6, 7];
const proseLines = (count, { quoted = true } = {}) =>
	Array.from({ length: count }, (_, i) => PROSE_LINES[quoted ? i % PROSE_LINES.length : QUOTE_FREE_LINES[i % QUOTE_FREE_LINES.length]](i + 1));
const LARGE_COMMANDS = [
	["git commit -m with a 50-line message", `git commit -m "${proseLines(50, { quoted: false }).join("\n")}"`],
	["git commit -m with a 50-line heredoc message", `git commit -m "$(cat <<'EOF'\n${proseLines(50).join("\n")}\n\nCo-Authored-By: Someone <someone@example.com>\nEOF\n)"`],
	["cat > notes.md heredoc of 200 lines", `cat > notes.md <<'EOF'\n${proseLines(200).join("\n")}\nEOF`],
];
// Every meter of a realistic large command stays under 1/HEADROOM of its limit.
const HEADROOM = 2;

try {
	const ws = workspace("main");

	// A granted T5 cannot hide a T6 in the same command; the T5 grant is not spent.
	const tagGrant = grant(ws, "command.approval.git-tag");
	const mixed = bash(ws, "git tag v1.0.0 && rm -rf build");
	assert.equal(mixed.deny, true);
	assert.equal(mixed.hardDeny, true);
	assert.equal(mixed.code, "TIER_BLOCKED");
	assert.deepEqual(mixed.ruleIds, ["destructive-delete"]);
	assert.equal(remainingUses(ws, tagGrant.grantId), 1, "a denied call must not consume the T5 grant");

	// T6 is never approvable: not by HELI_ALLOW_COMMAND, not by YOLO.
	assert.equal(bash(ws, "rm -rf build", { HELI_ALLOW_COMMAND: "destructive-delete" }).code, "TIER_BLOCKED");
	assert.equal(bash(ws, "git reset --hard", { HELI_YOLO: "1" }).code, "TIER_BLOCKED");
	assert.match(bash(ws, "rm -rf build").reason, /tier T6.*hard deny/s);

	// Every matched T5 needs its own approval; consumption happens only on allow.
	const needsTwo = bash(ws, "git tag v1.0.0 && npm publish");
	assert.equal(needsTwo.deny, true);
	assert.equal(needsTwo.code, "TIER_APPROVAL_REQUIRED");
	assert.deepEqual(needsTwo.missingApprovals, ["command.approval.npm-publish"]);
	assert.equal(remainingUses(ws, tagGrant.grantId), 1);
	const publishGrant = grant(ws, "command.approval.npm-publish");
	const both = bash(ws, "git tag v1.0.0 && npm publish");
	assert.equal(both.deny, false, both.reason);
	assert.deepEqual(both.grants.map((item) => item.action).sort(), ["command.approval.git-tag", "command.approval.npm-publish"]);
	assert.equal(remainingUses(ws, tagGrant.grantId), 0);
	assert.equal(remainingUses(ws, publishGrant.grantId), 0);

	// Force push is its own T5 on top of git.push.
	const pushGrant = grant(ws, "git.push");
	const force = bash(ws, "git push --force origin main");
	assert.equal(force.deny, true);
	assert.deepEqual(force.missingApprovals, ["command.approval.git-push-force"]);
	assert.equal(remainingUses(ws, pushGrant.grantId), 1);
	grant(ws, "command.approval.git-push-force");
	assert.equal(bash(ws, "git push --force origin main").deny, false);

	// Legitimate commands stay allowed; a valid grant allows a plain push.
	for (const command of ["rm -f build.log", "git clean -n", "Remove-Item file.txt", "git status", "npm test"]) {
		const result = bash(ws, command);
		assert.equal(result.deny, false, `${command}: ${result.reason}`);
	}
	grant(ws, "git.push");
	assert.equal(bash(ws, "git push origin main").deny, false);
	assert.equal(bash(ws, "git push origin main").code, "REMOTE_PUSH_DENIED", "a once grant allows exactly one push");

	// Windows spellings need the same approvals as the plain commands, and each grant is spent once.
	const spelled = workspace("spellings");
	const spelledPublish = bash(spelled, "NPM.CMD PUBLISH");
	assert.equal(spelledPublish.code, "TIER_APPROVAL_REQUIRED", spelledPublish.reason);
	assert.deepEqual(spelledPublish.missingApprovals, ["command.approval.npm-publish"]);
	const spelledPublishGrant = grant(spelled, "command.approval.npm-publish");
	assert.equal(bash(spelled, "\"C:\\Program Files\\nodejs\\npm.cmd\" publish").deny, false);
	assert.equal(remainingUses(spelled, spelledPublishGrant.grantId), 0);
	assert.equal(bash(spelled, "GIT.EXE -C . push origin main").code, "REMOTE_PUSH_DENIED");
	assert.deepEqual(bash(spelled, "git.exe push --force").missingApprovals, ["git.push", "command.approval.git-push-force"]);
	const spelledPushGrant = grant(spelled, "git.push");
	assert.equal(bash(spelled, "& \"C:\\Program Files\\Git\\cmd\\git.exe\" push origin main").deny, false);
	assert.equal(remainingUses(spelled, spelledPushGrant.grantId), 0);

	// Over the analysis budget: refused quickly and identically with or without a Heli
	// workspace, and neither an override (YOLO, HELI_ALLOW_COMMAND) nor a grant changes it.
	const roomy = workspace("budget");
	const bare = join(scratch, "no-heli-budget");
	mkdirSync(bare, { recursive: true });
	const PATHOLOGICAL = [
		["rm x20000", `${"rm ".repeat(20000)}-rf x`],
		["eval x400", `${"eval ".repeat(400)}x`],
		["eval x40 then rm -rf", `${"eval ".repeat(40)}rm -rf build`],
		["nested bash -c x8", nestedBash(8, "echo hi")],
		["sed x50000 (200 KB)", "sed ".repeat(50000)],
		["one more one-word command than the word limit", "a;".repeat(LIMITS.maxTokens + 1)],
		["a single word of twice the size limit", `echo ${"x".repeat(LIMITS.maxCommandChars * 2)}`],
	];
	for (const [label, command] of PATHOLOGICAL) {
		assertTooComplex(roomy, command, label);
		assertTooComplex(bare, command, `${label} (no Heli binding)`);
	}
	assertTooComplex(roomy, `${"eval ".repeat(400)}x`, "YOLO does not lift the budget", { HELI_YOLO: "1", HELI_ALLOW_COMMAND: "command-too-complex" });
	const budgetGrant = grant(roomy, "command.approval.git-tag");
	assertTooComplex(roomy, `git tag v1.0.0 && ${"eval ".repeat(400)}x`, "a granted T5 in an over-budget command");
	assert.equal(remainingUses(roomy, budgetGrant.grantId), 1, "a refused call must not consume the T5 grant");

	// Realistic large commands are analyzed in full and allowed, with room to spare. A
	// sentinel `rm -rf build` after the text is still found, so nothing was skipped.
	for (const [label, command] of LARGE_COMMANDS) {
		const analysis = analyzeCommand(command);
		assert.equal(analysis.limitExceeded, null, label);
		for (const [meter, limit] of [["commandChars", "maxCommandChars"], ["scannedChars", "maxScanChars"], ["tokens", "maxTokens"], ["segmentTokens", "maxSegmentTokens"]]) {
			assert.ok(analysis.work[meter] * HEADROOM <= LIMITS[limit], `${label}: ${meter} ${analysis.work[meter]} is over 1/${HEADROOM} of ${limit} ${LIMITS[limit]}`);
		}
		const allowed = bash(roomy, command);
		assert.equal(allowed.deny, false, `${label}: ${allowed.reason}`);
		assert.equal(bash(roomy, `${command}\nrm -rf build`).code, "TIER_BLOCKED", `${label}: the sentinel after it must still be found`);
	}

	// File-editing tools carry data being written, not a command being run, so command rules
	// (the T6 floor, the rules file, the git push gate and the size budget) never read their
	// content. A tool is one of these by NAME, from the same list that marks it a file writer;
	// any other tool that carries a command stays analyzed, whatever its name suggests.
	const editing = workspace("editing");
	const makefilePatch = "*** Begin Patch\n*** Update File: Makefile\n@@ clean:\n \t@echo cleaning\n+\trm -rf build\n*** End Patch\n";
	const patched = tool(editing, "apply_patch", { command: makefilePatch });
	assert.equal(patched.deny, false, `an apply_patch that adds "rm -rf build" to a Makefile: ${patched.reason}`);
	const hugePatch = `*** Begin Patch\n*** Add File: docs/big.txt\n${`+${"x".repeat(70)}\n`.repeat(Math.ceil((LIMITS.maxCommandChars * 2) / 72))}*** End Patch\n`;
	assert.ok(hugePatch.length > LIMITS.maxCommandChars * 2, "the patch is over twice the size limit");
	const bigPatched = tool(editing, "apply_patch", { command: hugePatch });
	assert.equal(bigPatched.deny, false, `an apply_patch over the size limit: ${bigPatched.reason}`);
	const written = tool(editing, "Write", { file_path: "notes.txt", content: "git push --force origin main\n" });
	assert.equal(written.deny, false, `a Write whose content is a git push: ${written.reason}`);
	assert.equal(bash(editing, "rm -rf build").code, "TIER_BLOCKED", "control: the same text as a shell command is still a T6");
	for (const name of [...DEFAULT_FILE_WRITE_TOOL_NAMES, "APPLY_PATCH", "Fs.Write"]) {
		const result = tool(editing, name, { file_path: "notes.txt", command: "rm -rf build && git push --force origin main" });
		assert.equal(result.deny, false, `${name}: every name on the write-tool list is skipped, in any case: ${result.reason}`);
	}
	// The list is the caller's when it passes one (a host may declare its own writers).
	const customInput = { file_path: "notes.txt", command: "rm -rf build" };
	assert.equal(evaluatePreToolUse({ cwd: editing, host: "test", env, toolName: "custom_edit", toolInput: customInput, writeToolNames: ["custom_edit"] }).deny, false);
	assert.equal(evaluatePreToolUse({ cwd: editing, host: "test", env, toolName: "custom_edit", toolInput: customInput }).code, "TIER_BLOCKED", "not on the default list, so analyzed");
	assert.equal(evaluatePreToolUse({ cwd: editing, host: "test", env, toolName: "apply_patch", toolInput: customInput, writeToolNames: ["custom_edit"] }).code, "TIER_BLOCKED", "a custom list replaces the default one");
	assert.equal(isFileWriteToolName("apply_patch"), true);
	assert.equal(isFileWriteToolName("APPLY_PATCH"), true);
	assert.equal(isFileWriteToolName("Bash"), false);
	assert.equal(isFileWriteToolName("mcp__fs__write_file"), false, "a name that only looks like a writer is not on the list");
	assert.equal(isFileWriteToolName(undefined), false);
	assert.equal(isFileWriteToolName("Edit", null), true, "no list means the default list");
	assert.equal(isFileWriteToolName("custom_edit", ["custom_edit"]), true);
	assert.equal(isFileMutationTool("mcp__fs__write_file", { paths: ["notes.txt"] }), true, "isFileMutationTool keeps its path-aware fallback");

	// Fail toward analysis: a tool that is not on the list is analyzed as before, even one that
	// looks like a file writer and carries a path.
	for (const unrecognized of ["run_thing", "custom_runner", "mcp__fs__write_file", "PowerShell"]) {
		const result = tool(editing, unrecognized, { file_path: "notes.txt", command: "rm -rf build" });
		assert.equal(result.code, "TIER_BLOCKED", `${unrecognized}: ${result.reason}`);
	}
	assert.equal(tool(editing, "custom_runner", { command: hugePatch }).code, "COMMAND_TOO_COMPLEX", "an unrecognized tool still gets the size budget");
	assert.equal(tool(editing, "Bash", { description: "rm -rf build" }).code, "TIER_BLOCKED", "the description fallback for tools that are not file editors is unchanged");

	// Path extraction and every write check still run for the file-editing tools.
	assert.equal(tool(editing, "apply_patch", { command: "*** Begin Patch\n*** Add File: .env\n+X=1\n*** End Patch\n" }).code, "ENV_WRITE_DENIED", "the patch path is still read");
	const stuckEditing = workspace("editing-stuck", shippedRules, "# Current Task\n\nTarget repo: demo\n\nCurrent status: blocked\n\nFailed attempts count: 2\n");
	assert.match(tool(stuckEditing, "apply_patch", { command: makefilePatch }).reason, /failed attempts/, "the stuck-task gate sees the patch instead of a T6 false positive");
	const concurrentEditing = workspace("editing-concurrent");
	mkdirSync(join(concurrentEditing, ".heli-harness", "workspace"), { recursive: true });
	writeFileSync(join(concurrentEditing, ".heli-harness", "workspace", "schema.json"), JSON.stringify({ schemaVersion: 1, mode: "concurrent" }));
	createTask(concurrentEditing, { taskId: "t1", repositoryId: "demo", worktreePath: concurrentEditing });
	const unboundPatch = tool(concurrentEditing, "apply_patch", { command: makefilePatch });
	const unboundWrite = tool(concurrentEditing, "Write", { file_path: "Makefile", content: "clean:\n\trm -rf build\n" });
	assert.equal(unboundWrite.deny, true, "control: a Write without a bound session is refused");
	assert.equal(unboundPatch.code, unboundWrite.code, `an unbound apply_patch reaches the same ownership gate as a Write: ${unboundPatch.reason}`);

	// One `once` grant pays for one approval. A wildcard once-grant matches both requirements of
	// `git tag && npm publish`, so the call is refused BEFORE anything is consumed.
	const multi = workspace("multiplicity");
	const multiResource = { type: "workspace", id: projectWorkspaceKey(multi, { env }) };
	const wildcardOnce = issueGrant(multi, { action: "command.approval.*", scope: "once", resource: multiResource, env });
	const twoApprovals = bash(multi, "git tag v1.0.0 && npm publish");
	assert.equal(twoApprovals.deny, true);
	assert.equal(twoApprovals.code, "TIER_APPROVAL_REQUIRED", twoApprovals.reason);
	assert.deepEqual(twoApprovals.missingApprovals, ["command.approval.npm-publish"]);
	assert.equal(remainingUses(multi, wildcardOnce.grantId), 1, "a refused call must not spend the grant");
	const publishOnce = grant(multi, "command.approval.npm-publish");
	const paidTwice = bash(multi, "git tag v1.0.0 && npm publish");
	assert.equal(paidTwice.deny, false, paidTwice.reason);
	assert.equal(remainingUses(multi, wildcardOnce.grantId), 0, "the wildcard grant paid for the first approval");
	assert.equal(remainingUses(multi, publishOnce.grantId), 0, "the specific grant paid for the second");
	// A grant without a use limit covers any number of approvals and is never spent.
	const unlimitedWs = workspace("multiplicity-unlimited");
	issueGrant(unlimitedWs, { action: "command.approval.*", scope: "workspace", resource: { type: "workspace", id: projectWorkspaceKey(unlimitedWs, { env }) }, env });
	assert.equal(bash(unlimitedWs, "git tag v1.0.0 && npm publish").deny, false);
	assert.equal(bash(unlimitedWs, "git tag v1.0.0 && npm publish").deny, false, "a workspace grant is not spent");

	// A `command` given as an argv list (Codex's shell tool) is analyzed as the shell-quoted join of
	// its elements, not as their comma-joined text, so the floor and the push gate see it.
	const argvDir = workspace("argv");
	assert.equal(tool(argvDir, "Bash", { command: ["bash", "-lc", "rm -rf /"] }).code, "TIER_BLOCKED");
	assert.equal(tool(argvDir, "Bash", { command: ["bash", "-o", "pipefail", "-c", "rm -rf /"] }).code, "TIER_BLOCKED");
	assert.equal(tool(argvDir, "Bash", { command: ["rm", "-rf", "build"] }).code, "TIER_BLOCKED");
	assert.equal(tool(argvDir, "custom_runner", { command: ["rm", "-rf", "build"] }).code, "TIER_BLOCKED", "any tool that is not a file editor");
	assert.deepEqual(tool(argvDir, "Bash", { command: ["bash", "-lc", "git push --force origin main"] }).missingApprovals, ["git.push", "command.approval.git-push-force"]);
	assert.deepEqual(tool(argvDir, "Bash", { command: ["git", "push", "--force", "origin", "main"] }).missingApprovals, ["git.push", "command.approval.git-push-force"]);
	assert.deepEqual(tool(argvDir, "Bash", { command: ["npm", "publish"] }).missingApprovals, ["command.approval.npm-publish"]);
	assert.equal(tool(argvDir, "Bash", { command: ["ls", "-la"] }).deny, false);
	assert.equal(tool(argvDir, "Bash", { command: ["git", "commit", "-m", "notes on rm -rf and git push --force"] }).deny, false, "an argument is data, not a command");
	assert.equal(tool(argvDir, "Bash", { command: [] }).deny, false, "an empty list is an empty command");
	const argvGrant = grant(argvDir, "command.approval.npm-publish");
	assert.equal(tool(argvDir, "Bash", { command: ["npm", "publish"] }).deny, false, "an approved argv command runs");
	assert.equal(remainingUses(argvDir, argvGrant.grantId), 0);
	// A list with anything but strings cannot be read: fail closed, beyond YOLO.
	for (const malformed of [["bash", 5], ["bash", null], [["bash", "-c", "x"]], ["bash", { a: 1 }], [undefined, "x"]]) {
		const refused = tool(argvDir, "Bash", { command: malformed }, { HELI_YOLO: "1" });
		assert.equal(refused.code, "COMMAND_UNPARSEABLE", `${JSON.stringify(malformed)}: ${refused.reason}`);
		assert.equal(refused.hardDeny, true);
		assert.ok(refused.reason.startsWith("Heli-Harness could not evaluate this action (COMMAND_UNPARSEABLE: "), refused.reason);
		assert.match(refused.reason, /\); denying \(fail-closed\)\./);
	}
	assert.equal(tool(argvDir, "Write", { file_path: "notes.txt", command: ["bash", 5] }).deny, false, "file-editing tools are not analyzed");
	// The size budget covers lists too, and a huge list is refused without quoting all of it.
	assertTooComplex(argvDir, undefined, "a list of 200000 words", {}, { command: Array(200000).fill("x") });
	assertTooComplex(argvDir, undefined, "a list with one word of twice the size limit", {}, { command: ["echo", "x".repeat(LIMITS.maxCommandChars * 2)] });
	assertTooComplex(argvDir, undefined, "an over-limit list whose tail is malformed", {}, { command: [...Array(LIMITS.maxCommandChars).fill("xy"), 5] });
	// A quoted command line handed to a program that runs it is analyzed through the whole hook.
	const quotedDir = workspace("quoted");
	for (const command of ["su -c 'rm -rf /'", "sudo -s 'rm -rf /'", "env -S 'rm -rf /'", "ssh host 'rm -rf /'", "watch 'rm -rf /'", "flock f -c 'rm -rf /'", "script -c 'rm -rf /' out", "docker exec c sh -c 'rm -rf /'"]) {
		assert.equal(bash(quotedDir, command).code, "TIER_BLOCKED", command);
	}
	assert.deepEqual(bash(quotedDir, "ssh host 'git push --force origin main'").missingApprovals, ["git.push", "command.approval.git-push-force"]);
	assert.deepEqual(bash(quotedDir, "ssh host 'git push origin main'").missingApprovals, ["git.push"]);
	assert.deepEqual(bash(quotedDir, "ssh host 'npm publish'").missingApprovals, ["command.approval.npm-publish"]);
	assert.equal(bash(quotedDir, "ssh host 'heli push'").code, "TIER_APPROVAL_REQUIRED");
	// Text stays allowed: messages, printed lines, search patterns and prose, heredoc bodies included.
	for (const text of [
		"git commit -m \"fix: rm -rf handling\"",
		"git commit -m \"Tighten the guard\n\nThe old matcher flagged rm -rf and git push --force anywhere in a message.\"",
		"echo 'git push is blocked'",
		"git commit -m 'git push wrapper notes'",
		"grep -rn 'rm -rf' scripts",
		"cat > notes.md <<'EOF'\nHe said \"git push is blocked\" twice.\n- Use \"rm -rf build\" with care.\nEOF",
		"cat > rules.json <<'EOF'\n{ \"rules\": [ { \"id\": \"x\", \"match\": \"git reset --hard\", \"reason\": \"git reset --hard is destructive\" } ] }\nEOF",
		"cat > probe.mjs <<'EOF'\nfor (const command of [\"git push --force\", \"rm -rf build\", \"npm publish\"]) {\n\tconst r = run({ command: \"git reset --hard\" });\n}\nEOF",
		"ssh host 'git status'",
	]) {
		const result = bash(quotedDir, text);
		assert.equal(result.deny, false, `${JSON.stringify(text)}: ${result.reason}`);
	}
	// The extra analysis runs on the same budget. 250 quoted words that start with a rule program are
	// analyzed in full (the T6 in them is found, harmless ones stay allowed); a command line full of them
	// that would take more words than the budget allows is refused, and both are quick.
	const quotedWords = (count, program, salt = "") => Array.from({ length: count }, (_, i) => `'${program} d${salt}${i}'`).join(" ");
	for (const [label, command, expected] of [
		["250 quoted words starting with rm -rf", `wrap ${quotedWords(250, "rm -rf")}`, "TIER_BLOCKED"],
		["250 harmless quoted words starting with git", `wrap ${quotedWords(250, "git status")}`, undefined],
	]) {
		const startedAt = Date.now();
		const result = bash(quotedDir, command);
		assert.equal(result.code, expected, `${label}: ${result.reason}`);
		assert.ok(Date.now() - startedAt < 5000, `${label} took ${Date.now() - startedAt} ms`);
	}
	assertTooComplex(quotedDir, Array.from({ length: 12 }, (_, i) => `wrap ${quotedWords(250, "git status", String(i))}`).join("; "), "12 commands of 250 quoted words that start with rule programs");
	assertTooComplex(quotedDir, Array.from({ length: 12 }, (_, i) => `wrap ${quotedWords(250, "rm -rf", String(i))}`).join("; "), "12 commands of 250 quoted words that start with rm -rf");

	// A list is judged like the same command written as a string, mutation checks included.
	for (const [list, text] of [[["git", "add", "."], "git add ."], [["npm", "install"], "npm install"], [["sed", "-i", "s/a/b/", "f"], "sed -i s/a/b/ f"], [["ls", "-la"], "ls -la"]]) {
		assert.equal(tool(concurrentEditing, "Bash", { command: list }).code, tool(concurrentEditing, "Bash", { command: text }).code, `${JSON.stringify(list)} is judged like ${JSON.stringify(text)}`);
	}

	// A grant is not consumed when a later check denies (stuck task gate).
	const stuck = workspace("stuck", shippedRules, "# Current Task\n\nTarget repo: demo\n\nCurrent status: blocked\n\nFailed attempts count: 2\n");
	const envGrant = grant(stuck, "env.write");
	const stuckWrite = writeFile(stuck, ".env");
	assert.equal(stuckWrite.deny, true);
	assert.match(stuckWrite.reason, /failed attempts/);
	assert.equal(remainingUses(stuck, envGrant.grantId), 1, "env.write grant must survive a later deny");

	// Rules file states. Built-ins survive an empty file; a project rule cannot
	// weaken a built-in id.
	const empty = workspace("empty-rules", JSON.stringify({ version: 1, rules: [] }));
	assert.equal(bash(empty, "rm -rf build").code, "TIER_BLOCKED");
	assert.equal(bash(empty, "npm publish").deny, false, "no project T5 rules -> npm publish is not gated");
	const weakened = workspace("weakened-rules", JSON.stringify({ version: 1, rules: [{ id: "destructive-delete", match: "rm -rf", tier: "T4", reason: "downgrade attempt" }] }));
	assert.equal(bash(weakened, "rm -rf build").code, "TIER_BLOCKED");

	for (const [name, rulesText, status] of [["malformed-rules", "{not json", "malformed"], ["missing-rules", null, "missing"]]) {
		const dir = workspace(name, rulesText);
		const denied = bash(dir, "git status");
		assert.equal(denied.code, "COMMAND_RULES_UNAVAILABLE", `${name}: ${denied.reason}`);
		assert.match(denied.reason, new RegExp(`command-rules\\.json is ${status}`));
		assert.equal(writeFile(dir, "notes.txt").deny, false, `${name}: file edits are not affected`);
		assert.equal(bash(dir, "rm -rf build").code, "TIER_BLOCKED", `${name}: the built-in floor still applies`);
		assert.equal(bash(dir, "git status", { HELI_YOLO: "1" }).deny, false, `${name}: YOLO skips approval rules`);
	}

	// A directory with no Heli binding at all must not start denying everything.
	const plain = join(scratch, "no-heli");
	mkdirSync(plain, { recursive: true });
	for (const command of ["npm test", "git status", "ls -la"]) {
		assert.equal(bash(plain, command).deny, false, `no-binding ${command}`);
	}
	assert.equal(writeFile(plain, "notes.txt").deny, false);
	assert.equal(bash(plain, "rm -rf /").code, "TIER_BLOCKED", "the T6 floor applies everywhere hooks run");

	console.log("command rules smoke ok");
} finally {
	rmSync(scratch, { recursive: true, force: true });
}
