# 一起听歌 · 本地转码并上传到云端曲库（需本机 ffmpeg/ffprobe、ssh 免密 aliyun）
#
# 用法示例：
#   .\scripts\add-media.ps1 -File "C:\Users\ting\Music\音乐\单车.mp3" -Id dan-che
#   .\scripts\add-media.ps1 -File "D:\新歌.mp3" -Id xin-ge -Title "新歌" -Bitrate 128k -Restart
#
# 行为：本地 ffmpeg 转码（默认 192k CBR，保留 ID3 元数据）→ ffprobe 校验时长/码率
#       → scp 以 ASCII 临时名上传 /tmp/lt-up-<id>.mp3
#       → 服务端 media-manage.sh 按 catalog id 原位替换（自动备份原文件）或新增条目。
# 编码约定：中文标题/文件名只经 manifest 文件内容流转，绝不进入命令行参数；
#       新增条目时 -Title 会写入 UTF-8 manifest 传给服务端。
# 注意：替换或新增后必须重启 listen-together 才会重新加载时长缓存（-Restart），
#       重启会清空内存中的房间；多首批量上传时只在最后一首加 -Restart。
param(
  [Parameter(Mandatory = $true)][string]$File,
  [Parameter(Mandatory = $true)][string]$Id,
  [string]$Title = "",
  [string]$Bitrate = "192k",
  [switch]$Restart
)
$ErrorActionPreference = "Stop"

# ---------- 0. 前置校验 ----------
if (-not (Test-Path -LiteralPath $File)) { throw "源文件不存在：$File" }
if ([IO.Path]::GetExtension($File) -ne ".mp3") { throw "仅支持 .mp3 源文件：$File" }
if ($Id -notmatch "^[a-zA-Z0-9_-]{1,64}$") { throw "Id 只允许 1-64 位字母/数字/下划线/连字符：$Id" }
$ffCmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
$fpCmd = Get-Command ffprobe -ErrorAction SilentlyContinue
$scpCmd = Get-Command scp -ErrorAction SilentlyContinue
if (-not $ffCmd -or -not $fpCmd) { throw "本机未找到 ffmpeg/ffprobe，请先安装并加入 PATH" }
if (-not $scpCmd) { throw "本机未找到 scp（Windows OpenSSH 客户端）" }

function Get-AudioInfo([string]$path) {
  # EAP 收窄为 Continue：脚本全局是 Stop，ffprobe 出错时 stderr 文本会被转成
  # 终止异常，导致下面的 exit code 检查永远走不到（陷阱 1.5 同源）。
  $old = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $json = & $fpCmd.Source -v error -show_entries format=duration,bit_rate -of json $path 2>$null
  $code = $LASTEXITCODE
  $ErrorActionPreference = $old
  if ($code -ne 0) { throw "ffprobe 解析失败：$path" }
  $o = ($json -join "`n") | ConvertFrom-Json
  return @{ Duration = [double]$o.format.duration; BitRate = [double]$o.format.bit_rate }
}

$work = Join-Path $env:TEMP "lt-media"
New-Item -ItemType Directory -Force -Path $work | Out-Null
$out = Join-Path $work ("up-{0}.mp3" -f $Id)
Remove-Item -LiteralPath $out -Force -ErrorAction SilentlyContinue

# ---------- 1. 本地转码 ----------
# ffmpeg 的 stderr 用文件承接（PS 5.1 的 2> 产出 UTF-16，Get-Content 可自动识别），
# EAP 收窄为 Continue，保证 exit code 检查可达。
$ffErr = Join-Path $work "ff-err.txt"
function Invoke-Ffmpeg([string[]]$metaArgs) {
  $old = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & $ffCmd.Source -y -hide_banner -loglevel error -i $File -codec:a libmp3lame -b:a $Bitrate @metaArgs -id3v2_version 3 $out 2> $ffErr
  $code = $LASTEXITCODE
  $ErrorActionPreference = $old
  return $code
}
Write-Host "[1/4] ffmpeg 转码 -> $Bitrate CBR（保留元数据）..."
$code = Invoke-Ffmpeg @("-map_metadata", "0")
if ($code -ne 0) {
  # 部分老文件 ID3 标签编码非法（如 GBK 字节标成 UTF-16），携带元数据重编码会报
  # "Invalid UTF8 sequence in avio_put_str16le"；曲库标题来自 catalog.json，
  # 与标签无关，此处去掉元数据重转一次。
  Write-Host "      携带元数据转码失败（$(Get-Content $ffErr -Raw)），改用去元数据重转（曲库标题不受影响）..."
  Remove-Item -LiteralPath $out -Force -ErrorAction SilentlyContinue
  $code = Invoke-Ffmpeg @("-map_metadata", "-1")
  if ($code -ne 0) {
    throw "ffmpeg 转码失败（含元数据与去元数据两条路径均失败）：$(Get-Content $ffErr -Raw)"
  }
}

