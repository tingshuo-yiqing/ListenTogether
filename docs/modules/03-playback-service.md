# 03 Android 播放服务

## 媒体元数据（2026-10-02 本地通过）

PlaybackService 构造 MediaItem 时使用 `playback/TrackMetadata.kt` 的 `Track.mediaMetadata()`：title、artist（空时“一起听歌”）、albumTitle；实际 Media3 builder 三项 JVM 测试通过，换到无专辑曲时 albumTitle=null，不沿用前曲。Models.kt 解析公开 album，缺失/空串/错类型兼容旧服务端。歌手原本已有实现，本轮提取共用构造并补回归。

本轮安卓 180 项/24 套件、Lint 0；固定 APK 041b4295… 未装机，不以 JVM metadata 值代替系统通知显示。播放策略、entryId、本机暂停与 SyncMath/纠偏参数未改。证据：[无真机任务](../test-results/2026-10-02-desktop-tasks/README.md)。

2026-10-01 最新修复与设备边界见 [修复报告](../test-results/2026-10-01-queue-chat-fixes/README.md)及 [verification](../verification.md)：server 63/63、安卓 173、脚本 51/51、Lint 0；ACC 代码/自动化通过，完整设备矩阵与发布仍待验。当前 APK ABCB8582… 已覆盖安装 PHQ110；历史报告保持原失败与对应版本。

最新播放修复：track=null 先 stop/clearMediaItems、复位倍速与上报进度，再检查本机暂停；loadedEntryId 与 loadedTrackId 共同判断装载身份，同曲重新入队能重新加载。聊天/队列更新不调用 applyState，播放/连接/校时仍通知观察者。b5d83aaf… 实机在蓝牙中断本机暂停后自然耗尽，MediaSession NONE/0/null/空队列取得证据；后续能力补丁未改此服务源码。SyncMath/纠偏参数不变；下面原生 UI 交付段为修复前历史。

## 职责与当前入口
PlaybackService.kt 持有 ExoPlayer、MediaSession、HTTP音频数据源；播放可独立于页面继续。
ForwardingSimpleBasePlayer 将通知/耳机媒体控制转为 RoomClient 意图，applyState 直接操作底层 Player，避免同步回发成控制指令。
PlaybackPolicy 判断共享播放与本地暂停；音频属性使用媒体用途并由 ExoPlayer 管理焦点。
（v2，QC-B2）通知/蓝牙的下一首 = 房主 `skip-next`（服务端消费队头），上一首 = 回到当前曲开头（seek 0 保留播放/暂停意图）；服务端仍是播放唯一来源。`sync/TrackQueue.kt` 已删除，播放路径不再依赖全库歌单。

## 原生 UI 控制接线（2026-10-01）

本轮重做 Compose 迷你播放器 / 展开页，并继续通过现有 `RoomClient.setPlaying`、`command("seek")`、`skipNext` 发出用户意图；不新增第二播放器。`PlaybackService.kt`、MediaSession 路由、校时 / 漂移参数与本机暂停规则均未因 UI 修改而改写。真实封面与歌词继续通过既有鉴权、缓存与 `lyricsVer` 链路读取。

展开播放器移除「回到开头」，保留底部集中 seek / 播放 / 下一首；成员只暂停 / 恢复本机，不显示可点击的共享 seek / 下一首。媒体通知与耳机的既有上一首仍为 seek 0、下一首仍为房主 skip-next；页面按钮精简不代表通知栏行为已改或本轮已验收通知栏。清空当前曲时 UI 隐藏迷你播放器并关闭展开页，但本机暂停下旧媒体清理顺序与聊天 / 待播触发 applyState 等存量 v2 缺陷仍见 [独立验收](../test-results/2026-09-30-queue-chat-acceptance/README.md)，不能由 UI 隐藏推断 Service 已清理旧通知或音频。

本轮原生截图、APK 与门禁见 [Android 验收](../test-results/2026-10-01-android-ui/README.md)；双真机同步、真实听感 / 通知栏及 R8 帧表现必须各有专项证据，沿用历史通过结论时须保持对应 APK 与环境边界。

## 数据流
收到有效房间快照 → 匹配 Track → 设置鉴权请求头 → 计算目标位置 → 必要时换 MediaItem/prepare/seek → 更新 playWhenReady。
音频异常、持久焦点丢失、耳机拔出进入本地暂停，用户明确恢复后才继续。
无身份停止并清空；失去连接、未校时或本地暂停时不跟听。500ms 进度上报用于 UI，不是向服务器发送指令。

