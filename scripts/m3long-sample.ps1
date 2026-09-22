#Requires -Version 5.1
<#
.SYNOPSIS
  M3-LONG 真机外部采样：60 分钟连续播放（含至少 30 分钟息屏）的带时间戳状态采集。

.DESCRIPTION
  按 docs/execution-plan.md 第 2 节的采样要求实现（只读采集，不改设备与应用状态）：
  - 每 -MediaIntervalSeconds 秒（默认 30）采样一次本应用媒体会话状态与播放位置；
  - 每 -ResourceIntervalSeconds 秒（默认 300）记录一次内存（meminfo TOTAL）与电池；
  - 每次亮屏/息屏切换追加一条电源状态记录，覆盖准备期与第 60 分钟之后。
  输出为带本机 ISO 时间戳的逐行日志；采样空档（adb 失败）也会如实写入，不能计为通过。

  前置：手机已 USB 调试连接并装好受测 APK，开始播放前启动本脚本；
  结束后把日志与手机端 DiagnosticsLog JSONL 一并归档到 docs/test-results/<日期>-m3-long/。
  本脚本只做采集，不代替听感与录音证据；长时任务请用 Invoke-CimMethod Win32_Process
  在独立窗口启动（见 docs/development-pitfalls.md 第 6 节，工具超时会杀子进程树）。

.PARAMETER Serial
  多设备时的 adb 序列号（对应 install-debug.ps1 -Serial）。

.PARAMETER DurationMinutes
  采样总时长，默认 75 分钟（60 分钟播放 + 准备与收尾余量）。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\m3long-sample.ps1 -DurationMinutes 75
#>
param(
  [string]$Serial = "",
  [int]$DurationMinutes = 75,
  [int]$MediaIntervalSeconds = 30,
  [int]$ResourceIntervalSeconds = 300,
  [string]$Package = "com.listentogether.app",
  [string]$OutFile = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$adb = Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe"
if (-not (Test-Path $adb)) { throw "未找到 adb：$adb（需先安装 Android SDK Platform-Tools）" }

$deviceArgs = @()
if ($Serial -ne "") { $deviceArgs = @("-s", $Serial) }

if ($OutFile -eq "") {
  $OutFile = Join-Path (Get-Location) ("m3long-sample-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log")
}

function Invoke-Adb([string[]]$Arguments) {
  # 单次 adb 调用；失败返回 $null 由调用方记空档，不让一次抖动中断全程采样。
  $output = & $adb @deviceArgs @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) { return $null }
  return ($output | Out-String)
}

function Write-Log([string]$Line) {
  $stamp = Get-Date -Format "yyyy-MM-ddTHH:mm:ss.fffK"
  Add-Content -Path $OutFile -Encoding UTF8 -Value ("{0} {1}" -f $stamp, $Line)
}

function Get-MediaState {
  # 从 dumpsys media_session 提取本应用会话的 state/position；找不到记 none。
  $dump = Invoke-Adb @("shell", "dumpsys", "media_session")
  if ($null -eq $dump) { return "media=adb-error" }
  $lines = $dump -split "`r?`n"
  $inOurs = $false
  foreach ($line in $lines) {
    if ($line -match [regex]::Escape($Package)) { $inOurs = $true }
    elseif ($inOurs -and $line -match "state=PlaybackState \{state=(\d+), position=(-?\d+)") {
      return ("media=state:{0},position:{1}ms" -f $Matches[1], $Matches[2])
    }
  }
  if ($inOurs) { return "media=session-found-no-state" }
  return "media=none"
}

function Get-ScreenState {
  $dump = Invoke-Adb @("shell", "dumpsys", "power")
  if ($null -eq $dump) { return "adb-error" }
  if ($dump -match "Display Power: state=(\w+)") { return $Matches[1] }
  return "unknown"
}

function Get-ResourceLine {
  # 内存取 TOTAL PSS（KB）；电池取电量百分比与充电状态。解析失败如实标注。
  $mem = Invoke-Adb @("shell", "dumpsys", "meminfo", $Package)
  $memText = "adb-error"
  if ($null -ne $mem -and $mem -match "TOTAL[^\d]*(\d+)") { $memText = ("{0}KB" -f $Matches[1]) }
  $bat = Invoke-Adb @("shell", "dumpsys", "battery")
  $batText = "adb-error"
  if ($null -ne $bat -and $bat -match "level: (\d+).*status: (\d+)" ) {
    $batText = ("level:{0}%,status:{1}" -f $Matches[1], $Matches[2])
  }
  return ("mem={0} battery={1}" -f $memText, $batText)
}

$state = Invoke-Adb @("get-state")
if ($state -notmatch "device") { throw "设备未连接（adb get-state 返回：$state）。先连手机并允许 USB 调试。" }

$serialText = $Serial
if ($serialText -eq "") { $serialText = "(default)" }
Write-Log ("sample-start package={0} mediaInterval={1}s resourceInterval={2}s duration={3}min serial={4}" -f $Package, $MediaIntervalSeconds, $ResourceIntervalSeconds, $DurationMinutes, $serialText)

$deadline = (Get-Date).AddMinutes($DurationMinutes)
$lastScreen = ""
$nextMedia = Get-Date
$nextResource = Get-Date

try {
  while ((Get-Date) -lt $deadline) {
    $now = Get-Date

    $screen = Get-ScreenState
    if ($screen -ne $lastScreen) {
      # 每次锁屏/解锁（含初始状态）记录电源状态，便于对齐息屏窗口。
      Write-Log ("screen={0}" -f $screen)
      $lastScreen = $screen
    }

    if ($now -ge $nextMedia) {
      Write-Log (Get-MediaState)
      $nextMedia = $now.AddSeconds($MediaIntervalSeconds)
    }
    if ($now -ge $nextResource) {
      Write-Log (Get-ResourceLine)
      $nextResource = $now.AddSeconds($ResourceIntervalSeconds)
    }

    Start-Sleep -Seconds 2
  }
}
finally {
  Write-Log "sample-end"
  Write-Output ("采样日志：{0}" -f $OutFile)
}
