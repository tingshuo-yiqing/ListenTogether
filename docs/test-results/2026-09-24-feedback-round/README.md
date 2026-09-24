# 2026-09-24 试用反馈轮：通知栏切歌修复 + 顶栏收拢 + 口令隐端口 + 去搜索

## 反馈来源

用户试用（PHQ110，APK 6C231394…）后提出 4 项，指令「对于建议可以采纳并优化，Bug一定要修好」：

| # | 类型 | 内容 |
|---|---|---|
| 1 | 建议 | 去掉复制房间号和房主；分享的连接不要暴露服务器端口号 |
| 2 | 建议 | 增加上一首和下一首的图标来控制播放 |
| 3 | 建议 | 去掉搜索功能；去掉云上最后一段测试音 |
| 4 | **Bug** | 后台播放（媒体通知）没有下一首；上一首的效果不是上一首，而是回到当前这首的最开头 |

## Bug④ 根因与修复

- **根因**：`PlaybackService.kt` 的 `ForwardingSimpleBasePlayer` 默认把 `getState()`（含 `availableCommands`）透传给被转发的**单条目** ExoPlayer——单条目播放器没有 `COMMAND_SEEK_TO_NEXT`，`COMMAND_SEEK_TO_PREVIOUS` 由 ExoPlayer 自己实现为"回到条目开头"（rewind），**根本到不了转发器的 `handleSeek`**。所以通知栏不显示下一首按钮、上一首表现为回开头。
- **修复**（[陷阱 9.4](../../development-pitfalls.md)）：
  1. `controlled` 覆写 `getState()`，用 `State.buildUpon()` 追加 `COMMAND_SEEK_TO_NEXT` / `COMMAND_SEEK_TO_PREVIOUS`；
  2. `handleSeek(mediaItemIndex, positionMs, seekCommand)` 对 NEXT/PREVIOUS 调 `sync/TrackQueue.skip(tracks, currentId, ±1)`，仅房主实际发 `command("select")`；其余 seek 仍走房主 command seek；
  3. `TrackQueue.skip`（新增纯函数，无时钟/网络）：环形回绕（下一首在末尾回第一首、上一首在开头回最后一首）；当前曲目不在歌单（含 null）时下一首取第一首、上一首取最后一首；空歌单返回 null；单首自环。回绕用 `java.lang.Math.floorMod`——`kotlin.math.floorMod` 顶层函数不存在（编译期失败，[陷阱 9.5](../../development-pitfalls.md)），Kotlin `%` 对负数保留负号不可用。
- **TrackQueueTest 5 项**：next 末尾回绕 / prev 开头回绕 / 空歌单 null / 未知当前曲目双向兜底 / 单首自环。

## 建议② 展开页切歌钮（PlayerSheet）

- 标题行新增 上一首（48dp 圆钮）→ 播放/暂停（56dp）→ 下一首，`canSkip` = 有身份且未 busy；`skip` 走 `TrackQueue.skip(±1)` + `client.command("select")`。
- 成员（非房主）点按弹 Snackbar「只有房主可以切歌」——与歌单点歌行为一致；服务端仍是播放唯一来源，客户端只在用户点按时发切歌命令。

## 建议① 顶栏收拢 + 口令隐端口

- **顶栏**：删除胶囊内复制图标与「房主」标注；房间码胶囊（PillShape + secondaryContainer + 等宽）改为只读，不可点按；操作区保留分享与退出。口令 encode 单一来源不变。
- **口令隐端口**：`InviteCode.encode` 对 `http(s)://主机:3000` 剥掉 `:3000`（正则 `^(https?://[^/?#]+):3000$`），分享口令不再暴露端口号；`RoomClient.join` 在地址唯一入口把未写端口的 URL（okhttp 回填成协议默认 80/443）补回 3000——**口令省略与入房补回互为 round-trip**；显式非默认端口（如 `:8080`）两向原样保留。
- **单测**：InviteCodeTest 改写 1 项（encode 隐端口）+ 新增 2 项（非默认端口 round-trip、decode 容忍无端口口令）；RoomClientSessionTest 3 处既有断言改以 `:3000` 基址为准（兼作回归），新增 `explicitNonDefaultPortPreserved` 1 项。

## 建议③ 去搜索 + 云端去测试音

