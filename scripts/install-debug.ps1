param([string]$Serial, [int]$Port = 3000)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$adb = Join-Path $sdk 'platform-tools\adb.exe'
if (-not (Test-Path -LiteralPath $adb)) { throw '找不到 adb，请设置 ANDROID_HOME 指向 Android SDK。' }
$devices = @(& $adb devices | Where-Object { $_ -match '^\S+\s+device$' } | ForEach-Object { ($_ -split '\s+')[0] })
if (-not $Serial) {
    if ($devices.Count -eq 0) { throw '未发现已授权的安卓设备。请连接 USB，在手机上允许 USB 调试。' }
    if ($devices.Count -gt 1) { throw '连接了多台设备，请使用 -Serial 指定 adb devices 显示的序列号。' }
    $Serial = $devices[0]
}
if ($Serial -notin $devices) { throw '指定设备未连接或尚未授权。' }
$apk = Join-Path $projectRoot 'android\app\build\outputs\apk\debug\app-debug.apk'
if (-not (Test-Path -LiteralPath $apk)) { throw 'APK 不存在，请先运行 scripts\build-android.ps1。' }
& $adb -s $Serial install -r $apk
if ($LASTEXITCODE -ne 0) { throw '安装失败，请查看上方信息和手机提示。' }
& $adb -s $Serial reverse "tcp:$Port" "tcp:$Port"
if ($LASTEXITCODE -ne 0) { throw 'USB 端口转发失败。' }
& $adb -s $Serial shell am start -n com.listentogether.app/.MainActivity
if ($LASTEXITCODE -ne 0) { throw 'APP 启动失败。' }
Write-Host "请在 APP 填写 http://127.0.0.1:$Port，然后创建房间。"
