# Stop the yantao workbench server (PID file first, then anything still on 8080).
$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root '.dsh-build/yantao-web.pid'

if (Test-Path $pidFile) {
  $id = Get-Content $pidFile
  Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
  Remove-Item $pidFile -ErrorAction SilentlyContinue
  "stopped PID $id"
}

Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }

if (Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue) {
  'port 8080 still in use'
} else {
  'port 8080 free'
}
