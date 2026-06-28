param(
  [string]$Parent = (Get-Location).Path
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Source = Join-Path $RepoRoot ".heli-harness"

if (-not (Test-Path $Source)) {
  throw "Source harness not found: $Source"
}

if (-not (Test-Path -LiteralPath $Parent -PathType Container)) {
    Write-Error "Parent directory does not exist: $Parent`nCreate it first or pass an existing directory."
    exit 1
}

$ParentFull = [System.IO.Path]::GetFullPath($Parent)
$Target = Join-Path $ParentFull ".heli-harness"

New-Item -ItemType Directory -Force -Path $Target | Out-Null

Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $Target -Recurse -Force
}

$agentsPath = Join-Path $ParentFull "AGENTS.md"
$claudePath = Join-Path $ParentFull "CLAUDE.md"

$agentsSnippet = "Read .heli-harness/adapters/codex/AGENTS.md first."
$claudeSnippet = "Read .heli-harness/adapters/claude/CLAUDE.md first."

if (Test-Path $agentsPath) {
  Write-Host "AGENTS.md already exists at $agentsPath"
  Write-Host "Append manually if desired:"
  Write-Host $agentsSnippet
} else {
  Set-Content -Path $agentsPath -Value $agentsSnippet
}

if (Test-Path $claudePath) {
  Write-Host "CLAUDE.md already exists at $claudePath"
  Write-Host "Append manually if desired:"
  Write-Host $claudeSnippet
} else {
  Set-Content -Path $claudePath -Value $claudeSnippet
}

$checks = @(
  (Join-Path $Target "HARNESS.md"),
  (Join-Path $Target "manifest.json"),
  (Join-Path $Target "skills"),
  (Join-Path $Target "adapters")
)

foreach ($check in $checks) {
  if (-not (Test-Path $check)) {
    throw "Install validation failed: missing $check"
  }
}

Write-Host ""
Write-Host "Heli-Harness installed to:"
Write-Host "  $Target"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Add repo profiles under $Target\profiles"
Write-Host "  2. Start agents from $ParentFull"
Write-Host "  3. Use this first-run prompt:"
Write-Host ""
Write-Host "Start from this parent workspace. Read HARNESS.md, identify the target repo, read its profile if present, then inspect repo-local docs. Update state/current-task.md before non-trivial edits. Task: <describe task>."
