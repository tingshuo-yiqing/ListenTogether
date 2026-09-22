param([int]$Port = 3000)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location (Join-Path $projectRoot 'server')
try {
    if (-not (Test-Path -LiteralPath 'node_modules')) {
        npm.cmd ci
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $env:MEDIA_DIR = Join-Path $projectRoot 'demo-media'
    $env:HOST = '127.0.0.1'
    $env:PORT = "$Port"
    Write-Host "演示后端：http://127.0.0.1:$Port"
    Write-Host "USB 真机：先执行 adb reverse tcp:$Port tcp:$Port，APP 填同一地址。"
    Write-Host "仅加载合成测试音，不改动你的 media 曲库；Ctrl+C 停止。"
    npm.cmd start
} finally { Pop-Location }
