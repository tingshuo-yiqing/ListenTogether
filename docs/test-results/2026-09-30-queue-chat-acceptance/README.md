# 点歌队列 / 聊天 v2 独立验收

日期：2026-09-30（Asia/Shanghai）。结论：**验收未通过，暂不具备发布条件**。

后续状态：见 [2026-10-01 当前 UI 复验](../2026-10-01-queue-chat-reacceptance/README.md)。ACC-02 源码与自动化已关闭，ACC-03 部分改善，整体仍未通过；下面保留 09-30 原始版本的检查与结论，不将旧失败覆盖成新通过。

用户当前正在 PHQ110 真机调试。本轮核对源码、实跑既有门禁、运行隔离服务端/客户端验收探针，并只读采集真机截图、APK 与诊断。用户选择自行继续操作手机后，未再操控手机界面。探针均使用随机本地端口或假传输层，不向在用房间注入错误，不操作真实 media/，未改功能代码、提交 Git 或部署云端。

## 环境与已有门禁

- Git HEAD：495d335，工作区含 QC-0 至 QC-E 的既有未提交改动；验收针对本轮实际工作区源码，不仅是 HEAD。
- 真机：OPPO PHQ110，ADB 无线连接；本机 127.0.0.1:3000 为已有 v2 调试服务（PID 41560，未停止/重启）。能力探测 queue/catalogSearch/chat 均为 true；结束检查 health=ok、1 房间/1 在线成员/1 WS。
- 已安装 APK 从设备回拉：SHA256 `d29c5e865ce59ef11f93b69844453274c5c97adf2458126acc95ad3baf5d703f`，与交付 debug APK 逐位一致。
- 本轮 `.\scripts\check.ps1 -Scope server`：构建通过，**56/56**，退出码 0。
- 本轮 `.\scripts\check.ps1 -Scope android`：cleanTestDebugUnitTest 强制实跑，**130 项 / 19 套件 / 0 失败 / 0 错误**；Lint 与 assembleDebug 通过，退出码 0。
- 真机首张截图确认为“新 APK + 旧云端”不兼容提示；后续 [当前截图](device-current.png) 可见 v2 点歌页、30/45 首结果与常驻播放器，诊断有点歌/聊天/播放记录。[设备诊断](device-diag.jsonl) 保存本轮读取时点的用户调试日志；声音听感、完整操作矩阵和通知栏实际点击未由本轮独立验证。

已有门禁全绿仅证明既有用例通过。下面额外的 **7 项服务端检查、5 项客户端检查均失败**，不等同于全部既有功能失败；它们证明原用例未覆盖关键验收边界。

## 续验（同日晚，UI 在另一聊天并行调整）

用户要求继续验收，并说明另一聊天会调整 UI。本次只新增服务端领域/发送器隔离探针，没有操作手机、重启调试服务、修改产品源码或重跑安卓构建。当前 debug 工件仍为 `d29c5e86…`；后续 UI 构建与本报告的设备截图、客户端测试应分别按源码与 APK 版本判定，不外推为新 UI 已通过。

[续验探针](extended-probe.mjs) **5 项：2 通过、3 失败**，[结果与服务端源码/编译产物 SHA256](extended-probe-results.json) 固定本次版本。正常 skip-next 保留播放意图、发送完成后全服待发计数归零通过。失效队列两项失败归入新增 ACC-12；慢写调度失败补强 ACC-10。结束时原 3000/3100 Node 进程仍在，health=ok、0 房间/0 在线成员/0 WS，无验收探针进程残留。

- **失效队列（领域注入）**：当前 t0、待播 t1/t2/t3/t4，将前三项标为服务端已知不存在，skip-next 后 current=null、playing=false、待播仍有有效 t4。全部四项失效时也残留 t4。没有模拟当前系统支持曲库热更新；此检查验证设计明确要求的已知失效防御路径。
- **慢写分块（可控发送器注入）**：7 块各约 30KB、逻辑快照共 210,630 字节，小于 512KiB 应用限额。延迟发送 callback 后，只发出 5 块、待发 150,450 字节就关闭 1013；回调恢复后计数归零，但剩余两块未继续发送。需要保留 128KiB 保护并在达到它之前暂停发送、按完成回调继续，而不是删除保护或改为固定 sleep。这是确定性调度检查，不是真实 TCP 吞吐或真机弱网测试。
- **设备选择**：PHQ110 主验收通知栏、键盘、后台与音频；MuMu 可补成员操作、聊天、重连与布局。按 [09-28 双机实测](../2026-09-28-m2-two-device/README.md)，MuMu 音频时钟曾慢约 2–3%，因此不用于关闭双真机声音同步门槛。本轮未启动 MuMu。

## 必须修复的问题

