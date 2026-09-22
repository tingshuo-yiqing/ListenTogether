$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..\server')
$env:HOST = '0.0.0.0'
npm.cmd ci
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm.cmd run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm.cmd start
