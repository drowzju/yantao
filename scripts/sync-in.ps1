# sync-in.ps1 - ingest a bundle produced by sync-out.ps1 on the other machine,
# merge it into main, and retag 'pair/base' so the next sync-out is incremental.
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

git tag -f pair/base HEAD
if ($LASTEXITCODE -ne 0) { Die "Merge ok but tagging pair/base failed." }

Write-Host ("OK: main is now {0}, pair/base retagged. If client-side code changed, run 'pnpm run refresh' and restart the workbench." -f (git rev-parse --short HEAD))