| 编号 / 优先级 | 触发与结果 | 证据与修复验收要求 |
|---|---|---|
| ACC-01 / P1 | 已认证成员发送合法 JSON `null`，错误上报函数又读取 `message.requestId`，产生未捕捉 TypeError；标准 Node 运行方式会退出整个后端。另用非 UUID ID 与额外字段点歌仍成功。 | [服务端探针](probe-results.json)；[socket.ts](../../../server/src/realtime/socket.ts) L150–166。解析后先验证非 null 对象与消息 schema，错误路径也必须接受未知输入；真实 WS 验证 null/数组/类型/额外字段均安全返回且进程存活。文档 schema 的测试校验不能替代入站运行时校验。 |
| ACC-02 / P1 | 点歌“加载更多”将第二页直接覆盖第一页；45 首曲库首屏 30，下一页剩 15，之后 offset 取当前页长度 15，导致反复翻错页。旧加载更多请求也没有查询代次守卫，可覆盖新的查询结果。 | [RoomScreen.kt](../../../android/app/src/main/java/com/listentogether/app/ui/RoomScreen.kt) L337；searchCatalog 只返回单页。累计去重追加、使用正确下一页 offset，绑定查询/会话代次，409 清页后重新查第一页；用 45/1000 首和延迟响应实测。此项为源码确认，用户操作尚不计本轮独立复现。 |
| ACC-03 / P1 | 发送聊天立即清空输入；失败 ack 或 5 秒超时又删除 pending，原文本丢失，没有失败气泡与复用原 ID/issuedAtMs 的重试入口。聊天页切换时草稿由分支内 rememberSaveable 持有，缺少上层页面保存机制。 | [RoomScreen.kt](../../../android/app/src/main/java/com/listentogether/app/ui/RoomScreen.kt) L124/L158；[RoomClient.kt](../../../android/app/src/main/java/com/listentogether/app/network/RoomClient.kt) L418–460。失败/未确认操作保留文本及原操作身份；离房清理；限频/丢 ack/切页/回页专项复测。此项为源码确认，不宣称已模拟真机断网。 |
| ACC-04 / P1 | 聊天缺 seq=2 后收到 seq=3，不触发恢复；快照缺一块，5 秒后仍不恢复；同一毫秒的 snapshotId 采用随机后缀，却被客户端按字符串大小比较，较新的低后缀快照被拒绝。组装也未实现声明的 512KiB 字节上限与旧缓冲清理。 | [客户端失败 XML](client-probe-results.xml)：序号缺口/缺块超时/随机后缀三个测试失败；[RoomClient.kt](../../../android/app/src/main/java/com/listentogether/app/network/RoomClient.kt) L259/L395。以协议版本/顺序号判断快照新旧，单独组装身份；完整块集、字节预算、5 秒超时、一次恢复和旧缓冲回收均需实测。 |
| ACC-05 / P1 | 单条聊天和仅待播变化都调用 onState，PlaybackService 绑定的回调直接 applyState，聊天由此能直接触发漂移纠正。 | 客户端测试 expected callback=0，actual=1；[RoomClient.kt](../../../android/app/src/main/java/com/listentogether/app/network/RoomClient.kt) L251–267，[PlaybackService.kt](../../../android/app/src/main/java/com/listentogether/app/playback/PlaybackService.kt) L119。播放观察者仅订阅播放/连接/本机暂停状态；确定性测试隔离定时纠偏后验证聊天和待播变化的 load/seek/变速增量为 0。不能据此声称已观测真机声音卡顿。 |
| ACC-06 / P2 | 连续收到 101 条聊天后客户端保留 101 条，只有快照替换会收敛为 100；持续聊天会不断增长。 | 客户端窗口测试 expected=100、actual=101。实时事件也必须裁剪窗口，并兼顾 pending/未读/列表滚动语义。 |
| ACC-07 / P2 | play/pause/seek 仍走原 command 路径，不带 ID/issuedAtMs，也不返回 ack；同 ID play 两次产生两次 version 增量。设计声明“所有 WS 副作用操作（包括播放命令）去重”没有落地，protocol.md 示例反而沿用无 ID command。 | 服务端探针 version 增量=2、ack=false；[socket.ts](../../../server/src/realtime/socket.ts) L182，[RoomClient.kt](../../../android/app/src/main/java/com/listentogether/app/network/RoomClient.kt) L318。服务端/安卓/唯一 schema 一起补齐；延迟 seek 重试须只执行一次并回原 ack。 |
| ACC-08 / P2 | 已确认操作在 issuedAtMs+10 分钟**恰好到期**时，记录已被删除，但时间校验只用 `<`；同请求被当成新操作执行。 | 服务端探针 permitsNewExecutionAtExactExpiry=true；[dedupe.ts](../../../server/src/rooms/dedupe.ts) L43。统一到期边界并覆盖恰好到期、下一毫秒和时钟回拨。 |
| ACC-09 / P2 | 每房间 4MiB 去重字节限制没有实现；1700 条记录累计 5,540,890 字节仍接受。指纹直接保留完整聊天 text，计费固定预估 +256 也不是实际结果字节数；protocol.md 已将设计的房间字节门槛删除，未记录取舍。 | 服务端探针；[dedupe.ts](../../../server/src/rooms/dedupe.ts) L51–61。实现房间/全服预算、紧凑指纹、准确或保守且有上界的结果计费；容量压力下旧确认可回放、新操作无副作用被拒绝。 |
| ACC-10 / P2 | 队列快照从不分块；100 条正常长度的合成中文标题产生 **81,873 字节单帧**，超过设计的 32KiB。聊天分块后仍一次性同步连发，没有按发送完成/缓冲回落持续调度；现有慢网脚本并不等于传输写缓冲背压验证。 | 服务端探针；[store.ts](../../../server/src/rooms/store.ts) L101，[socket.ts](../../../server/src/realtime/socket.ts) L43/L83。队列/聊天统一按实际完整 JSON 字节分块，加入发送队列与 drain/callback 调度；慢消费者下不误关闭正常连接、全服容量可回收。 |
| ACC-11 / P2 | 第六条聊天触发 429，错误没有 clientMessageId，不能定位失败气泡；客户端也不解析关联错误，仅显示通用提示直到超时。 | 服务端探针 hasClientMessageId=false，retryAfterMs 存在；[socket.ts](../../../server/src/realtime/socket.ts) L158。所有合法请求的错误带对应 ID，客户端更新对应 pending/失败状态，限频重试保留原身份。 |
| ACC-12 / P2 | 连续失效条目的消费循环用正在缩短的 queue.length 作扫描上限，提前结束；有效下一首被留在待播且全房停止，全部失效时也未清空待播。 | [续验结果](extended-probe-results.json) 两个失效队列检查失败；[store.ts](../../../server/src/rooms/store.ts) L236。固定初始扫描预算或依靠有界队列逐项消费；覆盖 0/1/多条失效前缀、全部失效、100 条边界，以及暂停/播放下的跳过和自然曲终。 |

