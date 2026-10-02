# 02 Android 网络与会话

2026-10-01 最新交付见 [动物头像与双主题报告](../test-results/2026-10-01-animal-avatars/README.md)及 [verification](../verification.md)：server 70/70、安卓 177 项/23 套件、Lint 0；当前 APK 89E90EEB… 已覆盖安装 PHQ110，随机唯一头像、重叠排列与双主题真机通过。ACC 完整设备矩阵与发布仍待验，历史结果及设备版本保留在 [修复报告](../test-results/2026-10-01-queue-chat-fixes/README.md)。

最新实现：文档能力标志 queue/catalogSearch 必需、chat 可选；首次入房与每次重连先探测，网络失败继续退避，不兼容转终态；迟到探测受代次保护，state 的协议字段不兼容不应用。queue/chat 独立 UI 流，不调用播放观察者。SnapshotCollector 以版本/seq 判顺序，5 秒缺块恢复、单帧 32KiB、两类组装共享 512KiB；退出/断线清任务与缓冲。聊天实时/恢复窗口最多 100 条，seq 缺口主动恢复，确认超时只核对状态；广播/快照以 senderId+clientMessageId 对账，429 明确关联原 ID。play/pause/seek 也带 UUID+issuedAtMs，Ready 才发送，确认超时不盲重发。

## 职责和接口

2026-10-01 动物头像：RoomState.parse 保留成员的可选 avatarId，ChatEntry.parse 保留可选 senderAvatarId；全端以同一服务端分配为准，客户端不对成员 ID 散列后猜动物。旧 v2 缺字段/未知 ID 使用原昵称占位；senderAvatarId 随历史消息保留，不依赖发送者仍在成员列表。协议保持 v2，详见 [头像记录](../test-results/2026-10-01-animal-avatars/README.md)。
RoomClient.kt 负责 HTTP 入房/曲库/退出，WS 连接和重连，以及 UI 状态发布。
入口为 join、command、setPlaying、pauseLocally、leave，以及队列操作、chatSend / retryChat / chatSync、searchCatalog；UI 和 Service 不直接持有 OkHttp WebSocket。
Credentials 保存 code/memberId/token；RoomState 是服务器快照。协议详见 [当前 v2 协议](../protocol.md)。

## 当前实现
HTTP 在 IO 协程中执行，状态切换到主线程；请求超时 15 秒。
generation 区分加入/退出，WS 回调同时检查连接引用，防止旧回调影响新连接。
每 5 秒请求校时；未返回的校时请求超过 15 秒后取消连接。重连退避 1/2/4/8/16 秒。
401/404 或正常关闭导致终止重试提示。离线不缓存/重放播放指令。
成员令牌只在请求头发送；server 地址保存在 SharedPreferences。

## 会话与状态机（2026-09-21 实现）
- 不可变 SessionContext(baseUrl, credentials, generation) 已落地：join 成功即创建，请求原语 rawRequest 的地址与令牌全部来自调用方给定，IO 协程不再读取可变 baseUrl；带上下文的 request 保证旧退出请求不会发去新服务器。
- 连接状态机 ConnectionStatus：Idle → Joining → Connecting → Calibrating → Ready；断线进入 Reconnecting（UI 提供“立即重试”，清退避并立即重连）；401/404 或正常关闭进入 Expired（须退出后重新加入；从 Expired 发起 join 会先走完整 leave 清理）；用户退出回 Idle。busy/connected 改为由状态派生。
- 校时估计改为 ClockEstimator（见同步模块）；断线或退出即 clear() 全部样本，恢复后先快照再校时才回 Ready。
- leave 顺序：作废旧代次 → 取消重连/校时任务 → 关闭 Socket → 用旧上下文尽力发 DELETE；本地不等待，新会话不受影响。join 捕获 CancellationException 时原样重抛，不显示为服务器错误。
- 状态回调改为 attachStateObserver/detachStateObserver（带代次校验），播放服务销毁不能清掉新会话的观察者。
- 诊断日志（debug JSONL）记录 join、socket-open、reconnecting、expired、leave、command 事件，不含令牌。
- 约定端口归一（2026-09-24）：join 是地址唯一入口——未写端口的 URL（okhttp 回填成协议默认 80/443）按项目约定补 3000，显式非默认端口（如 :8080）原样保留；与 InviteCode.encode 剥掉 `:3000` 的口令省略互为 round-trip。RoomClientSessionTest 以断言 `:3000` 基址覆盖该行为。

## 原生 UI 最小客户端接线（2026-10-01 UI 交付时点；后续修复以上文为准）

本轮保持 HTTP / WS 协议与播放同步实现，补齐界面需要的真实操作状态；服务端代码未改。详细设备与门禁结果由 [本轮 Android 验收](../test-results/2026-10-01-android-ui/README.md)登记，当前进度仍以 [verification.md](../verification.md)为准。

