# 2026-10-01 Android 原生 UI 交付与 MuMu 检查

本轮直接修改现有 Kotlin / Jetpack Compose 工程，使用真实 RoomClient、Media3 PlaybackService、封面与 LRC 链路。HTML 只作为视觉参考，本轮没有新增网页或 WebView。用户在实施期间追加的两次左滑删除、右上主题选择均纳入源码与 APK。

**结果：原生 UI 与必要客户端接线已交付；147 项单测通过，Lint 0，assembleDebug 成功；MuMu 核心场景已取得原生截图和真实业务回显。软键盘遮挡、真机/双机与存量 v2 独立验收仍待验。** ACC-01 至 ACC-12 全部保持开放，不因本轮 UI 门禁关闭。

## 制品与环境

- 交付 APK：[ListenTogether-debug.apk](../../../.workbuddy/deliveries/2026-10-01-ui/ListenTogether-debug.apk)。构建原件：`android/app/build/outputs/apk/debug/app-debug.apk`。
- SHA256：`6C3E87586846E72B6369C0D38E6A8FAB0EE73DB986418A9634A4B999087860AA`；21,008,793 字节。已安装指定 MuMu 并回拉 base.apk 核对，结果见 [门禁与完整性数据](gate-summary.json)。
- MuMu：已运行的 MuMuPlayer-15.0-0，adb serial `127.0.0.1:16384`，YOK-AN10，Android 15，x86_64，1080×1920、density 280；本轮按手机竖屏操作，未使用 PHQ110。
- 测试后端：独立本地 `127.0.0.1:3300`，使用已有 v2 构建；`media/` 45 首真实曲库只读。原 3000/3100 与云端未重启；本轮未改服务端、真实曲库、协议或同步数学，未提交 Git。
- 初始环境与只读复核范围见 [environment.md](environment.md)，其中“预装旧包”是安装前记录，不能作为最终包状态。

## 源码交付

| 入口 | 本轮行为 |
|---|---|
| `MainActivity.kt`、`ui/CommonUi.kt`、`ui/ThemeSelector.kt`、`ui/theme/` | 暖白/松绿/柔杏浅深主题，默认跟随系统；顶栏主题图标选择系统/浅色/深色并保存到 appearance.xml，同步系统栏图标；退出需确认，邀请仍在成员面板 |
| `ui/RoomLayout.kt`、`ui/MembersSheet.kt` | 图标三页、各页输入与滚动、真实成员身份与邀请二维码/复制/系统分享；名单限高 180dp |
| `ui/QueueScreen.kt`、`ui/QueueSwipeRow.kt`、`ui/QueueMove.kt` | 待播行只封面/歌名/歌手；房主行级长按排序、边缘自动滚动，放手一次提交真实锚点及 expectedQueueVersion；第一次左滑只展开、点击或第二次左滑删除、右滑收起，无三个点菜单；成员仅能撤回自己的歌 |
| `ui/CatalogScreen.kt` | 真实搜索、防抖、累计分页及查询代次恢复；只有实际当前曲/队列中已有歌曲才显示禁用 ✓；局部处理态，随机只一首 |
| `ui/ConversationScreen.kt`、`network/RoomClient.kt`、`Models.kt` | 保留发送者/原文，省略逐条时间；Sending/Failed/Unconfirmed/Confirmed、单调时钟重试等待与原 ID/issuedAt 重发，按真实 messageId 对账；首次完整空快照也建立固定未读历史水位 |
| `ui/RoomPlayer.kt`、`CoverView.kt`、`LyricsState.kt` | 当前曲仅迷你条展示/展开；真实封面、曲名、歌手与歌词直接排列，固定底部控制；时间只在操作进度时显示，读屏仍有位置语义；歌词失败走真实重试，保留原 seek 确认/成员本机暂停链路 |

## 构建与必要回归

```powershell
cd D:\ListenTogether\android
.\gradlew.bat :app:cleanTestDebugUnitTest :app:testDebugUnitTest :app:assembleDebug :app:lintDebug --console=plain
```