# ---------- 2. 本地校验 ----------
Write-Host "[2/4] ffprobe 校验时长与码率..."
$srcInfo = Get-AudioInfo $File
$outInfo = Get-AudioInfo $out
$drift = [Math]::Abs($srcInfo.Duration - $outInfo.Duration)
if ($drift -gt 1.5) {
  throw ("时长偏差过大：源 {0:N1}s / 输出 {1:N1}s（阈值 1.5s）" -f $srcInfo.Duration, $outInfo.Duration)
}
$kbps = $outInfo.BitRate / 1000.0
$expect = 0.0
if ($Bitrate -match "^(\d+)k$") { $expect = [double]$Matches[1] }
if ($expect -gt 0 -and [Math]::Abs($kbps - $expect) -gt ($expect * 0.12)) {
  throw ("码率偏离目标：输出 {0:N0} kbps / 目标 {1:N0} kbps" -f $kbps, $expect)
}
$outMiB = (Get-Item -LiteralPath $out).Length / 1MB
Write-Host ("      源 {0:N1}s -> 输出 {1:N1}s | {2:N0} kbps | {3:N2} MiB" -f $srcInfo.Duration, $outInfo.Duration, $kbps, $outMiB)

# ---------- 3. 上传并安装 ----------
$remoteTmp = "/tmp/lt-up-$Id.mp3"
Write-Host "[3/4] scp 上传 -> $remoteTmp ..."
& $scpCmd.Source -o BatchMode=yes -o ConnectTimeout=15 $out ("aliyun:{0}" -f $remoteTmp)
if ($LASTEXITCODE -ne 0) { throw "scp 上传失败（exit=$LASTEXITCODE）" }

$sshArgs = @("-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "aliyun")
& ssh @sshArgs "bash /opt/listen-together/bin/media-manage.sh has $Id" | Out-Null
$isNew = ($LASTEXITCODE -ne 0)
if ($isNew -and $Title -eq "") { throw "catalog 中无 id=$Id，新增歌曲必须提供 -Title（写入 manifest）" }

$manifestArg = ""
if ($isNew) {
  $maniLocal = Join-Path $work ("up-{0}.manifest" -f $Id)
  [IO.File]::WriteAllText($maniLocal, "$Id`t$Title`n", (New-Object System.Text.UTF8Encoding($false)))
  $maniRemote = "/tmp/lt-up-$Id.manifest"
  & $scpCmd.Source -o BatchMode=yes -o ConnectTimeout=15 $maniLocal ("aliyun:{0}" -f $maniRemote)
  if ($LASTEXITCODE -ne 0) { throw "manifest 上传失败" }
  $manifestArg = " $maniRemote"
  Write-Host "      新增条目 id=$Id title=$Title"
} else {
  Write-Host "      catalog 已存在 id=$Id，按映射原位替换（服务端自动备份）"
}
& ssh @sshArgs ("bash /opt/listen-together/bin/media-manage.sh install {0} {1}{2}" -f $Id, $remoteTmp, $manifestArg)
if ($LASTEXITCODE -ne 0) { throw "服务端安装失败（exit=$LASTEXITCODE）" }

# ---------- 4. 可选重启 ----------
if ($Restart) {
  Write-Host "[4/4] 重启 listen-together（内存房间会被清空）..."
  & ssh @sshArgs "systemctl restart listen-together"
  if ($LASTEXITCODE -ne 0) { throw "systemctl restart 失败" }
  $healthy = $false
  foreach ($i in 1..15) {
    Start-Sleep -Seconds 1
    & ssh @sshArgs "curl -fsS -m 2 http://127.0.0.1:3000/health" | Out-Null
    if ($LASTEXITCODE -eq 0) { $healthy = $true; break }
  }
  if (-not $healthy) { throw "重启后 15 秒内 health 未恢复" }
  Write-Host "      health 已恢复"
} else {
  Write-Host "[4/4] 跳过重启（批量上传时请在最后一首加 -Restart，或手动 systemctl restart listen-together）"
}

Write-Host "服务端曲库状态："
& ssh @sshArgs "bash /opt/listen-together/bin/media-manage.sh verify"
if ($LASTEXITCODE -ne 0) { throw "服务端 verify 失败" }
Write-Host "完成：$Id"
