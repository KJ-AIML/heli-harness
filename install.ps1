param(
  [string]$Parent = (Get-Location).Path
)

$ErrorActionPreference = "Stop"

# Canonical install path: delegate to Node CLI so Bash/PowerShell/Pi share one seed.
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Heli = Join-Path $RepoRoot "bin\heli.mjs"

if (-not (Test-Path $Heli)) {
  throw "bin/heli.mjs not found next to install.ps1"
}

if (-not (Test-Path -LiteralPath $Parent -PathType Container)) {
  Write-Error "Parent directory does not exist: $Parent`nCreate it first or pass an existing directory."
  exit 1
}

& node $Heli install $Parent
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
