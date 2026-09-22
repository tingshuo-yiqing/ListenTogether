[CmdletBinding()]
param(
    [ValidateSet('all', 'server', 'android', 'docs')]
    [string]$Scope = 'all'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot

function Invoke-CheckedCommand {
    param(
        [string]$WorkingDirectory,
        [string]$FilePath,
        [string[]]$Arguments
    )

    Push-Location $WorkingDirectory
    try {
        & $FilePath @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "命令失败（退出码 $LASTEXITCODE）：$FilePath $($Arguments -join ' ')"
        }
    } finally {
        Pop-Location
    }
}

if ($Scope -in @('all', 'server')) {
    Invoke-CheckedCommand (Join-Path $projectRoot 'server') 'npm.cmd' @('run', 'build')
    Invoke-CheckedCommand (Join-Path $projectRoot 'server') 'npm.cmd' @('test')
    Write-Output '后端构建与测试通过。'
}

if ($Scope -in @('all', 'android')) {
    $jdk17 = 'C:\Program Files\Java\jdk-17'
    if (-not $env:JAVA_HOME -and (Test-Path -LiteralPath (Join-Path $jdk17 'bin\java.exe'))) {
        $env:JAVA_HOME = $jdk17
    }
    Invoke-CheckedCommand (Join-Path $projectRoot 'android') '.\gradlew.bat' @(
        ':app:testDebugUnitTest',
        ':app:assembleDebug',
        ':app:lintDebug',
        '--console=plain'
    )
    Write-Output '安卓单元测试、Debug APK 构建与 Lint 通过。'
}

if ($Scope -in @('all', 'docs')) {
    Invoke-CheckedCommand $projectRoot 'node.exe' @('scripts/check-doc-links.mjs')
}
