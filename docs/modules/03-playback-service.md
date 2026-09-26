# 03 Android 播放服务

## 职责与当前入口
PlaybackService.kt 持有 ExoPlayer、MediaSession、HTTP音频数据源；播放可独立于页面继续。
ForwardingSimpleBasePlayer 将通知/耳机媒体控制转为 RoomClient 意图，applyState 直接操作底层 Player，避免同步回发成控制指令。
PlaybackPolicy 判断共享播放与本地暂停；音频属性使用媒体用途并由 ExoPlayer 管理焦点。
通知/蓝牙的上一首、下一首经 `sync/TrackQueue.skip`（环形回绕纯函数）转为房主 select 意图；服务端仍是播放唯一来源，客户端只在用户点按时发切歌命令。

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
- 修复：`controlled` 覆写 `getState()` 用 `State.buildUpon()` 追加 COMMAND_SEEK_TO_NEXT/PREVIOUS；`handleSeek(mediaItemIndex, positionMs, seekCommand)` 对 NEXT/PREVIOUS 调 `TrackQueue.skip(tracks, currentId, ±1)`（环形回绕，未知当前曲目时下一首取第一首、上一首取最后一首），仅房主实际发 `command("select")`；其余 seek 仍走房主 command seek。成员身份由服务端拒绝，客户端不另设限。
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

## 2026-09-26 遗留修复：倍速实际复位
原 load/大漂移 seek 分支只把 `catchupSpeed` 缓存置 1.0，未写回 ExoPlayer，导致后续暂停复位也可能被缓存短路。删除重复缓存，`PlaybackPolicy.correctionSpeed` 直接以 `player.playbackParameters.speed` 决策；换曲、共享暂停、断线/本机暂停、空曲目与大漂移 seek 均写回原速。阈值、权限与同步时基不变。新增 5 项策略回归覆盖双向追赶、复位、缓冲和滞回；实际听感/设备倍速仍待真机，见 [本轮记录](../test-results/2026-09-26-legacy-fixes/README.md)。
