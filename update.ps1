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

# v0.5.5: Preserve local overlays by default.
# Packaged defaults update; user-owned overlays survive.
$PreserveDirs = @("profiles", "workspace", "policies", "safety")
if (-not $ResetState) {
  $PreserveDirs += "state"
}

$TempPreserve = Join-Path ([System.IO.Path]::GetTempPath()) ("heli-update-preserve-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $TempPreserve -Force | Out-Null

foreach ($dir in $PreserveDirs) {
  $from = Join-Path $Target $dir
  if (Test-Path -LiteralPath $from -PathType Container) {
    Copy-Item -LiteralPath $from -Destination (Join-Path $TempPreserve $dir) -Recurse -Force
  }
}

Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $Target -Recurse -Force
}

foreach ($dir in $PreserveDirs) {
  $preserved = Join-Path $TempPreserve $dir
  if (Test-Path -LiteralPath $preserved -PathType Container) {
    $targetDir = Join-Path $Target $dir
    if (Test-Path -LiteralPath $targetDir) {
      Remove-Item -LiteralPath $targetDir -Recurse -Force
    }
    Copy-Item -LiteralPath $preserved -Destination $Target -Recurse -Force
  }
}
Remove-Item -LiteralPath $TempPreserve -Recurse -Force

Write-Host "Updated Heli-Harness at $Target"
if (-not $ResetState) {
  Write-Host "Preserved local overlays: profiles/, workspace/, policies/, safety/, state/."
  Write-Host "Use -ResetState to replace state/ from the repo checkout."
} else {
  Write-Host "Preserved local overlays: profiles/, workspace/, policies/, safety/."
  Write-Host "state/ was replaced from the repo checkout (-ResetState)."
}
Write-Host "AGENTS.md and CLAUDE.md were not modified."
Write-Host "Workspace mode is preserved: update does NOT flip legacy to concurrent."
Write-Host "Parallel agents: heli task migrate-legacy --id <id> then claim write + HELI_SESSION_ID (skill concurrent-upgrade)."
Write-Host ""
Write-Host "Host plugin refresh (workspace update does not upgrade host marketplaces/plugins):"
Write-Host "  - Codex (Git marketplace): codex plugin marketplace upgrade heli-harness"
Write-Host "  - Codex (switch from local to Git once):"
Write-Host "      codex plugin remove heli-harness@heli-harness"
Write-Host "      codex plugin marketplace remove heli-harness"
Write-Host "      codex plugin marketplace add KJ-AIML/heli-harness"
Write-Host "      codex plugin add heli-harness@heli-harness"
Write-Host "  - Claude: claude plugin install .heli-harness/adapters/claude-plugin"
Write-Host "  - Grok:   node .heli-harness/adapters/grok-plugin/install-user-hooks.mjs"
Write-Host "See INSTALL.md for host-specific details."