## 会话绑定与缓冲（2026-09-21 实现）
- Service 创建时通过 attachStateObserver 捕获会话代次；onDestroy/onTaskRemoved 只在代次仍匹配时 detach 回调并退出房间，旧实例不再无条件清空 onState 或替新会话发退出。
- 缓冲期间（STATE_BUFFERING）不做 seek/变速纠正；进入缓冲和回到 READY 都会触发一次 applyState，实现"缓冲完成后立即按最新快照校准"。
- 播放错误、校准（load/seek/speed）、缓冲进出、进入本地暂停的边沿写入诊断 JSONL（correction 字段），release 构建为空操作。本地暂停被快照周期反复触发，只在进入暂停沿记录一条 `correction:"localPause"`，避免刷屏（2026-09-22 补，此前暂停期间 JSONL 无条目）。

## 会话代次守卫（2026-09-24 修复 A-01）
- onDestroy 已有代次守卫，但 applyState 入口、onPlayerError 回调、500ms 位置上报循环、onPlayWhenReadyChanged（焦点/耳机）均直接操作 RoomClient 单例，未核对 boundGeneration。
- 退出/换房间后旧 service 实例销毁前的窗口内，循环会把旧播放器位置经 client.updatePosition 写进新会话、applyState 会按新会话曲目 load/seek（双播放器竞态），onPlayerError/onPlayWhenReadyChanged 会把新会话误标 locallyPaused。
- 修复：四处加 `client.sessionGeneration != boundGeneration` 守卫。applyState 入口守卫触发时 pause + stopSelf，不让服务僵住；循环守卫触发时 stopSelf + break，让系统销毁并重建实例。
- 行为约定不变：服务端仍是播放唯一来源、明确点击播放才解除本机暂停。

## 漂移自检与渲染缓冲（2026-09-23 实现）
- 位置上报仍为 500ms 一次；自检（applyState）从"仅 5 秒校时/状态变化时触发"改为每秒一次，欠载型漂移不再在 5 秒间隔内累积成风暴。
- 纠正分级见同步模块文档：500ms–2.5s 连续变速追赶（correction:"speed"），>2.5s 才 seek；暂停/load/大漂移 seek 时倍速复位。
- 新增 SmoothRenderers：AudioTrack 缓冲加大到约 0.7 秒（120KB，默认几十毫秒），吸收省电降频/后台负载造成的调度抖动，减少"卡顿音"；位置上报按已渲染帧计算，不受缓冲深度影响，同步精度不变。

## 播放失败提示（2026-09-22 实现）
onPlayerError 沿异常链取 HTTP 状态码交给 [PlaybackFailure] 分类：401 提示退出后重新加入，404 提示音乐文件缺失，其余保留 ExoPlayer 错误码并提示点击播放重试。失败一律进入本机暂停，只有明确点击播放才重试。
真机侧：通知栏媒体按钮实际点击、蓝牙耳机断开触发本机暂停、404 音频错误（改名长测试音后拖到未缓冲区）与恢复均已验证，见 [M3 记录](../test-results/2026-09-22-m3-bluetooth-audio-error/README.md)。因短测试音会被一次性缓冲，音频错误注入需用 demo-long（40 分钟）等长测试音。

## 通知栏切歌命令（2026-09-24 修复 后台上一首/下一首失效）
- 症状：媒体通知没有「下一首」按钮，「上一首」表现为回到当前曲目开头。
- 根因：`ForwardingSimpleBasePlayer.getState()` 透传底层单条目 ExoPlayer 的可用命令——没有 COMMAND_SEEK_TO_NEXT，COMMAND_SEEK_TO_PREVIOUS 由 ExoPlayer 实现为回到条目开头（rewind），转发器把它当普通 seek 处理。
- 修复：`controlled` 覆写 `getState()` 用 `State.buildUpon()` 追加 COMMAND_SEEK_TO_NEXT/PREVIOUS；`handleSeek(mediaItemIndex, positionMs, seekCommand)` 对 NEXT 调 `client.skipNext()`、PREVIOUS 调 `command("seek", 0)`（回到开头），仅房主生效；其余 seek 仍走房主 command seek。成员身份由服务端拒绝，客户端不另设限。
- 依赖陷阱：`kotlin.math.floorMod` 不存在（编译期即失败），负数安全回绕用 `java.lang.Math.floorMod`；Kotlin `%` 对负数保留负号。TrackQueueTest 5 项覆盖回绕/空歌单/未知当前曲目/单首自环。

