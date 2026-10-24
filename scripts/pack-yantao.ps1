# pack-yantao.ps1 - one-click pack of the decoupled win-unpacked workbench (ADR-0067).
# Chains the three steps from docs/yantao/development.md: client bundle ->
# frontend build -> desktop pack, then prints the exe path.
#
# Usage:
#   powershell -File scripts\pack-yantao.ps1

$ErrorActionPreference = 'Stop'

function Die([string]$msg) {
  Write-Error $msg
  exit 1
}

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# Single-instance rule: a running workbench (dev or packed) holds file locks and
# double-fires schedules; packing over a live dev instance also fails randomly.
$busy = Get-Process -Name 'electron', 'yantao-workbench' -ErrorAction SilentlyContinue
if ($null -ne $busy) {
  Die "检测到工作台进程仍在运行（$($busy.Id -join ', ')）——请先从托盘退出，再出包。"
}

function Step([string]$title, [string]$filter, [string]$script) {
  Write-Host "==> $title" -ForegroundColor Cyan
  & pnpm --filter $filter run $script
  if ($LASTEXITCODE -ne 0) { Die "$title 失败（exit $LASTEXITCODE）" }
}

Step 'client bundle' '@deepseek-ai/dsh-client-ui-yantao' 'bundle'
Step 'frontend build' '@deepseek-ai/dsh-yantao-frontend' 'build'
Step 'desktop pack'   '@deepseek-ai/dsh-yantao-desktop'   'build:win:dir'

$exe = Join-Path $root 'apps\yantao-desktop\.package-build\artifacts\win-unpacked\yantao-workbench.exe'
if (-not (Test-Path $exe)) { Die "打包完成但找不到 $exe" }
Write-Host ""
Write-Host "出包完成：$exe" -ForegroundColor Green
# 任务栏图标按文件路径缓存：原地覆盖 exe 后旧图标可能还在，改名或清缓存即可。
Write-Host "提示：任务栏图标若仍是旧图标，是 Windows 图标缓存——把 exe 改个名或执行 ie4uinit.exe -show。" -ForegroundColor DarkGray