- 本轮最终全量单测 **147 项 / 20 套件 / 0 失败 / 0 错误 / 0 跳过**，不是 UP-TO-DATE 沿用；见 [全量门禁 stdout](gradle-delivery-out.log) 与 [stderr](gradle-delivery-err.log)。
- 新增回归覆盖累计 45/1000 首分页、过期查询/409/失败重试、真实聊天原文/身份/广播 ack 对账、首次空快照未读、最终锚点与边缘滚动上界；侧滑回归钉住第一次长滑仅展开、第二次删除与右滑关闭。
- 主题设置出现一项 UseKtx 提醒，改用 SharedPreferences.edit 扩展后执行最终 assembleDebug + lintDebug，退出码 0、重新生成 Lint issue **0**；见 [最终 APK 门禁 stdout](gradle-apk-final-out.log) 与 [stderr](gradle-apk-final-err.log)。该修改不改变已测业务与同步行为。
- Kotlin 实际主题 token 静态对比度 **20/20**，结果见 [实际主题对比度数据](theme-contrast.json)，与 HTML 的历史配色计数分开。原生触控/读屏实测不由静态配色结果代替。
- 文档链接检查与 diff 空白检查另见 [docs-check.log](docs-check.log)。按用户要求未扩大为服务端重跑、负载或 R8 长时性能测试。

## 原生场景与截图

以下“交付版”截图均来自 SHA256 `6C3E8758…` 的 Android APK；没有 HTML 截图。所有点歌、聊天和队列变化均由真实后端回显，观察脚本只持有本地成员 WS，凭据留内存、不落证据文件。

| 场景 | 实际操作与判定 | 证据 |
|---|---|---|
| 首页与主题保存 | 系统深色时手选浅色，force-stop 后启动仍浅色；顶栏图标显示保存的选择 | [浅色首页](home-final-light.png)、[重启恢复](home-theme-restored-light.png)、[三态主题菜单](theme-menu-final-dark.png) |
| 主题覆盖与跟随 | 同一房间手选深色，系统改浅色仍深色；选跟随系统恢复浅色，成员/聊天/当前歌保留 | [深色覆盖系统浅色](manual-dark-system-light.png)、[恢复跟随](chat-final-light.png) |
| 建房与点歌 | 新房空当前曲/待播；首曲 Last Dance 提升当前曲且暂停；真实加入会呼吸的痛/倔强/偏偏喜欢你，成功 ✓ | [空房](queue-empty-final-light.png)、[点歌与真实封面](search-added-final-light.png) |
| 房间与长按排序 | 交付版将会呼吸的痛从第一项移到队尾，实际 queue.moved beforeEntryId=null；无三个点菜单 | [浅色队列](queue-final-light.png)、[深色队列](queue-final-dark.png)、[本地事件](server-events.jsonl) |
| 两次左滑删除 | 交付版第一次只展开；点删除后队列 3→2；下一行第一次展开后再次左滑，2→1；不提前从本地假删 | [展开删除](queue-swipe-final-light.png)、[删除回显](queue-delete-final-light.png)、[真实 WS 回显](ws-observation.jsonl) |
| 跨屏与边缘自动滚动 | 同轮侧滑版 EFF85FEA…（队列源码与交付版相同，尚无主题图标）：13 首时会呼吸的痛由首项拖到屏外队尾，边缘滚动产生屏外条目，queueVersion 15→16 | [拖动高亮](queue-dragging-final-dark.png)、[滚到队尾](queue-autoscrolled-final-dark.png)、[真实 WS 回显](ws-observation.jsonl) |
| 聊天 | 实际 QA Friend 发送中文/emoji、Android 发送 Hello，双方发送者保留且无逐条时间；此前本轮切页 Draft 原文恢复 | [交付版聊天](chat-final-dark.png)、[此前同轮草稿恢复](chat-draft-restored-light.png)、[真实 WS 回显](ws-observation.jsonl) |
| 成员与邀请 | 实际两名在线，房主标记、二维码在同一成员面板；本轮已操作复制得到系统反馈，分享为原生 Intent 接线 | [交付版成员二维码](members-final-dark.png)、[此前同轮复制反馈](members-copy-light.png) |
| 展开与播放 | Last Dance 的真实封面/LRC；迷你条展开，底部播放/暂停实际改变服务端状态，默认无常驻进度时间 | [交付版浅色播放器](player-final-light.png)、[深色播放器](player-final-dark.png) |
| seek 时间 | 本轮初版 F0EBA2A3…（播放器代码与交付版相同）进度拖动时才出现时间；释放后真实 Media3位置=190145ms，PlaybackState PLAYING，error=null | [操作进度截图](player-seeking-light.png)；不能据此声称已听音频 |
| 确认退出 | 取消回到同一房间；确认离房后回到表单且没有旧迷你条 | [确认框](exit-confirm-final-light.png)、[退出后首页](home-after-exit-final-light.png) |

