# sync-out.ps1 - pack new commits into a single bundle file for offline transfer.
# Pair with sync-in.ps1 on the other machine. Progress bookkeeping lives in the
# local tag 'pair/base' (the last commit both machines are known to hold).
#
# Usage:
#   powershell -File scripts\sync-out.ps1              # incremental bundle
#   powershell -File scripts\sync-out.ps1 -Out D:\tmp\a2b.bundle
#   powershell -File scripts\sync-out.ps1 -Full        # first shipment / fresh clone seed
param(
  [string]$Out = "",
  [switch]$Full
)

$ErrorActionPreference = 'Stop'

function Die([string]$msg) {
  Write-Error $msg
  exit 1
}

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$dirty = @(git status --porcelain --untracked-files=no)
if ($dirty.Count -gt 0) {
  Write-Warning "Working tree has uncommitted TRACKED changes - they will NOT be in the bundle:"
  $dirty | ForEach-Object { Write-Warning "  $_" }
}

if (-not $Out) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmm'
  $Out = Join-Path (Split-Path -Parent $root) ("yantao-sync-{0}.bundle" -f $stamp)
}

if ($Full) {
  Write-Host "Packing a FULL bundle (all branches and tags)..."
  git bundle create $Out --branches --tags
} else {
  $mark = git rev-parse -q --verify refs/tags/pair/base
  if (-not $mark) {
    Die "Tag 'pair/base' not found - cannot compute the increment. For the first shipment run: powershell -File scripts\sync-out.ps1 -Full"
  }
  Write-Host ("Packing commits since pair/base ({0})..." -f (git rev-parse --short refs/tags/pair/base))
  $newCommits = git rev-list --count "refs/tags/pair/base..HEAD"
  if ($newCommits -eq 0) { Die "Nothing new: main has no commits beyond pair/base - nothing to ship." }
  git bundle create $Out --branches --tags "^refs/tags/pair/base"
}
if ($LASTEXITCODE -ne 0) { Die "git bundle create failed." }

git bundle verify $Out
if ($LASTEXITCODE -ne 0) { Die "The bundle was created but failed verification - do not ship it." }

$mb = (Get-Item $Out).Length / 1MB
Write-Host ("OK: {0} ({1:N1} MB). Copy it to the other machine, then there run: powershell -File scripts\sync-in.ps1 -Bundle <path>" -f $Out, $mb)
