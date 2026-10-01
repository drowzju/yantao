# sync-in.ps1 - ingest a bundle produced by sync-out.ps1 on the other machine,
# merge it into main, and retag 'pair/base' so the next sync-out is incremental.
#
# pair/base is set to the BUNDLE's main tip - the shipper's HEAD at packaging
# time, which both machines provably hold (the shipper authored it, we just
# fetched it). Tagging our own merge commit instead would strand the shipper
# without the prerequisite object: every later incremental bundle from us
# fails verify on their side until someone ships a -Full bundle (observed
# 2026-10-01 in a two-repo sandbox; see the entity project log).
#
# Usage:
#   powershell -File scripts\sync-in.ps1 -Bundle D:\tmp\yantao-sync-xxxx.bundle
#
# If the merge hits conflicts: resolve, commit, then re-run this script - it
# will notice everything is already merged and just finish the bookkeeping.
param(
  [Parameter(Mandatory = $true)][string]$Bundle
)

$ErrorActionPreference = 'Stop'

function Die([string]$msg) {
  Write-Error $msg
  exit 1
}

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Test-Path $Bundle)) { Die "Bundle not found: $Bundle" }

git bundle verify $Bundle
if ($LASTEXITCODE -ne 0) { Die "Bundle verification FAILED - refusing to ingest a corrupt file." }

$dirty = @(git status --porcelain --untracked-files=no)
if ($dirty.Count -gt 0) { Die "Working tree has uncommitted TRACKED changes. Commit or stash first, then re-run." }

$branch = git rev-parse --abbrev-ref HEAD
if ($branch -ne 'main') { Die "Expected to be on 'main' (currently on '$branch'). Switch first." }

git fetch $Bundle 'refs/heads/*:refs/remotes/sync/*'
if ($LASTEXITCODE -ne 0) { Die "Fetching from the bundle failed." }

$incoming = git rev-parse -q --verify refs/remotes/sync/main
if (-not $incoming) { Die "The bundle contains no 'main' branch - nothing to ingest." }

$base = git merge-base HEAD $incoming
if ($base -eq $incoming) {
  Write-Host "Already up to date - nothing new in this bundle."
} else {
  git merge $incoming -m "Merge offline sync bundle into main"
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "Merge conflicts found. Resolve them, commit, then re-run this script to finish the bookkeeping."
    exit 2
  }
}

# The bundle's main tip, not HEAD: HEAD may be a merge commit only this
# machine will ever hold, which would deadlock the next round trip.
git tag -f pair/base $incoming
if ($LASTEXITCODE -ne 0) { Die "Merge ok but tagging pair/base failed." }

Write-Host ("OK: main is now {0}, pair/base retagged to the bundle's main tip. If client-side code changed, run 'pnpm run refresh' and restart the workbench." -f (git rev-parse --short HEAD))
