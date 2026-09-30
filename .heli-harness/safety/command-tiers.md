# Command Tiers

**Current release:** `v0.10.4`

`command-rules.json` is a runtime guard policy source where compatible host hooks expose sufficient structured input. The current classifier normalizes common command forms, destructive variants, shell redirection writes, sensitive paths, and obvious secret-like write content before matching rules. This is not a sandbox and does not replace host permissions or executor containment.

Risk tiers summarize workflow impact; they are not authority levels. Actual permission depends on trusted policy, scoped grant when needed, current resource authority, and enforcement/evidence coverage.

## Built-in hard-deny floor

The kernel ships non-removable rules that apply even when this workspace's `command-rules.json` is empty. A project rule that reuses a built-in id is ignored, so a built-in can be neither removed nor weakened. Every rule is evaluated: any T6 match is a hard deny that scoped grants, YOLO and `HELI_ALLOW_COMMAND` cannot override, and each matched T5 rule needs its own approval.

- `destructive-delete` (T6): `rm` with recursive + force in any spelling (`-rf`, `-fr`, `-r -f`, `-Rf`, `--recursive --force`).
- `git-clean-force` (T6): `git clean` with `-f` plus `-d` and/or `-x` (dry runs excepted).
- `git-reset-hard` (T6): `git reset --hard`.
- `windows-rmdir` / `windows-del` (T6): `rd`/`rmdir` or `del`/`erase` with `/s`.
- `powershell-remove-item-recurse-force` (T6): `Remove-Item` (or an alias) with `-Recurse` and `-Force`, abbreviations included.
- `find-delete` (T6): `find ... -delete` without a name/path filter.
- `heli-privileged-command` / `heli-host-integration-removal` (T6): agent-run approvals, YOLO, takeovers, write transfers or removal of Heli; a human runs these in their own terminal.
- `git-push-force` (T5): `git push --force`, `-f`, `--force-with-lease` or a `+refspec`, on top of the `git.push` approval.

Commands are normalized before matching: quotes and escapes are removed, `git` global options (`-C`, `-c`, `--git-dir`, ...) are skipped, chains (`;`, `&&`, `||`, `|`, newlines) and subshells are split into segments, and `sh -c`, `bash -c`, `cmd /c`, `pwsh`/`powershell -Command` (and `-EncodedCommand`) payloads are evaluated too. A missing or unreadable `command-rules.json` in a Heli workspace denies shell commands until it is restored (`heli update` recreates it in an embedded workspace).

## T0 - Read-only inspection

- Examples: `rg`, `git status`, `cat`, `ls`
- Default guidance: usually allow

## T1 - Non-mutating validation

- Examples: `node --check`, `bash -n`, focused read-only lint
- Default guidance: usually allow

## T2 - Local mutation

- Examples: editing tracked files, local code generation inside the resolved resource scope
- Default guidance: allow only when target/resource authority and policy permit

## T3 - Dependency, build, or runtime actions

- Examples: dependency installation, local builds, runtime services, broad test commands
- Default guidance: evaluate side effects/cost and policy obligations

## T4 - Network, API, or cost-bearing actions

- Examples: billable API calls, remote downloads, hosted test runs
- Default guidance: require the applicable scoped approval/policy evidence

## T5 - Git, release, or deploy actions

- Examples: `git push`, `git tag`, `npm publish`, release creation
- Default guidance: explicit scoped approval plus target/resource validation

## T6 - Destructive, secret-bearing, or outside-root actions

- Examples: destructive reset/delete, secret exfiltration, forbidden outside-root mutation
- Default guidance: hard deny by default
- Normal temporary grants do not make T6 rules grantable.
