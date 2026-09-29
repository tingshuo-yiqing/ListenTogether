# 一键启动本地管理器；只复用本工具进程，不停止其他服务，也不重启播放后端。
$ErrorActionPreference = 'Stop'
$projectDir = Split-Path $PSScriptRoot -Parent
$managerUrl = 'http://127.0.0.1:3100'
try {
  $running = Invoke-RestMethod -Uri "$managerUrl/api/sources" -TimeoutSec 2
} catch { }
try {
  if ($running.sources) {
    if ($running.serviceVersion -ne '20260929-lyrics-preview') {
      throw '3100 端口的元数据管理器仍是旧版本。请关闭旧的 metadata-manager 进程，再运行本启动器；仅刷新网页不会更新后台。'
    }
    Start-Process $managerUrl
    exit 0
  }
  $nodeExe = (Get-Command node -ErrorAction Stop).Source
  if (!(Test-Path -LiteralPath (Join-Path $projectDir 'server/dist/library/catalog.js'))) {
    throw '缺少服务端构建产物，请先在 server 目录执行 npm ci 和 npm run build。'
  }
  $logDir = Join-Path $projectDir '.workbuddy'
  [System.IO.Directory]::CreateDirectory($logDir) | Out-Null
  $outLog = Join-Path $logDir 'metadata-manager.stdout.log'
  $errLog = Join-Path $logDir 'metadata-manager.stderr.log'
  $managerProcess = Start-Process -FilePath $nodeExe -ArgumentList @('scripts/metadata-manager.mjs') -WorkingDirectory $projectDir -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 250
    $managerProcess.Refresh()
    if ($managerProcess.HasExited) { throw "管理器启动失败，请查看 $errLog" }
    try { $ready = Invoke-RestMethod -Uri "$managerUrl/api/sources" -TimeoutSec 1 } catch { continue }
    if ($ready.sources) { Start-Process $managerUrl; exit 0 }
  }
  throw "启动超时，请查看 $errLog"
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  Read-Host '按回车关闭'
  exit 1
}