## 下一阶段
将单个可变回调收敛为生命周期内的状态订阅。
增加真实准备/播放诊断状态，UI不要把“房间要求播放”误当成“设备已经出声”。
音频失效不立即无限 prepare，保持手动重试；401 是否应直接作废会话转为重新加入，待真机复现后决定。
保留自然顺序播完逻辑由服务器推进，客户端不另发自动切歌命令。

## 生命周期与异常
Activity 退出只释放 Controller；后台播放依靠媒体前台服务。
主动退出房间应释放播放器/会话/协程；划掉任务时根据播放状态执行现有策略并明确提示。
系统杀进程后不恢复旧令牌，打开 APP 重新加入；不承诺进程被终止后持续播放。
临时音频焦点抑制与持久丢失分别测试，不把系统暂时压低声音等同于退出房间。

## 验收
已验证单机出声、暂停/跳转/切歌、返回桌面和短暂息屏；完整记录见 [真机记录](../archive/playback-test-2026-09-21.md)。
通知栏媒体按钮实际点击已验证（2026-09-22，见 [M3 记录](../test-results/2026-09-22-m3-notification-device/README.md)）；上一首/下一首真实切歌修复后验收见 [试用反馈轮记录](../test-results/2026-09-24-feedback-round/README.md)。
蓝牙耳机断开相当于拔出路径，已验证本机暂停且重连后不自动恢复；音频 404 错误与手动重试恢复已验证（2026-09-22，见 [M3 记录](../test-results/2026-09-22-m3-bluetooth-audio-error/README.md)）。
音频焦点抢占已验证（2026-09-22，见 [M3 焦点记录](../test-results/2026-09-22-m3-focus/README.md)）：其他应用持久抢占与真实来电均在本机暂停、服务端版本不变、不自动恢复，明确播放后按服务器进度续播；瞬态来电同样收敛为手动恢复（本地暂停态覆盖 ExoPlayer 瞬态自动恢复，无抖动）。注意：部分厂商应用（如 OPPO 视频）不经焦点而直接暂停媒体会话，此时按“显式暂停”处理并同步服务端，两条路径已区分记录。
长时息屏已于 09-24 完成，401 注入已于 09-22 完成；真实令牌作废（后端无入口）与退出后立即重新入房的生命周期竞态仍需专项真机验证。
成员本地暂停不改变服务器；房主系统暂停影响房间，房主音频中断只暂停其本机。
日志与状态只能证明软件行为，实际音频输出需要听感或录音证据。

## 核心注释与记录
解释受控Player与底层Player的分工、applyState的副作用、音频焦点原因码、资源释放顺序和会话归属。
2026-09-21：建档，已实现行为与后续生命周期加固分开说明。
2026-09-22：新增 PlaybackFailure 失败提示分类；补通知栏按钮真实点击、蓝牙断开本机暂停、404 错误与恢复真机证据。
2026-09-22：音频焦点抢占（其他媒体、真实来电）真机验证通过；补 localPause 边沿诊断并复验。
2026-09-24：修复 A-01 会话代次守卫——applyState/onPlayerError/500ms循环/焦点回调四处加代次检查，旧实例不再影响新会话。
2026-09-24：修复后台通知栏上一首/下一首——getState() 补 NEXT/PREVIOUS 命令、handleSeek 路由到 TrackQueue.skip（房主 select）；真机验收见 test-results/2026-09-24-feedback-round。
2026-09-30（QC-B2）：v2——当前曲元数据来自 state.track（空为 null → pause + clearMediaItems + 复位倍速，通知栏不留旧曲标题与可用切歌钮，房间连接与队列保留）；切歌路由改 skip-next / 回到开头；select 与 TrackQueue 退出生产播放路径。

## 2026-09-26 遗留修复：倍速实际复位
原 load/大漂移 seek 分支只把 `catchupSpeed` 缓存置 1.0，未写回 ExoPlayer，导致后续暂停复位也可能被缓存短路。删除重复缓存，`PlaybackPolicy.correctionSpeed` 直接以 `player.playbackParameters.speed` 决策；换曲、共享暂停、断线/本机暂停、空曲目与大漂移 seek 均写回原速。阈值、权限与同步时基不变。新增 5 项策略回归覆盖双向追赶、复位、缓冲和滞回；实际听感/设备倍速仍待真机，见 [本轮记录](../test-results/2026-09-26-legacy-fixes/README.md)。

2026-10-01：Compose 播放器控制继续走现有业务意图，展开页删除回开头而媒体通知保留现实现；Service / 同步源码未改，存量 v2 缺陷与设备验证边界显式保留。
