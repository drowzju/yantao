# Start the yantao workbench as a background server and print its URL.
# Stop it with: .\scripts\yantao-web-stop.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$buildDir = Join-Path $root '.dsh-build'
New-Item -ItemType Directory -Force -Path $buildDir | Out-Null
$log = Join-Path $buildDir 'yantao-web.log'
$errLog = Join-Path $buildDir 'yantao-web.err.log'
Remove-Item $log, $errLog -ErrorAction SilentlyContinue

$proc = Start-Process -FilePath 'node' -PassThru -WindowStyle Minimized `
  -ArgumentList '--import', 'tsx/esm', 'apps/cli/src/bin.ts', '--profile', 'yantao-web', '--port', '8080', '--no-open' `
  -RedirectStandardOutput $log -RedirectStandardError $errLog
Set-Content -Path (Join-Path $buildDir 'yantao-web.pid') -Value $proc.Id
"started PID $($proc.Id) — waiting for the server to print its URL…"

for ($i = 0; $i -lt 90; $i++) {
  Start-Sleep -Seconds 2
  if (Test-Path $log) {
    $line = Select-String -Path $log -Pattern '^dsh web: http' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($line) { $line.Line; break }
  }
  if ((Test-Path $errLog) -and (Get-Item $errLog).Length -gt 0) {
    "server failed; see $errLog"; Get-Content $errLog -Tail 12; break
  }
}
"stop with: .\scripts\yantao-web-stop.ps1"
