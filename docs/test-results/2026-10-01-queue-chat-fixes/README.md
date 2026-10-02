# v2 缺陷修复与真机验收

日期：2026-10-01（Asia/Shanghai）。**原 ACC-01、ACC-03 至 ACC-12 的代码与自动化检查已通过；ACC-02 延续此前关闭结论。基础单真机验收已开展，完整弱网、双真机声音同步和云端发布仍待验。** 原失败报告与结果保留，不把历史失败改写成通过。

## 最终版本与门禁

- 服务端构建、常规测试 **63/63**：[日志](server-check.log)。原 56 项保留，新增 7 项常规回归涵盖真实 WS、去重、容量、失效队列与发送器。
- 安卓最终强制实跑 **173 项 / 22 套件 / 0 失败 / 0 错误 / 0 跳过**，assembleDebug、Lint 0：[最终日志](android-capabilities-check.log)、[JUnit](baseline-android/TEST-com.listentogether.app.QueueChatRecoveryTest.xml)、[组装器测试](baseline-android/TEST-com.listentogether.app.SnapshotCollectorTest.xml)、[Lint](lint-results-debug.xml)。原附加 11 项转入常规测试且通过；另补 2 项恢复/观察者、7 项组装器与 6 项能力协商回归。末次 Lint 分析/报告为 UP-TO-DATE，读取有效 XML issue=0，不宣称强制重分析。
- 脚本离线单测 **51/51**：[日志](scripts-check.log)。15 名脚本成员的 [30 秒隔离混合负载](mixed-load-summary.json)：429=0、确认超时=0、意外错误=0、seq 缺口/倒退=0；命令确认 p95=2.6ms、校时 RTT p95=11.9ms。此为短时回归，不替代历史 600 秒规模或多设备出声验收。
- 最终 debug APK：21,008,793 字节，SHA256 **`abcb8582ed25d87a50574f07043addc6d2e73d554bb1030b389177b6118eb17c`**；安装成功见 [最终安装记录](install-delivery.log)。[版本清单](version-before.json)固定实际未提交源码/编译产物 77 文件与 APK，不能用 Git HEAD 替代。
- 初轮设备包 `e3074064…`（165 项）见 [初轮清单](version-initial-device.json)、[初轮 JUnit](baseline-android-initial/TEST-com.listentogether.app.QueueChatRecoveryTest.xml)。随后 b5d83aaf…（167 项）补恢复响应再次缺块/跨房间过期预算清理，并取得真实蓝牙与空曲证据，见 [硬件取证版本](version-acc-fixed.json)、[安装](install-final.log)。最后补能力协商，形成当前 ABCB8582…；只改 Models/RoomClient/RoomLayout，播放服务源码未变。`final-` 截图属于 b5d83aaf…，`delivery-` 属当前 ABCB8582…，下表按真实版本列示。

## 修复对账

| 项目 | 代码与自动化结果 |
|---|---|
| ACC-01 | 入站先按文档 schema 校验 unknown，错误格式化安全提取 ID；认证 WS null/数组/错误 UUID/额外字段均 400，连接继续工作，无业务副作用。 |
| ACC-02 | 延续累计分页与查询代次回归；45/1000 首与 409 恢复仍通过。 |
| ACC-03 | 原文/原 ID/原 issuedAtMs 保留；确认超时请求一次恢复而不重发；广播或快照用 senderId+clientMessageId 收敛 pending，ack 丢失不造成重复气泡。 |
| ACC-04 | SnapshotCollector 按 queueVersion/latestSeq 组装；随机 ID 仅归组；5 秒缺块恢复、恢复响应再缺块继续恢复；两类缓冲共享 512KiB、单帧 32KiB，代次切换清缓冲/任务；seq 缺口主动 chat.sync。 |
| ACC-05 | 队列、聊天与两类快照只更新 UI 流，不调用播放观察者；三类回归 observer=0。播放/时钟/连接变化仍通知播放器。 |
| ACC-06 | 实时与快照合并后的聊天均裁剪至最近 100 条。 |
| ACC-07 | play/pause/seek 带 UUID+issuedAtMs、经统一去重返回 ack；各命令重复 ID 仅增加一次 version，异参拒绝。 |
| ACC-08 | issuedAtMs+TTL 恰好到期即拒绝，服务端时间回拨不复活。 |
| ACC-09 | 每房间 4MiB/10000 条、全服 64MiB；先预留紧凑确认容量再执行业务，指纹 SHA256；提交按真实存储计费，限频/异常取消；压力下清理其他房间过期记录，房间销毁释放。另有真正压满房间/全服预算的常规回归。 |
| ACC-10 | 队列/聊天统一按完整封装后的 UTF-8 分块；一帧在途，回调/drain 继续；未开始同类快照合并，已开始的完整发送；close/抛错/回调错误及迟到回调不漏账。 |
| ACC-11 | chat 429 携带 clientMessageId 与 retryAfterMs；客户端按原 ID 标失败并保留原文/等待期限。 |
| ACC-12 | 固定初始扫描预算；连续三项失效后能到有效 t4，全失效完整消费并停止。 |