原始截图分阶段保留：初版 F0EBA2A3…、侧滑版 EFF85FEA…、最终交付版 6C3E8758…。未列为通过的旧手势尝试截图不可作为最终拖排结果；原始脚本的节点未找到/准备条目耗尽是工具定位或准备失败，须按真实版本/事件重新核对，不将工具退出码冒充 UI 操作通过。

最终浅色/深色播放器截图在弹层进入动画结束后补拍，已复核底部控制完整可见。立即截图曾捕获过渡帧，不能据该帧判定产品布局裁切。

## 未完成与存量缺陷

- **IME 未验**：MuMu 当前 Sogou 输入法没有显示软键盘，虽然本轮打开 show_ime_with_hard_keyboard 并观察焦点，截图仍无键盘；因此键盘避让不能判通过。源码把 imePadding 放 Scaffold，真机/可正常显示键盘的模拟器需补显式操作。本轮没有安装额外输入法。
- 未完成真机触感/TalkBack/相机新布局/系统字号/小屏、系统分享接收与跨设备扫码、成员端实际撤回、通知栏下一首实际点击、暂停下空队列清媒体专项、音频听感与双真机同步/M2 95% 门槛。取消应用两倍字号切换与横屏布局，不关闭系统字号/双真机等旧待办。
- 聊天失败/未确认/原 ID 重试与分页异常由必要 JVM 回归覆盖，本轮未注入真实断网/429/快照缺口；不可将正常消息发送截图当故障恢复通过。
- [v2 独立验收](../2026-09-30-queue-chat-acceptance/README.md) **整体仍未通过，ACC-01 至 ACC-12 全部开放**。本轮 ACC-02/03 有部分必要客户端改善，但服务端 WS null 入站、缺口/缺块、100 条窗口、播放观察者隔离、去重/字节上限/队列分块等仍须定向修复与复验。
- 云端仍是历史 v1，本轮 APK 协议仍 v2；连旧服务端进入 Incompatible 是既有设计行为。本轮未访问/发布云端。

## 参考与收尾

实施前只读参考 [Calvin-LL/Reorderable](https://github.com/Calvin-LL/Reorderable) 的稳定条目/长按/边缘滚动思路，以及 [Android 官方 Compose 示例](https://github.com/android/compose-samples) 的播放器组织；本轮未加入第三方拖排依赖或复制整段实现。横滑以 [AndroidX 手势源码](https://github.com/androidx/androidx/blob/androidx-main/compose/foundation/foundation/src/commonMain/kotlin/androidx/compose/foundation/gestures/DragGestureDetector.kt) 和 [Android 官方拖动文档](https://developer.android.com/develop/ui/compose/touch-input/pointer-input/drag-swipe-fling) 为参考，采用两次独立手势确认，而非第一次整行消失。

模块 01/02/03、UI 规格、verification.md 与 AGENTS 快照同步。陷阱 2.18/3.11/4.11/4.12/4.13 回填设备旋转、有效新 XML、动画稳定帧、行级手势与聊天初始水位。收尾恢复原 MuMu connection.xml、系统旋转/主题与软键盘设置，移除本轮 3300 reverse、结束本轮本地服务/观察成员；交付 APK 留在 MuMu，未操作其它设备/后端。
