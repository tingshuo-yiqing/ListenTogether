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
    # 原生命令（gradle/npm/tsc）会把进度条与告警写到 stderr；PS 5.1 在 EAP=Stop 下会把**任何一行** stderr 变成终止错误，
    # 哪怕进程退出码是 0（陷阱 1.5/1.6，曾把 ffmpeg 成功的转码判成失败）。这里只在调用期间收窄 EAP，
    # 成败一律只认 $LASTEXITCODE；捕获到的 stderr 仍会照常显示，不隐藏真实告警。
    $previousErrorActionPreference = $ErrorActionPreference
    $exitCode = 1
    try {
        $ErrorActionPreference = 'Continue'
        & $FilePath @Arguments
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
        Pop-Location
    }
    if ($exitCode -ne 0) {
        throw "命令失败（退出码 $exitCode）：$FilePath $($Arguments -join ' ')"
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
    # Q-2：Gradle 的测试任务是增量构建的，输入未变时会报 UP-TO-DATE 并**跳过实跑**——
    # 那时门禁里的"测试通过"只是上一轮的结论，改测试代码之外的任何东西都看不出来。
    # cleanTestDebugUnitTest 删掉该变体测试任务的输出（build/test-results、build/reports），
    # 使紧随其后的 testDebugUnitTest 必然重新执行；只影响测试结果目录，不触发重新编译与重新打包。
    Invoke-CheckedCommand (Join-Path $projectRoot 'android') '.\gradlew.bat' @(
        ':app:cleanTestDebugUnitTest',
        ':app:testDebugUnitTest',
        ':app:assembleDebug',
        ':app:lintDebug',
        '--console=plain'
    )
    Write-Output '安卓单元测试（强制本轮实跑）、Debug APK 构建与 Lint 通过。'
}

if ($Scope -in @('all', 'docs')) {
    Invoke-CheckedCommand $projectRoot 'node.exe' @('scripts/check-doc-links.mjs')
}