- **去搜索**：MainActivity 移除搜索框/搜索状态；删除 `ui/PlaylistFilter.kt` 与 `PlaylistFilterTest`（净删 9 项单测）；「保存长图」不再带筛选词，导出全量歌单；清空「没有匹配的歌曲」占位一并移除。（后续：「保存长图」已于 2026-09-25 反馈二小轮整体删除。）
- **云端曲库**：`/opt/listen-together/media/` 备份至 `media-originals/20260924-221628/`（mp3 + catalog.json.bak）→ catalog.json 24→23 → demo-load.mp3 移出 media 目录 → `systemctl restart listen-together` → catalog API 返回 23 首实证 → `m4-deploy-verify.sh` **pass=14 fail=0**（脚本按 catalog.json 动态抽查，不受条数变化影响）。曲库是启动时加载的内存态，改后必须重启（[陷阱 8.10](../../development-pitfalls.md)）。

## 构建门禁

```
gradlew :app:cleanTestDebugUnitTest :app:testDebugUnitTest :app:assembleDebug :app:lintDebug
BUILD SUCCESSFUL in 1m 47s
```

- 单测实跑 **74 项**：`build/test-results/testDebugUnitTest/*.xml` 合计 `tests=74`，0 failures / 0 errors（`> Task :app:testDebugUnitTest` 实跑不带 UP-TO-DATE）；
- Lint 0 错误 0 警告；
- APK SHA256 **011DD835CF111A9DB8B352E206B00A341962EC5D5722D3D8830AC54BFEF1910E**。

## 真机验收（2026-09-24 深夜 PHQ110 公网部分完成，2026-09-25 用户指示终止补验）

安装 APK 时 PHQ110 曾离线；重连后经公网 `http://8.166.126.136:3000`（23 首曲库）用 adb 驱动脚本（`.workbuddy/fb_driver.py`，结果日志与截图/dump 在 `.workbuddy/`）多轮执行。判定主要依赖 `dumpsys media_session` 元数据 `description=<曲名>`（播放中 Compose 动效条使页面 uiautomator dump 失败——陷阱 2.11，dump 依赖项均在暂停态采集）。2026-09-25 用户指示「其它部分放弃验证，实现功能就行不需要测试」，未补验项就地关闭，不再回填：

| # | 场景 | 判定 | 结果 |
|---|---|---|---|
| 1 | 通知栏点「下一首」（播放中，公网 23 首曲库） | 当前曲目变为下一首 | ✅ 有何不可→痴心绝对（#1→#2，元数据实证） |
| 2 | 通知栏点「上一首」 | 变为上一首（**不再回开头**）；首曲回绕末首 | ✅ 痴心绝对→有何不可（#2→#1）；#1 再点上一首→王妃（#23，环形回绕） |
| 3 | 展开播放页点上一首/下一首钮 | 同 1/2 | ✅ 末首点下一首→#1、#1 点上一首→王妃(#23)；截图 fb-sheet-skip.png |
| 4 | 成员身份点切歌钮/通知栏切歌 | Snackbar「只有房主可以切歌」，曲目不变 | ⏹ 未验即关闭（用户指示终止；代码路径房主守卫 + onLockedTap 为已验收既有模式） |
| 5 | 分享口令文本 | 服务器行无 `:3000`；整段粘回→确认卡→加入同房 | ✅ 分享面板实文 `来一起听歌 / 房间码 B2A6FE18 / 服务器 http://8.166.126.136 / 复制整段…`（无 :3000，面板含「复制」目标，fb-chooser.png/xml）；⏹ 粘贴重入同房子项未验即关闭（该闭环批次 1 已在旧版真机验收过，本轮增量仅为隐端口） |
| 6 | 顶栏 | 无复制图标、无「房主」标注，胶囊不可点按；分享/退出可用 | ✅（fb-topbar.png；**注：2026-09-25 反馈二小轮已把房间码胶囊整体移除，顶栏只显示应用名**） |
| 7 | 歌单区 | 无搜索框；云端 23 首真实音乐，无 demo-load | ✅（catalog API 23 首 + 页面 dump 无搜索框） |
| 8 | 保存长图 | 导出全量歌单 PNG，不含地址/令牌 | ⏹ 驱动两次误点后未通过验证，随即随 2026-09-25 反馈二小轮**功能整体删除**而作废 |

## 边界与如实标注

- 单测/Lint/构建与云端验证（catalog 23 首、m4 脚本 14/14）已完成；真机场景 1/2/3/5(分享文本)/6/7 实测通过，场景 4、5(粘贴重入)按用户指示**未验即关闭**，场景 8 随功能删除作废。蓝牙上一首/下一首走同一 `handleSeek` 路径，随场景 1/2 覆盖（未单独立项）。
- 本记录之后工作区代码已含 2026-09-25 反馈二小轮改动（顶栏去房间码 + 删保存长图），**未重建 APK、未跑门禁**，锚点 011DD835… 对应改动前的树。
- 云端 LOAD-15 负载重测依赖 demo-load（192k 码率模型），如需重测先从 media-originals/20260924-221628/ 恢复（见 [陷阱 8.10](../../development-pitfalls.md)）。
