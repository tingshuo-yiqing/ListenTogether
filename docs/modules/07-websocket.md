# 07 WebSocket 实时通信

## 职责
realtime/socket.ts 负责握手鉴权、握手限连、消息解析、发送、心跳和传输关闭。
realtime/limits.ts 提供单进程固定窗口计数器（内存 Map，无新依赖），当前用于握手限连。
Rooms持有业务状态；传输层不能绕过command权限直接写room字段。

## 当前输入输出
握手GET /ws/:code，Authorization Bearer鉴权成功后关联成员连接。
握手限连：同一"成员令牌 + 来源 IP"10 秒内最多 5 次，超出抛 Fault(429) 拒绝升级；
计数在鉴权之后，无效令牌仍先 401 且不占额度。阈值 5 高于客户端 1/2/4/8/16 秒退避（任一 10 秒窗口最多 4 次）。
客户端侧已核对（RoomClient.onFailure：`response?.code == 401 || 404` 才判终态）：429 属非终态 → 进 Reconnecting 退避重试，
不会被误判成 Expired；仅"手动连点重试"（reset 退避后立即重连）可能在 10 秒内快速消耗额度，被拒后仍回到退避。
客户端发送sync或command；服务器发送clock、state或error。格式见 [协议](../protocol.md)。
sync回显客户端发送时间并返回服务端时间，随后发送完整快照。
连接建立先广播完整state；成员变化与房主指令均广播。
消息最大4096字节；每连接每秒20条；发送缓冲超过128KiB以1013关闭慢客户端。
每15秒ping，上轮未pong则terminate。close负责清理心跳和成员离线标记。
传输层维护 wsConnections 计数，供 /health 读取。

## 下一阶段
使用显式消息schema验证JSON对象、type、action及数值；拒绝null、数组、超长字段、非有限数值。
超时/慢客户端/正常退出/替换连接分别记录原因，前端据此决定是否重试，不记录成员令牌
（当前已记录 ws.handshake_rejected 与领域侧成员 online/offline；关闭原因细分待做）。
连接替换后所有旧回调只影响旧连接；对握手鉴权与正式关联之间成员过期的边界返回可解释错误。
发送失败隔离到该客户端；心跳timer与socket同生共死。
保留完整快照，不增加增量补丁协议，不引入多实例广播。

## 状态语义
关闭检测时间才是离线宽限起点，不能按网络物理断开的时间预先断言转移。
clientTimeMs属于客户端单调时钟，服务器仅回显；不可用它决定房间当前时间或授权。
state.version单调递增但sync返回可以同版本，客户端必须容忍重复快照。
客户端恢复时请求当前快照，不重放离线期间指令。

## 验收
createSender/startHeartbeat 的 socket 与 timer 面可注入，慢客户端 close(1013) 与"两轮无 pong 才 terminate"用假 timer 单测，
不真等 15 秒、不真塞满对端读缓冲；握手限连用真实 ws 连接验证（含换源 IP 不受影响、无效令牌仍 401）。
消息契约由 [protocol.md](../protocol.md) 的 JSON Schema 与 `server/test/protocol.test.ts` 共同保证：schema 从文档提取，
`additionalProperties:false` 使实现新增字段而文档漏改也会失败（无 codegen、无运行时依赖）。
测试错误JSON/null/数组/未知type、超大包、速率边界、非法令牌、无pong、慢消费者和替换连接。
15个真实WS连接验证广播和第16个入房被拒绝；音频并发由独立测试覆盖。
服务停止主动关闭连接，客户端明确断线；日志中搜索不到token或Authorization值。

## 核心注释与记录
鉴权到connect的顺序、心跳为什么分两轮、发送缓冲阈值、socket身份比较和异常隔离写TSDoc/分支注释。
2026-09-21：传输基础已实现；强化校验与故障回归为计划。
2026-09-24：新增握手限连（token+IP，5 次/10 秒，429 拒绝升级）与传输层连接计数；发送/心跳抽成可注入函数以便回归。
