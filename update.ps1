param(
  [string]$Parent = "",
  [switch]$ResetState
)

$ErrorActionPreference = "Stop"

# Canonical update path: delegate to Node CLI so Bash/PowerShell/Pi share one
# preserve/prune/dogfood-guard implementation (lib/cli/update.mjs).
$Heli = Join-Path $PSScriptRoot "bin\heli.mjs"

if (-not (Test-Path $Heli)) {
  Write-Host "bin/heli.mjs not found next to update.ps1"
  Write-Host "Update by cloning or entering the repo checkout, running git pull, then:"
  Write-Host "  .\update.ps1 -Parent <parent-workspace>"
  exit 1
}

$HeliArgs = @("update")
if (-not [string]::IsNullOrWhiteSpace($Parent)) { $HeliArgs += $Parent }
if ($ResetState) { $HeliArgs += "--reset-state" }

& node $Heli @HeliArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