播放服务另修复：空 track 在本机暂停判定前 stop/clearMediaItems/复位倍速与进度；以 entryId 与 trackId 判断装载身份；UI 待确认 seek 随 entryId 清理。未调整 SyncMath 或纠偏参数。

原验收报告另列的能力协商缺口也已补齐：queue/catalogSearch 为 v2 必需功能，缺失或非布尔 true 不创建成员；chat 可选，false 隐藏聊天入口、禁止发送/重试/恢复与应用聊天帧。每次重连先重新探测，网络失败继续退避，404/426 或不兼容协议转终态、不盲重放；旧探测受会话代次隔离。入站 state 的协议字段不兼容时不应用快照。6 项常规回归覆盖必需能力、chat=false、后端回滚、探测网络失败、旧 state 协议与迟到探测。

## 独立探针

[服务端探针](probe-results.json) **7/7**、[队列/慢写](extended-probe-results.json) **5/5**。

100 条合成队列的领域快照仍为完整数组（81,873 字节）；真实 WS 输出 3 块 **32,031 / 32,040 / 18,135 字节**，收齐恰好 100 项。原探针观察的是内部领域函数；本轮改为验证真实传输帧，保留原 32KiB 断言并增加完整性检查，没有给巨大单帧添加假 chunkCount。

210,630 字节的慢写样本完整发送 **7/7** 块，零关闭、全服计费归零。发送完成模型现在按每帧字节回收 bufferedAmount；原历史结果保留。它验证调度，不声称测量真实 TCP 速度。原 1700 条长指纹样本经哈希压缩后仅 520,200 字节；容量门槛另由常规测试的高占用结果和小全服预算实际压满验证。

## PHQ110 设备记录

USB 多次抖动/消失，按用户指示重试；后改无线调试，mDNS 自动发现 `192.168.43.15:41293`，连接、reverse 3000/3001、安装成功。本轮后端只监听本机并只读既有 45 首曲库。首轮测试房间 `E61976F4`，最终房间 `9B99487B`；脚本成员为隔离测试身份，不代表第二台真机。

