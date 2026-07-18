# Windows / shell recipes (agent hosts)

Use these patterns on Windows PowerShell (and document host-specific notes in adapters). Prefer **script files** over complex inline one-liners when secrets or multi-line SQL are involved.

## Command chaining

PowerShell does **not** support bash `&&` in older hosts. Prefer:

```powershell
cmd1; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; cmd2
```

Or separate tool calls. Do not assume `&&` works.

## Terraform `-chdir`

Quote the path:

```powershell
terraform -chdir="C:\path\to\stack" plan
terraform -chdir=".\infra\gcp\terraform\stacks\prod-edge" apply
```

## Git commit message (PowerShell)

```powershell
@"
feat: short subject

Body if needed.
"@ | git commit -F -
```

Avoid bash heredoc `$(cat <<'EOF')` in PowerShell.

## GitHub PR body

```powershell
@"
## Summary
- ...
"@ | Set-Content -Encoding utf8 .pr-body.md
gh pr create --title "..." --body-file .pr-body.md
Remove-Item .pr-body.md
```

## Diff check and line endings

If the repo uses CRLF and `git diff --check` flags CR noise:

```powershell
git -c core.whitespace=cr-at-eol diff --check
```

Do not mass-convert EOL unless the repo policy requires it — that balloons the diff.

## Diagnostics with dependencies

Prefer running from the package that owns `node_modules` (e.g. `apps/api`), or use an explicit import path. Do not assume modules resolve from `.heli-harness/state/runs/`.

## DNS checks

Avoid PowerShell automatic `$Host` collision — use another variable name:

```powershell
$dnsName = "example.com"
Resolve-DnsName $dnsName -Type CNAME
```

## Classifying failures in task state

- **Command friction** (quoting, `&&`, module path, dotenv banner breaking JSON): increment `Command friction count`, fix the command, do **not** burn Failed attempts toward the two-strike engineering stop.
- **Implementation/fix failure** (tests fail after a real code change): increment `Failed attempts count`.
