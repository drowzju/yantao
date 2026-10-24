# dev-yantao.ps1 - 本地代码"按需重建 + 启动"工作台（对照 pack-yantao.ps1 的出包脚本）。
# 解决的问题：dev 宿主虽经 tsx 跑源码，但跨包引用消费的是各包 lib/ 产物，渲染端
# 吃的更是纯构建产物——改了 A 不重建 B，就是"这没更新那没更新"。本脚本按新鲜度
# 只重建过期的产物，然后启动。
#
# 用法：
#   powershell -File scripts\dev-yantao.ps1            # 按需重建 + 启动
#   powershell -File scripts\dev-yantao.ps1 -Install   # 先 pnpm install（改过依赖/新增包后）
#
# 新增插件包的一次性接线（tsconfig.base 别名、apps/cli 依赖、bundle insert）仍是
# 手工步骤；本脚本只负责把 profile node_modules 缺失的 junction 自动补上。

Param(
  [switch]$Install,
  # 验证/CI 用：只重建不启动。
  [switch]$NoStart
)

$ErrorActionPreference = 'Stop'

function Die([string]$msg) {
  Write-Error $msg
  exit 1
}

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# 单实例规则（ADR-0067）：共享 KB/调度名册/钉钉 Stream，双实例互抢。
$busy = Get-Process -Name 'electron', 'yantao-workbench' -ErrorAction SilentlyContinue
if ($null -ne $busy) {
  Die "检测到工作台进程仍在运行（$($busy.Id -join ', ')）——请先从托盘退出，再启动。"
}

function Step([string]$title, [scriptblock]$body) {
  Write-Host "==> $title" -ForegroundColor Cyan
  & $body
  if ($LASTEXITCODE -ne 0) { Die "$title 失败（exit $LASTEXITCODE）" }
}

# ── 0. 依赖（仅 -Install；平时 pnpm install 过就不用反复跑）──────────────
if ($Install) {
  Step 'pnpm install' { pnpm install --prefer-offline }
}

# ── 1. profile junction 自动补齐 ─────────────────────────────────────────
# apps/cli/node_modules 里指向本仓库 workspace 包的链接，逐一确保在
# ~/.dsh/profiles/node_modules 有同名 junction——新插件包漏补 junction 的
# "failed to import" 坑由此免疫。已存在的绝不动。
$wall = Join-Path $env:USERPROFILE '.dsh\profiles\node_modules\@deepseek-ai'
$linkRoot = Join-Path $root 'apps\cli\node_modules\@deepseek-ai'
if (Test-Path $linkRoot) {
  New-Item -ItemType Directory -Force -Path $wall | Out-Null
  foreach ($link in Get-ChildItem $linkRoot) {
    $target = $link.Target
    if (-not $target -or -not ($target[0] -like "$root*")) { continue }
    $dest = Join-Path $wall $link.Name
    if (-not (Test-Path $dest)) {
      New-Item -ItemType Junction -Path $dest -Target $target | Out-Null
      Write-Host "==> 补 profile junction：$($link.Name)" -ForegroundColor Yellow
    }
  }
}

# ── 2. 按新鲜度重建 ─────────────────────────────────────────────────────
# tsx 跑的是宿主源码，但跨包 import 解析到对方 lib/index.js——src 比 lib 新
# 就重建（tsc -b 出 lib/types，tsdown 出 lib/index.js + typert 表）。
function Rebuild-Stale([string]$name, [string]$dir) {
  $src = Join-Path $root "$dir\src"
  $artifact = Join-Path $root "$dir\lib\index.js"
  $newest = Get-ChildItem $src -Recurse -Filter '*.ts' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  $stale = -not (Test-Path $artifact)
  if (-not $stale -and $newest) {
    $stale = $newest.LastWriteTime -gt (Get-Item $artifact).LastWriteTime
  }
  if (-not $stale) {
    Write-Host "跳过 $name（已是最新）" -ForegroundColor DarkGray
    return
  }
  Write-Host "==> 重建 $name" -ForegroundColor Cyan
  & npx tsc -b (Join-Path $root $dir)
  if ($LASTEXITCODE -ne 0) { Die "tsc -b $name 失败" }
  & npx tsdown --env.DSH_BUILD_FACE host -F $name
  if ($LASTEXITCODE -ne 0) { Die "tsdown $name 失败" }
}

