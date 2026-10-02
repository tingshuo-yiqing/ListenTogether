<#
.SYNOPSIS
M4 部署包打包：本地构建 server 并产出带 SHA256 清单的 tar.gz。

.DESCRIPTION
产出 deploy-artifacts/listen-together-<版本>-<日期>.tar.gz，内容与 docs/deployment.md 第 1 节一致：
server 源码 + dist + package-lock（不上传 node_modules，服务器端 npm ci）、media 曲库、deploy 模板、
部署文档；附 SHA256SUMS.txt 清单用于上传后完整性校验。
刻意排除：node_modules、Android 工程、.workbuddy、docs/test-results、日志与本地密钥。
用法：powershell -ExecutionPolicy Bypass -File scripts\package-deploy.ps1
更新在产后端时使用 -ServerOnly：排除 media/demo-media，持久曲库不会进入候选包。
-NodePath 可显式选 Node；缺省使用 PATH，避免绑定个人旧版本路径。
#>
param(
  [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
  [switch]$ServerOnly,
  [string]$NodePath = ''
)
$ErrorActionPreference = 'Stop'
$node = $NodePath
if (-not $node) { $node = (Get-Command node.exe -ErrorAction Stop).Source }
$tar = "$env:SystemRoot\System32\tar.exe"
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = Join-Path $RepoRoot 'deploy-artifacts'
$stage = Join-Path $outDir ("staging-" + $stamp)

if (-not (Test-Path $tar)) { throw "找不到 tar.exe：$tar" }

# 1. 本地构建（服务器端也会 npm ci + build，这里构建是为了提前暴露 TS 编译错误）
Push-Location (Join-Path $RepoRoot 'server')
& $node .\scripts\protocol-schema.mjs
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "协议模块生成失败，中止打包" }
& $node .\node_modules\typescript\bin\tsc
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "tsc 构建失败，中止打包" }
Pop-Location
Write-Host "[1/4] server 构建通过（tsc 0 错误）"

# 2. 组装暂存目录
New-Item -ItemType Directory -Force -Path $stage | Out-Null
$serverStage = Join-Path $stage 'server'
New-Item -ItemType Directory -Force -Path $serverStage | Out-Null
Copy-Item (Join-Path $RepoRoot 'server\src') $serverStage -Recurse
Copy-Item (Join-Path $RepoRoot 'server\dist') $serverStage -Recurse
Copy-Item (Join-Path $RepoRoot 'server\test') $serverStage -Recurse
Copy-Item (Join-Path $RepoRoot 'server\scripts') $serverStage -Recurse
Copy-Item (Join-Path $RepoRoot 'server\package.json') $serverStage
Copy-Item (Join-Path $RepoRoot 'server\package-lock.json') $serverStage
Copy-Item (Join-Path $RepoRoot 'server\tsconfig.json') $serverStage
if (-not $ServerOnly) {
Copy-Item (Join-Path $RepoRoot 'media') (Join-Path $stage 'media') -Recurse
# 旧默认包包含本机 media 和演示曲库；在产后端候选必须用 -ServerOnly，曲库维护单独执行。
# 只打包 catalog.json 引用到的文件，防止临时放入 demo-media 的个人音频（如 2026-09-22 的"有何不可.mp3"）误上云。
$demoStage = Join-Path $stage 'demo-media'
New-Item -ItemType Directory -Force -Path $demoStage | Out-Null
$demoCatalog = Get-Content (Join-Path $RepoRoot 'demo-media\catalog.json') -Raw -Encoding UTF8 | ConvertFrom-Json
Copy-Item (Join-Path $RepoRoot 'demo-media\catalog.json') $demoStage
Copy-Item (Join-Path $RepoRoot 'demo-media\README.md') $demoStage -ErrorAction SilentlyContinue
foreach ($t in $demoCatalog) {
  Copy-Item (Join-Path $RepoRoot ('demo-media\' + $t.file)) $demoStage
}
Write-Host ("      demo-media 按 catalog 引用打包 {0} 个音频" -f @($demoCatalog).Count)
} else {
  Write-Host '      ServerOnly：不包含 media 或 demo-media，云端持久曲库单独维护。'
}
Copy-Item (Join-Path $RepoRoot 'deploy') (Join-Path $stage 'deploy') -Recurse
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'docs') | Out-Null
Copy-Item (Join-Path $RepoRoot 'docs\deployment.md') (Join-Path $stage 'docs\deployment.md') -Force
Copy-Item (Join-Path $RepoRoot 'docs\protocol.md') (Join-Path $stage 'docs\protocol.md') -Force
Copy-Item (Join-Path $RepoRoot 'media\README.md') (Join-Path $stage 'docs\media-README.md') -Force -ErrorAction SilentlyContinue
Write-Host "[2/4] 暂存目录就绪：$stage"

# 3. 打 tar.gz（bsdtar 统一 / 前缀）
$kind = if ($ServerOnly) { 'server-' } else { '' }
$tarball = Join-Path $outDir ("listen-together-" + $kind + "0.1.0-" + $stamp + ".tar.gz")
& $tar -czf $tarball -C $stage .
if ($LASTEXITCODE -ne 0) { throw "tar 打包失败" }

# 4. SHA256 清单（tarball 本体 + 包内关键文件逐个校验值）
# 行尾必须是 LF：GNU grep 的 `$` 锚点不匹配 CR，CRLF 清单在服务器侧用 `grep '…$' 清单 | sha256sum -c -`
# 会静默拿到空输入并报 "no properly formatted checksum lines found"（本机 MSYS grep 会吞 CR，故本地看不出问题）。
# 见 docs/development-pitfalls.md 8.7。
$sumsFile = Join-Path $outDir ("SHA256SUMS-" + $stamp + ".txt")
$tarHash = (Get-FileHash $tarball -Algorithm SHA256).Hash.ToLower()
$lines = @("$tarHash  $(Split-Path -Leaf $tarball)")
Get-ChildItem $stage -Recurse -File | ForEach-Object {
  $rel = $_.FullName.Substring($stage.Length + 1).Replace('\', '/')
  $h = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower()
  $lines += "$h  $rel"
}
[System.IO.File]::WriteAllText($sumsFile, (($lines -join "`n") + "`n"), [System.Text.Encoding]::ASCII)
Write-Host "[3/4] 打包完成：$tarball"
Write-Host ("      大小 {0:N1} MB" -f ((Get-Item $tarball).Length / 1MB))
Write-Host "[4/4] SHA256 清单：$sumsFile"

# 只清理本次在 deploy-artifacts 内创建的暂存目录，拒绝对计算出的库外路径递归删除。
$resolvedOutput = [System.IO.Path]::GetFullPath($outDir).TrimEnd('\') + '\'
$resolvedStage = [System.IO.Path]::GetFullPath($stage)
if (-not $resolvedStage.StartsWith($resolvedOutput, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "暂存目录越出输出目录，拒绝清理：$resolvedStage"
}
Remove-Item -LiteralPath $resolvedStage -Recurse -Force
Write-Host "暂存目录已清理。上传服务器后用 sha256sum -c SHA256SUMS-*.txt 校验（tarball 行需手工比对）。"
