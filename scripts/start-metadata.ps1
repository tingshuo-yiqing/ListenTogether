# 一键启动本地管理器：**每次都用磁盘上的最新代码重启**（幂等）。管理器无持久状态
# （同步缓存/回收清单都落盘），重启零成本；不做版本比较——硬编码版本常量必然随每次
# 交付过期（2026-09-29 实测：复用旧进程导致"接口不存在"，比较常量过期导致误报旧版本）。
# 3100 是管理器专属端口；只停本工具进程，不动播放后端（3000）与其他服务。
$ErrorActionPreference = 'Stop'
$projectDir = Split-Path $PSScriptRoot -Parent
$managerUrl = 'http://127.0.0.1:3100'
try {
  # 端口已被占用（旧管理器或残留进程）先停掉，保证起来的一定是当前代码。
  $listener = Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
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
    if ($ready.sources) {
      Start-Process $managerUrl
      Write-Host "管理器已启动（$($ready.serviceVersion)），浏览器已打开 $managerUrl"
      exit 0
    }
  }
  throw "启动超时，请查看 $errLog"
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  Read-Host '按回车关闭'
  exit 1
}
