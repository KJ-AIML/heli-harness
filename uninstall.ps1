param(
  [string]$Parent = (Get-Location).Path
)

$ErrorActionPreference = "Stop"

$ParentFull = [System.IO.Path]::GetFullPath($Parent)
$Target = Join-Path $ParentFull ".heli-harness"

if (-not (Test-Path $Target)) {
  Write-Host "No installed harness found at $Target"
  exit 0
}

Remove-Item -LiteralPath $Target -Recurse -Force

Write-Host "Removed Heli-Harness:"
Write-Host "  $Target"
Write-Host ""
Write-Host "Manual cleanup:"
Write-Host "  Review any AGENTS.md or CLAUDE.md snippets you created and remove them if no longer needed."
Write-Host "  Repos were not deleted."
