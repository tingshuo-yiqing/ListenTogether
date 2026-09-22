$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '..\server')
try {
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    npm.cmd test
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally { Pop-Location }
Write-Output '后端验证完成；安卓需在 android 目录单独运行 Gradle 构建和单元测试。'
