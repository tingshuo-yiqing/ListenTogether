<#
.SYNOPSIS
无线 adb 连接 + adb reverse 一步到位（真机联调用）。

.DESCRIPTION
把「配对 → 连接 → adb reverse → 可选安装 APK」放在同一个 adb server 生命周期内完成。
必要性：无线模式下 adb server 一重启，无线连接与 reverse 规则会同时失效，
分多次命令执行会出现「connect 成功了但下一条命令报 device not found」。

首次配对：
  .\scripts\connect-wireless.ps1 -PairHost 192.168.43.15:38811 -PairCode '028776' -DebugHost 192.168.43.15:41959 -Install

日常重连（配对记录已在）：
  .\scripts\connect-wireless.ps1 -DebugHost 192.168.43.15:41959 -Install

故障注入需要同时转发 3001：
  .\scripts\connect-wireless.ps1 -DebugHost 192.168.43.15:41959 -Port 3000,3001

.PARAMETER DebugHost
手机「无线调试」页显示的「IP 地址和端口」，形如 192.168.43.15:41959。
注意每次关闭再打开无线调试，该端口都会变。

.PARAMETER PairHost
「使用配对码配对设备」弹窗里的「IP 地址和端口」，与 DebugHost 是两个不同端口。

.PARAMETER PairCode
上述弹窗里的 6 位 WLAN 配对码，有有效期，弹窗关闭即失效。
建议加引号书写（-PairCode '028776'），否则 0 开头会被 PowerShell 当数字丢掉前导 0；
脚本会兜底补足 6 位，但请不要长期依赖这个兜底。

.PARAMETER Port
需要 reverse 的端口，默认 3000；故障注入写 '3000,3001'。
刻意声明为字符串：用 powershell -File 调用时 PowerShell 会把 3000,3001 当成单个参数，
数组类型在这里会被拼成 30003001。

.PARAMETER Install
连接成功后调用 install-debug.ps1 安装并启动 debug APK。

.PARAMETER Verify
用设备端 curl 访问 127.0.0.1:<Port>/health，端到端确认隧道打通。

.PARAMETER SdkPath
Android SDK 根目录；缺省取 ANDROID_HOME，再退化到 %LOCALAPPDATA%\Android\Sdk。
#>
param(
  [string]$DebugHost,
  [string]$PairHost,
  [string]$PairCode,
  [string]$Port = '3000',
  [switch]$Install,
  [switch]$Verify,
  [string]$SdkPath
)

$ErrorActionPreference = 'Continue'
# 用 Continue 而非 Stop：本脚本刻意把 adb 的 stderr（* daemon not running / failed to connect 等）
# 收进自己的提示里，PS 5.1 下 2>&1 产生的 ErrorRecord 在 Stop 偏好下可能误终止脚本；
# 关键失败点一律用显式 throw（见下方各段）。

# -Port 同时接受 PowerShell 直接调用的 3000,3001（数组被空格拼接）与 -File 调用的 "3000,3001"
$ports = @()
foreach ($chunk in ($Port -split '[,\s]+')) {
  if ($chunk -ne '') { $ports += [int]$chunk }
}
if ($ports.Count -eq 0) { throw '-Port 未解析出有效端口，例如 -Port 3000 或 -Port 3000,3001。' }

# 配对码可能是 0 开头：PowerShell 提示符下直接写 -PairCode 028776 会被当成数字丢掉前导 0。
# 建议加引号（-PairCode '028776'）；此处兜底补足 6 位。
if ($PairCode -and $PairCode.Length -lt 6) { $PairCode = $PairCode.PadLeft(6, '0') }

