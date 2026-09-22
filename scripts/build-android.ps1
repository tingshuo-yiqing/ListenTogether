$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $env:JAVA_HOME) {
    $jdk17 = 'C:\Program Files\Java\jdk-17'
    if (Test-Path -LiteralPath (Join-Path $jdk17 'bin\java.exe')) { $env:JAVA_HOME = $jdk17 }
}
Push-Location (Join-Path $projectRoot 'android')
try {
    & .\gradlew.bat :app:assembleDebug :app:testDebugUnitTest --console=plain
    if ($LASTEXITCODE -ne 0) { throw "安卓构建失败，请查看上方错误。" }
    Write-Host "APK：$projectRoot\android\app\build\outputs\apk\debug\app-debug.apk"
} finally { Pop-Location }