# yantao 面的包（依赖序：领域层在前，控制器在后）
Rebuild-Stale '@deepseek-ai/dsh-yantao'                    'packages/bundle/yantao'
Rebuild-Stale '@deepseek-ai/dsh-yantao-kb'                 'packages/yantao/kb'
Rebuild-Stale '@deepseek-ai/dsh-yantao-usage'              'packages/yantao/usage'
Rebuild-Stale '@deepseek-ai/dsh-yantao-model-window'       'packages/yantao/model-window'
Rebuild-Stale '@deepseek-ai/dsh-yantao-dingtalk'           'packages/yantao/dingtalk-connector'
Rebuild-Stale '@deepseek-ai/dsh-api-yantao-kb-controller'  'packages/api/yantao-kb-controller'
Rebuild-Stale '@deepseek-ai/dsh-api-yantao-usage-controller' 'packages/api/yantao-usage-controller'
Rebuild-Stale '@deepseek-ai/dsh-yantao-web-app'            'packages/bundle/yantao-web-app'

# ── 3. 渲染端三件套（纯构建产物，渲染进程不吃源码）────────────────────────
# remotes client 聚合：控制器 @Remote 面的浏览器侧聚合，改控制器面必重建。
$remotesSrc = Get-ChildItem (Join-Path $root 'packages/api') -Recurse -Filter '*.ts' -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch 'node_modules|[.]lib[\\]|[.]package-build[\\]' } |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
$remotesArtifact = Join-Path $root 'packages/api/remotes/lib/client.js'
if ((-not (Test-Path $remotesArtifact)) -or ($remotesSrc -and $remotesSrc.LastWriteTime -gt (Get-Item $remotesArtifact).LastWriteTime)) {
  # client 面的 tsdown 配置在 remotes 包内，必须在包目录里跑。
  Push-Location (Join-Path $root 'packages/api/remotes')
  try { Step 'remotes client 聚合' { npx tsdown --env.DSH_BUILD_FACE client } } finally { Pop-Location }
} else {
  Write-Host '跳过 remotes client（已是最新）' -ForegroundColor DarkGray
}

# ui-yantao 客户端 bundle：中栏 UI 的载体。
$uiSrc = Get-ChildItem (Join-Path $root 'packages/client/ui-yantao/src') -Recurse -Include '*.ts', '*.tsx' |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
$uiArtifact = Join-Path $root 'packages/client/ui-yantao/lib/client.js'
if ((-not (Test-Path $uiArtifact)) -or ($uiSrc -and $uiSrc.LastWriteTime -gt (Get-Item $uiArtifact).LastWriteTime)) {
  Step 'ui-yantao bundle' { pnpm --filter @deepseek-ai/dsh-client-ui-yantao run bundle }
} else {
  Write-Host '跳过 ui-yantao bundle（已是最新）' -ForegroundColor DarkGray
}

# 前端（apps/yantao）：web-app 所服务的静态面。
$feSrc = Get-ChildItem (Join-Path $root 'apps/yantao/src') -Recurse -Include '*.ts', '*.tsx', '*.css' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
$feDist = Get-ChildItem (Join-Path $root 'apps/yantao/dist') -Recurse -File -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (($null -eq $feDist) -or ($feSrc -and $feSrc.LastWriteTime -gt $feDist.LastWriteTime)) {
  Step 'frontend build' { pnpm --filter @deepseek-ai/dsh-yantao-frontend run build }
} else {
  Write-Host '跳过 frontend build（已是最新）' -ForegroundColor DarkGray
}

# ── 4. 启动 ──────────────────────────────────────────────────────────────
if ($NoStart) {
  Write-Host ""
  Write-Host '-NoStart：重建完成，未启动。' -ForegroundColor Green
  exit 0
}
Write-Host ""
Write-Host "==> 启动工作台（dev，profile yantao-web）" -ForegroundColor Green
& pnpm --filter @deepseek-ai/dsh-yantao-desktop start