- **Ready 门禁**：新的队列副作用与聊天发送 / 重试依赖已校时的 `serverNow`，要求 `ConnectionStatus.Ready`。`connected` 仍包含 Calibrating，与“可以发送新的业务操作”不同；旧播放 command 路径不在本轮改写。
- **点歌处理态**：`UiState.queueAdding: Set<String>` 保存正在添加的 trackId，`randomAdding: Boolean` 表示随机添加处理中，抑制同一行 / 随机按钮重复提交。ack、明确关联 requestId 的错误、Socket 拒绝发送与 5 秒确认超时均清理相应局部状态。处理态不修改 room / queue；成功勾只由当前曲或待播快照中的真实歌曲决定。超时提示核对状态，不自动重放队列操作。
- **聊天原文接管**：`chatSend(text): Boolean` 在未接入、未 Ready、空白、超过 500 个 Unicode 码点或 UTF-8 2048 字节时返回 false，界面保留草稿。true 表示完整原文已存入本地气泡；即使 Socket 随后拒绝 send，原文也留在失败气泡中。草稿由房间页面会话持有，退出 / 换身份后清理。
- **原操作身份**：`PendingChat` 保存 `clientMessageId`、原 `issuedAtMs`（服务端时基毫秒）和 text。重试不能生成新 ID、刷新发起时间或改文本；本机列表 key 与操作身份一致，后续发送不会覆盖前一条原文。

| `ChatDelivery` | 含义与行为 |
|---|---|
| `Sending` | 原操作已交给 Socket；显示发送中，禁止重复重试 |
| `Unconfirmed` | 5 秒没有对应确认；保留原文并显示暂未确认，不断言服务端未发送 |
| `Failed` | 明确拒绝或 Socket 没接收消息；保留原文、原因与显式重试入口 |
| `Confirmed` | 收到成功 ack；保留原文直至与真实服务端消息身份对账，不开放重试 |

- **有限显式重试**：`retryChat(clientMessageId): Boolean` 只在同会话、Ready、非 Sending / Confirmed、未到期且限频等待结束时重发完整原操作。`retryAtMonoMs` 与 `expiresAtMonoMs` 均使用手机单调时钟毫秒；初始期限为 10 分钟，ack 的服务端 expiresAtMs 换算剩余时长后只收窄本地期限。恰好到期即拒绝，断线不自动补发，也不通过换 ID 绕过去重。`chatRetryDelayMs` 提供剩余等待毫秒数。确定性失败原 ID 的重试仍会回放同一失败结果，不伪装成重新创建消息。
- **ack / 广播对账**：成功 ack 的 `result.messageId` 是本地气泡与真实 `ChatEntry` 的唯一映射；不按相同文本猜身份，也不构造 seq / createdAtMs。广播先到则 ack 对账后去掉本地项；ack 先到则保留 Confirmed 原文并请求 chat.sync，后续同 messageId 的真实广播或完整快照再去掉本地项。
- **初始历史基线**：`chatSnapshotReceived` 默认 false，完整聊天快照组装并应用后 true，包括 latestSeq=0 的空快照；`chatInitialSeq` 只记录首次完整快照的 latestSeq，后续事件与 chatSync 不覆盖它。UI 用这条固定水位建立已读基线，即使状态流合流也不会把紧随空快照的第一条他人消息当成首次历史。离房随 UiState 重置；这不是缺块超时或 seq 缺口恢复实现。
- **关联错误边界**：错误帧只更新明确携带 clientMessageId 的本地项。存量服务端聊天 429 缺 clientMessageId，客户端不能猜是哪条消息失败；只显示通用提示，原气泡最终进入 Unconfirmed，后续由用户原 ID 核对 / 重试。此项仍须服务端与客户端联动修复。

`RoomClientSessionTest` 本轮新增 8 项定向回归，覆盖 ack 先到后快照恢复、广播先到后 ack 对账、超时原 ID / issuedAtMs / 原文不变、失败与单调等待 / 恰好到期、emoji 码点 / 离线草稿、队列局部状态清理与 Socket send=false、无关联错误不猜消息、初始空快照基线及离房清理；既有聊天 ack 用例按新语义替换。实际执行数量和通过结果由本轮报告填写，不在此凭源码声明测试已通过。

### 修复前 v2 验收边界（保留历史失败，不代表当前源码）

2026-10-01 独立复验更新：本次普通 147 项通过，附加 11 项中 4 通过 / 7 失败。原文 / 原 ID 重试、明确关联 429 等待、服务端缩短期限、成功 ack 后快照对账已实跑通过；确认超时未发一次 chat.sync、广播带原 clientMessageId 仍不解除 pending，故 ACC-03 仅部分修复，ACC-11 服务端关联仍开放。ACC-02 的分页源码与自动化已单独关闭；设备切页 / IME / 通知栏未实测。最新结果见 [复验报告](../test-results/2026-10-01-queue-chat-reacceptance/README.md)，下文 09-30 边界记录保留为历史依据。

