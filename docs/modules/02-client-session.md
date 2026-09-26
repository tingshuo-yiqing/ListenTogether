# 02 Android 网络与会话

## 职责和接口
RoomClient.kt 负责 HTTP 入房/曲库/退出，WS 连接和重连，以及 UI 状态发布。
入口为 join、command、setPlaying、pauseLocally、leave；UI 和 Service 不直接持有 OkHttp WebSocket。
Credentials 保存 code/memberId/token；RoomState 是服务器快照。协议详见 [v1 协议](../protocol.md)。

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
2026-09-26：过期→重新加入链路真机闭环（PHQ110 / 云端旧后端）：成员与房主两种会话断网 >60s 被服务端清扫后，客户端先「连接断开，正在重试」、重连拿 401 转「房间或成员已失效」横幅；「重新加入房间」换发新令牌重入成功，24 字符昵称原样。空房回收后旧码加入报「房间不存在或已过期」且表单内容保留。断网手段：`svc data disable`（仅断蜂窝数据，不影响热点）；飞行模式因连带关热点已弃用。见 [2026-09-26 设备复测](../test-results/2026-09-26-device-retest/README.md)。
