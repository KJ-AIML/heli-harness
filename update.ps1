param(
  [string]$Parent = "",
  [switch]$ResetState
)

$ErrorActionPreference = "Stop"

function Find-SourceHarness {
  $scriptRoot = Split-Path -Parent $MyInvocation.ScriptName
  $candidate = Join-Path $scriptRoot ".heli-harness"
  if (Test-Path (Join-Path $candidate "HARNESS.md")) {
    return $candidate
  }

  return $null
}

$Source = Find-SourceHarness
if (-not $Source) {
  Write-Host "No local repository checkout with .heli-harness was found."
  Write-Host "Update by cloning or entering the repo checkout, running git pull, then:"
  Write-Host "  .\update.ps1 -Parent <parent-workspace>"
  exit 1
}

if ([string]::IsNullOrWhiteSpace($Parent)) {
  $ParentFull = (Get-Location).Path
  $Target = Join-Path $ParentFull ".heli-harness"
} else {
  $ParentFull = [System.IO.Path]::GetFullPath($Parent)
  $Target = Join-Path $ParentFull ".heli-harness"
}

if (-not (Test-Path $Target)) {
  throw "Target harness does not exist: $Target. Run install.ps1 first."
}

Get-ChildItem -LiteralPath $Source -Force | Where-Object { $_.Name -ne "state" -or $ResetState } | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $Target -Recurse -Force
}

Write-Host "Updated Heli-Harness at $Target"
if (-not $ResetState) {
  Write-Host "Preserved state/. Use -ResetState to replace state from the repo checkout."
}
Write-Host "AGENTS.md and CLAUDE.md were not modified."