## 其他源码确认的验收缺口

- 能力探测只检查 protocol=2，不检查 queue/catalogSearch/chat 标志；UI 永远显示聊天页。会话重连没有重新能力探测，RoomState.parse 也不检查协议字段。需覆盖 B 版 chat=false 与后端回滚组合，不能把首次入房旧服务端提示通过外推为所有降级行为通过。
- ChatEntry 不保留 clientMessageId；先到广播不能据 senderId+clientMessageId 解除 pending，可能暂时显示两个气泡。ack 成功先到时又移除 pending 而不恢复缺失的广播。需验证两种顺序与广播/ack 单独丢失。
- 首屏历史可被当作未读，聊天页进入即清未读（不等用户回到底部）；没有“有新消息”入口，自己在翻历史时发送也不保证滚到底部。保留窗口到 100 后 size 不变，基于 size 的滚动触发也不足以覆盖新消息。
- 播放身份仍仅用 trackId，state 没有当前 entryId。客户端本机暂停的早退发生在空曲清媒体之前；本机暂停时收到清空状态可能保留旧媒体。待确认 seek 状态也需跟当前条目切换/清空一起清理。这些场景需单独测试，不用现有“曲终清空”领域单测替代设备验证。
- 新功能说明混有旧 v1、“下一阶段才做 schema”的表述；交付记录的窗口上限、缺口恢复、草稿保留、分块字节保护与实装存在不一致。修复时同步源码、回归、协议、模块文档与 verification，不能只改文字将缺失能力标成已实现。

## 复跑

```powershell
Set-Location D:\ListenTogether
.\scripts\check.ps1 -Scope server
.\scripts\check.ps1 -Scope android
node docs/test-results/2026-09-30-queue-chat-acceptance/probe.mjs
node docs/test-results/2026-09-30-queue-chat-acceptance/extended-probe.mjs
Set-Location D:\ListenTogether\android
.\gradlew.bat :app:testDebugUnitTest --tests com.listentogether.app.QueueChatAcceptanceProbeTest -I ..\docs\test-results\2026-09-30-queue-chat-acceptance\client-probe.init.gradle --console=plain
```

两条 Node 探针与客户端定向测试是**额外验收**：修复前退出码 1 为已记录的实际失败，不应改断言把它变绿。客户端 init 脚本仅显式传入 -I 时加载，未改产品或常规测试源集；[临时客户端测试源码](client-probe/QueueChatAcceptanceProbeTest.kt) 与两份服务端探针可供修复后回归。修复后将有价值的用例纳入常规测试。

## 剩余与清理

- 优先修 ACC-01，再修分页、聊天失败保留与恢复、播放订阅隔离；其余问题按清单闭环后重新验收。
- 旧 APK 连新后端的实际提示、通知栏下一首、空队列媒体清理、键盘/小屏/大字号、R8 帧表现和双真机同屏/声音同步仍待专项验证。当前用户手动调试截图/日志是辅助证据，不能单独关闭上述场景。
- 独立服务端探针完成后已关服务并退出；首轮异常探针残留进程仅按本脚本完整命令行匹配停止。现有 3000/3100 进程与房间保持。回拉 APK 留在 `.workbuddy/acceptance-device.apk` 作为装机一致性核对暂存；原始截图首份在 `.workbuddy/`，当前图和诊断落本目录。
- 未提交 Git、未触碰真实曲库或云端；功能修复在本轮验收之后开展。本轮结论是验收未通过，不将原交付的门禁全绿等同于完整验收。