[2026-09-30 独立验收](../test-results/2026-09-30-queue-chat-acceptance/README.md)仍未整体通过。本轮未实现聊天 seq 缺口自动恢复、缺块 5 秒恢复 / 缓冲字节预算、随机 snapshotId 的新旧判定、实时消息 100 条裁剪或播放观察者订阅隔离；队列 / 聊天的既有 onState 调用仍可触发播放服务。服务端 WS 入站异常、去重 / 资源预算、分块发送与限频关联 ID 等也未因 UI 落地关闭。ack 丢失且广播先到时，协议广播没有 clientMessageId，未知对应关系的本地气泡仍可能暂时与正式消息并存，须原 ID 重试得到 ack 后收敛；这不是完整协议缺陷修复结论。

## 可替换边界与假传输层回归（2026-09-21 实现）
- 存储（ConnectionStore）、诊断（Diagnostics 接口）、单调时钟、HTTP（HttpTransport）、WebSocket（WebSocket.Factory）、协程调度器均为构造注入；生产统一由 RoomClient.create 装配 OkHttp/SharedPreferences/Main.immediate，JVM 单测注入假实现，不访问公网。
- RoomClientSessionTest 十三场景全过（2026-09-22 新增 6 项）：入房→校时→Ready、旧 Socket 迟到快照/断线回调被丢弃、退出 DELETE 带旧地址旧令牌、重连退避后重开且退出不再重连、401→Expired→重新加入、校时 15 秒超时主动断开、周期校时不覆盖本机暂停提示；新增：旧版本快照被忽略（同版本仍应用）、会话活跃期重复 join 被忽略、retry 仅在 Reconnecting 生效且立即重连、重连退避 1/2/4 秒指数递增、关闭帧 1000→Expired 而异常码→Reconnecting、断线重连后必须重新校时才回 Ready。
- 已知差异：测试调度器把嵌套 launch（如 join 内部 leave 的 DELETE）排入事件循环，在 join 协程结束后执行；生产 Main.immediate 会立即发起。两者都满足“新会话不等待旧退出响应”。

## 资源回收与不变量
退出顺序：标记旧代次无效 → 取消任务/停止跟听 → 关闭 Socket → 用旧上下文尽力发送 DELETE。
DELETE 失败不阻止本地退出，服务器通过离线清理收回成员。
日志不输出 token、Authorization、完整请求头；连接时间和错误码可以记录。

## 验收场景
模拟迟到 Join/DELETE、旧 Socket close、重连同时退出、A服务器退出后立即加入B。
确认旧请求不能改变新房间；无并行重连泄漏；401/404 能重新加入；弱网恢复采用最新状态。
物理断网到检测存在心跳窗口，测试记录实际检测耗时，不能将服务端60秒宽限从拔线时刻计算。

## 核心注释与记录
SessionContext 所有权、generation 比较、回调线程、request取消、leave清理顺序均写 KDoc。
2026-09-21：不可变上下文、明确状态机与假传输层竞态回归均已实现；换服务器的本地代理集成测试与真机复测仍待执行。
2026-09-24：join 地址唯一入口增加约定端口归一——无端口 URL 补 3000（口令分享可省略 :3000）、显式非默认端口保留；新增 explicitNonDefaultPortPreserved 回归。
2026-09-30（QC-B2）：v2 会话——join 前先 `GET /api/capabilities` 能力探测（404 = 旧服务端 → Incompatible 终态；网络错误保持可重试），业务请求与 WS 握手统一带 `X-ListenTogether-Protocol: 2`（426 → Incompatible 兼容终态，不重连）；不再整库拉取 catalog，待播队列随 WS `queue.state` 下发（旧版本快照不回写），曲库检索走 `/catalog/search` 按页请求（409 CATALOG_CHANGED 清页重查）。队列操作统一 requestId + issuedAtMs，5 秒确认超时提示不自动重放。状态机新增 `Incompatible`。`RoomClientSessionTest` 补探测 404 / WS 426 / 队列操作与 ack / 快照原子性 4 项。
2026-09-26：过期→重新加入链路真机闭环（PHQ110 / 云端旧后端）：成员与房主两种会话断网 >60s 被服务端清扫后，客户端先「连接断开，正在重试」、重连拿 401 转「房间或成员已失效」横幅；「重新加入房间」换发新令牌重入成功，24 字符昵称原样。空房回收后旧码加入报「房间不存在或已过期」且表单内容保留。断网手段：`svc data disable`（仅断蜂窝数据，不影响热点）；飞行模式因连带关热点已弃用。见 [2026-09-26 设备复测](../test-results/2026-09-26-device-retest/README.md)。

2026-10-01：原生 UI 最小接线新增聊天原文 / 原身份重试、单调期限、真实 messageId 对账、初始空快照基线与队列局部处理态；协议、同步与存量 v2 独立验收边界保留，见上节及本轮验收记录。