| 场景 | 实测与证据 |
|---|---|
| 空房与三页 | [空队列](screenshots/room-empty.png)、[曲库](screenshots/catalog-page1.png)、[聊天](screenshots/chat-sent.png)；点歌真 ✓、待播两项与成员、未读徽标取得证据。 |
| 输入/草稿/收发 | [真实 IME](screenshots/chat-ime.png)：输入框、发送按钮、迷你条在键盘上方；[切页后草稿](screenshots/draft-after-switch.png)原文保留；[发送后](screenshots/chat-sent.png)真实 Host 气泡且输入清空，无重复 pending。初轮包 e3074064… 。 |
| 通知栏下一首 | [通知控制](screenshots/notification-playing.png)有上一首/暂停/下一首；实际点击后服务端 queue.skipped、下一条目 ju-hao 被消费，playing=true；[界面回显](screenshots/notification-next.png)。自然顺播可能在取证间隔发生，以后端事件为动作依据，不把旧截图标题当点击前实时状态。 |
| 自然耗尽 | [空曲界面](screenshots/queue-exhausted-chat.png)无迷你条；dumpsys：state=NONE(0)、position/buffer=0、description=null、queue size=0；[通知清空](screenshots/notification-empty.png)无旧媒体卡。 |
| b5d83aaf… 播放/耳机 | [播放](screenshots/final-playing.png)：建房、点歌与播放，dumpsys PLAYING、Last Dance。用户确认“已重新连接蓝牙，有声音，断开后暂停了”；[原始诊断](device-bluetooth-diag.jsonl)在 11:36:33.587 记录 Last Dance / version=4 / position=137610ms / localPause=true，且 correction=localPause。 |
| 本机暂停期间自然空曲 | [中断横幅与空曲](screenshots/final-bluetooth-paused.png)、[随后界面](screenshots/final-empty-while-paused.png)；[后端](backend-final.log)在 11:38:46.232 queue.advanced entryId=null；[媒体会话](device-bluetooth-media.txt)为 NONE(0)、position/buffer=0、description=null、queue=0。比暂停记录晚约 133 秒，确认本机暂停后服务端自然耗尽仍清媒体。抓取时下一首按钮已消失，不能计作该条件下手动 skip 通过。 |
| b5d83aaf… IME 与聊天 | [真实键盘](screenshots/final-chat-ime.png)输入框/发送按钮无遮挡；[发送后](screenshots/final-chat-sent.png)只有一条 Host 的 final-chat-001 正式气泡，草稿清空；[硬件包回拉](device-bluetooth.json)为完整 21,008,793 字节、SHA256 与 b5d83aaf… 逐位一致，AndroidRuntime 错误为空。 |

蓝牙声音听感与实际断开暂停由用户确认，诊断/自然耗尽后空曲状态如上；连续声音、真实弱网/聊天失败原 ID 重试、全部成员权限/手势、旧 APK 连新后端 426 与双真机仍待验。本机暂停期间手动 skip 单独补验。shell 注入 AUDIO_BECOMING_NOISY 被 Android 权限拒绝，不据此宣称通过，也不绕过权限。MuMu 不替代双真机同步门槛。

使用 ui-ux-pro-max 的入口状态/图标语义与安全区指导，仅核对能力关闭的两页入口、选中态和现有 IME 布局；不修改原生 UI 设计。系统最大字号/小屏、TalkBack/触感等完整矩阵保留。

## 实现与复跑

协议由 `server/scripts/protocol-schema.mjs` 在 dev/build/test 前从 protocol.md 生成 TS，运行时 Ajv 编译一次；生成文件不独立维护，dist 运行无需读取 Markdown。部署打包入口已携带生成脚本和 protocol.md；本轮未打含真实曲库的部署包、未部署云端或提交 Git。

参考 [ws 官方 send/缓冲说明](https://github.com/websockets/ws/blob/master/doc/ws.md)与 [Ajv 编译校验指南](https://ajv.js.org/guide/getting-started.html)：按发送完成回调驱动队列，并在进程初始化编译文档契约。

```powershell
Set-Location D:\ListenTogether
.\scripts\check.ps1 -Scope server
.\scripts\check.ps1 -Scope android
.\scripts\check.ps1 -Scope scripts
node docs/test-results/2026-10-01-queue-chat-fixes/probe.mjs
node docs/test-results/2026-10-01-queue-chat-fixes/extended-probe.mjs
node scripts/qcd-mixed-load.mjs --duration 30 --members 15
```

云端仍 v1 `20260928-1815`，真实曲库未改，已有未提交 UI/v2 成果保留。所有后续状态只登记 verification.md。

## 用户接手操作（本轮收尾）

用户要求暂停自动操作并改为自行操作手机；后续只读应用日志/诊断，不自动点击或输入。当前 ABCB8582… 已安装且 [设备回拉](device-final.json)的完整 21,008,793 字节 SHA256 与本地一致，AndroidRuntime 错误为空；[复核清单](version-after.json)与 version-before 的 77 个产品文件哈希相同，173 项结果与 Lint 0 保持。真实 chat=false 两页界面与当前包房间内补验尚未完成，不能用前台切离造成的无效样本算通过。

临时能力降级夹具 3112 已停止。本机 v2 后端 3000 保持运行供用户调试；应用地址用 http://127.0.0.1:3000（无线 adb reverse）。真实耳机与自然耗尽证据仍属于 b5d83aaf…，不转记为 ABCB8582… 的重复硬件实测。文档本地链接与 git diff --check 已通过；未部署云端、未改真实曲库、未提交 Git。