# ---- 1. 定位 adb ----
$sdk = $SdkPath
if (-not $sdk) {
  if ($env:ANDROID_HOME) { $sdk = $env:ANDROID_HOME } else { $sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
}
$adb = Join-Path $sdk 'platform-tools\adb.exe'
if (-not (Test-Path -LiteralPath $adb)) { throw "找不到 adb：$adb（请设置 ANDROID_HOME 或用 -SdkPath 指定）" }
if (-not $DebugHost) { throw '缺少 -DebugHost：请填手机「无线调试」页的「IP 地址和端口」。' }

# ---- 2. 配对（仅首次需要）----
if ($PairHost -or $PairCode) {
  if (-not ($PairHost -and $PairCode)) { throw '-PairHost 与 -PairCode 必须同时提供。' }
  Write-Host "正在配对 $PairHost ..."
  $pairOut = (& $adb pair $PairHost $PairCode 2>&1) -join "`n"
  Write-Host $pairOut
  if ($pairOut -notmatch 'Successfully paired') {
    Write-Host '配对未成功。常见原因：配对码已过期（弹窗关了就失效）、端口填成了调试端口、手机与电脑不在同一 Wi-Fi。'
    Write-Host '注意：若这台电脑此前已与手机配对过，配对失败不影响后续 connect，可以继续。'
  }
}

# ---- 3. 连接（每次都要显式执行）----
& $adb start-server | Out-Null
$connOut = (& $adb connect $DebugHost 2>&1) -join "`n"
Write-Host $connOut
if ($connOut -notmatch 'connected to') {
  Write-Host "连接 $DebugHost 失败：请确认无线调试仍为开启、端口未变（重开无线调试会换端口）。"
}

$devList = @(& $adb devices 2>&1)

# ---- 4. 选定目标序列号：优先精确匹配 DebugHost ----
$serial = $null
foreach ($l in $devList) {
  if ($l -match '^\s*(\S+)\s+device\s*$') { if ($Matches[1] -eq $DebugHost) { $serial = $Matches[1] } }
}
if (-not $serial) {
  foreach ($l in $devList) {
    if ($l -match '^\s*(\S+)\s+device\s*$') {
      $cand = $Matches[1]
      if ($cand -like '*:*' -and $cand -notlike '*_adb-tls-connect*') { $serial = $cand }
    }
  }
}
if (-not $serial) {
  throw ("未发现已授权的无线设备。当前 adb devices：`n" + ($devList -join "`n") + "`n请确认手机屏幕没有待确认的调试授权弹窗。")
}

# ---- 5. 报告重复 transport ----
$deviceSerials = @()
foreach ($l in $devList) { if ($l -match '^\s*(\S+)\s+device\s*$') { $deviceSerials += $Matches[1] } }
if ($deviceSerials.Count -gt 1) {
  Write-Host ""
  Write-Host "注意：adb devices 有 $($deviceSerials.Count) 个条目（同一台手机可能同时存在 IP:port 与 mDNS 两个 transport）："
  foreach ($s in $deviceSerials) { Write-Host "  - $s" }
  Write-Host '不带 -Serial 的脚本会判定「连接了多台设备」而报错。若只保留一个，可执行：'
  foreach ($s in $deviceSerials) { if ($s -ne $serial) { Write-Host "  & `"$adb`" disconnect $s" } }
}

# ---- 6. reverse ----
foreach ($p in $ports) { & $adb -s $serial reverse "tcp:$p" "tcp:$p" | Out-Null }
$reverseList = (& $adb -s $serial reverse --list 2>&1) -join "`n"
Write-Host ""
Write-Host '当前反向转发（应为每个端口一行）：'
Write-Host $reverseList
foreach ($p in $ports) {
  if ($reverseList -notmatch ("tcp:" + $p + "\s")) {
    Write-Host "警告：端口 $p 未出现在 reverse 列表中，手机端 127.0.0.1:$p 不会有转发（检查端口是否被占用）。"
  }
}

# ---- 7. 端到端自检 ----
if ($Verify) {
  Write-Host ""
  $tools = (& $adb -s $serial shell 'command -v curl' 2>&1) -join "`n"
  if ($tools -match 'curl') {
    foreach ($p in $ports) {
      $probe = (& $adb -s $serial shell "curl -s -m 6 http://127.0.0.1:$p/health" 2>&1) -join "`n"
      Write-Host "设备端 GET http://127.0.0.1:$p/health -> $probe"
    }
    Write-Host '（后端未启动时此处会失败或超时，不代表 reverse 有问题。）'
  } else {
    Write-Host '设备端没有 curl，跳过自检；可在电脑上再跑一次 load15 或直接看 APP 连接状态。'
  }
}

# ---- 8. 安装（可选）----
if ($Install) {
  $installScript = Join-Path $PSScriptRoot 'install-debug.ps1'
  Write-Host ""
  Write-Host "安装 APK 到 $serial ..."
  & $installScript -Serial $serial -Port $ports[0]
}

Write-Host ""
Write-Host "完成。APP 内服务器地址仍填 http://127.0.0.1:$($ports[0])"
Write-Host "其它脚本请带 -Serial $serial（例如 .\scripts\m3long-sample.ps1 -Serial $serial）"
Write-Host 'adb server 重启 / 手机重启 / 切换 Wi-Fi / 长时间息屏后，连接与 reverse 会一起失效，重新执行本脚本即可。'
