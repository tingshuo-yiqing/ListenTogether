# 2026-09-27 云端真机补验与歌词跟随修复

## 环境与范围

- 操作者：Codex；用户完成相机实际对准二维码并确认识别。
- PHQ110（设备内部序列号 `fbddbe8`），1080×2412，系统字号 1.0。USB 重插后一度枚举为无序列号；驱动按 transport 选设备，并核验 `ro.serialno`，不重启 ADB、不改热点/飞行模式。
- 修复前 APK：`854846985C5420A68CF05E677267FC9185CA0B6317432197181D8B46538BB77E`，20,489,954 字节，设备端 sha256sum/stat 与本地一致。
- 后端只读确认：`id=20260927-1240 / prev=20260927-1226`。本轮未部署、未重启云端。
- 只创建一个云端验收房间 `5D8527E1`；`scripts/host-remote.mjs` 持有房主 WS，手机作为成员。令牌只放 gitignore 下 `.workbuddy/cloud-device-followup/room.json`，不进证据文件。
- 音频听感、双真机同步不由截图或状态代替，仍需各自验收。

## 修复前复现

1. 脚本房主选 `he-bu-ke`，暂停并 `seek 50000`。
2. 真机展开歌词，当前句位于 `[96,1734][984,1806]`，时间 0:50；见 `05-lyrics-before.xml/png`。
3. 在歌词区滑动 `input swipe 540 2010 540 1580 180`，等 3 秒。
4. `06-lyrics-stuck.xml/png`：时间仍为 0:50，当前句已不在视口，「回到当前歌词」也不在；视口停在后续段落，证明未自动恢复。

根因：恢复只改 `manualPaused=false`，`LaunchedEffect(current)` 只在换句时执行。暂停或长句期间不会换句，导致恢复永久挂起。原计时也未等待惯性滚动结束。

## 改动

- `LyricsFollow.kt` 产出可取消的跟随目标流；恢复时同一行重新发出，暂停立即取消滚动。
- `RoomPlayer.kt` 等手势和惯性滚动结束后 **3 秒**自动恢复，继续滑动则重新计时；按本轮用户反馈删除「回到当前歌词」按钮。切歌以 `key(id, hasLyrics)` 重建歌词子树，重置加载值与列表位置。
- `LyricsFollowTest` 新增 4 项，覆盖暂停歌曲同一行恢复、翻看期间换句、重复采样不重复滚动、seek 到首行前取消后再恢复。
- 完整 Lint 首次发现相册解码器已有 `UseKtx` 警告，等价替换为 `Bitmap.scale(filter=true)`，保留缩放和回收行为。

## 相机扫码回归

- `09-scan-source.xml` 确认右上角扫码 → 来源弹窗 →「用相机扫描」。前台 Activity 实测为 `com.journeyapps.barcodescanner.CaptureActivity`。
- `invite.png` 用已有 qrcode 工具生成，载荷同 `InviteCode.encode`，仅含公开房间码与服务器地址，不含令牌。
- 用户确认「已识别并显示确认卡」。USB 恢复后 `11-camera-recognized.xml/png` 已在房间页，显示 2 人、已连接、23 首曲库，与房主状态对应。
- 本轮相机已有授权，首次授权/拒绝分支未重新覆盖。扫码在修复前包上完成，歌词修复未改相机逻辑。

## 云端 API 只读核对

- `catalog.json` 是本轮真实 HTTP 200 响应，23 首。
- `/lyrics/he-bu-ke`：200，2,147 字节，SHA256 `583ffd17a932cfa147969566beb2f1c99e6587f554862bf93608770c5a096a3f`。
- 备份到本地忽略目录后，仅删除手机 `cache/lyrics/he-bu-ke.lrc` 再展开；新缓存时间为 17:28、2,147 字节，设备 SHA256 与上方一致。见 `cloud-lyrics-check.json`、`13-final-lyrics.xml/png`。其余歌词缓存未清除。

## 最终门禁与设备复验

**完成**。最终版 debug `A586F93C7E7487A8ACB67A4A82170D4AE4F2AF5EBA020DEA42AD9AA826D2E13F`，20,489,954 字节；已覆盖安装并 `pm path` 回拉，两项逐位一致。R8 benchmark `E7053FE570CDB67C248ED0EF89029601ED4D0B5862F4839EB836B5C7C9D4FDB1`，2,445,981 字节，未装机。见 `build-summary.json`。

- `cleanTestDebugUnitTest → testDebugUnitTest → assembleDebug → lintDebug → assembleBenchmark` 成功，127 项单测、20 个测试类，失败/错误/跳过均 0；Lint 0。最终报告额外删除后用 `lintDebug` 重新生成，避免旧时间戳。构建日志见 `gradle-final.log`。
- 最终交互由 `three-second-regression.py` 实跑：800ms 手动翻页、1 秒后截图仍在浏览位置；再翻一次、1 秒后仍在浏览位置；继续等待 5 秒后恢复。歌词区域与基线的平均像素差分别为 11.4633 / 12.3389 / **0.0**；暂停进度始终 0:50，无「回到当前歌词」按钮。见 `26-three-*.png/xml` 与 `three-second-regression.json`。这证明无提前回位、继续翻看能延后恢复、最终准确归位；三秒门槛来自源码 `delay(3_000)`，截图不宣称毫秒级测量。
- 初次修复中间包 `54A52F8A…`：三档滑动 180/90/350ms 均恢复相同当前句位置 `[96,1734][984,1806]`，见 `device-regression.json`；云端播放时媒体会话 PLAYING/1.0x，0:50→1:26 的当前句高亮随进度变化，见 `16/17` 截图；滚动后切《痴心绝对》回到新歌词开头，切《单车》显示无时间轴占位，见 `18/19`。该包仍含 500ms/返回按钮，已被最终版取代，见 `build-summary-initial.json`；`20/23` 的按钮尝试不算最终交互证据，按钮已按用户要求删除。
- 本轮未改后端/协议，未重跑服务端测试；未覆盖 2 倍字号、小屏、双真机、首次相机权限分支。媒体音量实测 0，未改动音量，不宣称听感验收。

## 清理

- 18:01 手机退出房间回到加入页（`28-cleanup-home.xml`），脚本房主执行 `quit` 并正常退出（退出码 0）。只有一间空测试房，按现有机制约 5 分钟后回收；未重启服务器。
- 未关闭热点、未开飞行模式、未修改字号或系统电源设置；歌词缓存已重新生成，备份仍留本机忽略目录。
- USB 中途掉线后改用 transport 并核对设备身份；自动审批服务一度用量耗尽，原通道恢复后继续完成，未绕过审批。

## 取证工具

`device.py capture <名字>` 二进制直读截图，避免污染相册；`dump <名字>` 使用唯一设备临时路径、检查成功标志后才读取 XML，失败不复用旧树；`shell ...` 执行设备命令。静态暂停态用 XML，播放中用截图和媒体会话。
