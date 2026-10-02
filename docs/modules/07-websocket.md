# 07 WebSocket 实时通信

2026-10-01 最新修复与设备边界见 [修复报告](../test-results/2026-10-01-queue-chat-fixes/README.md)及 [verification](../verification.md)：server 63/63、安卓 173、脚本 51/51、Lint 0；ACC 代码/自动化通过，完整设备矩阵与发布仍待验。当前 APK ABCB8582… 已覆盖安装 PHQ110；历史报告保持原失败与对应版本。

入站协议由 server/scripts/protocol-schema.mjs 在 dev/build/test 前从 protocol.md 生成 TS；运行时 Ajv 初始化编译一次，仅校验客户端消息分支，unknown 安全格式化错误。命令/队列/聊天统一去重与确认；限频不消耗结果槽位，chat 429 带原 clientMessageId。outbox 对 queue/chat 快照按完整封装 UTF-8 限 32KiB 分块，一帧在途，回调/drain 继续；未开始同类快照合并，已开始完整发送；每连接待发 512KiB/全服 64MiB，关闭/错误回收且迟到回调不重复计费。

## 职责
realtime/socket.ts 负责握手鉴权、握手限连、消息解析、发送、心跳和传输关闭。
realtime/limits.ts 提供单进程固定窗口计数器（内存 Map，无新依赖），当前用于握手限连。
Rooms持有业务状态；传输层不能绕过command权限直接写room字段。

## 当前输入输出
握手GET /ws/:code，Authorization Bearer鉴权 + `X-ListenTogether-Protocol: 2`（缺失 426，2026-09-30 QC-B1）成功后关联成员连接。
握手限连：同一"成员令牌 + 来源 IP"10 秒内最多 5 次，超出抛 Fault(429) 拒绝升级；
计数在鉴权之后，无效令牌仍先 401 且不占额度。阈值 5 高于客户端 1/2/4/8/16 秒退避（任一 10 秒窗口最多 4 次）。
429 属非终态 → 客户端进 Reconnecting 退避重试，不会被误判成 Expired。
客户端发送 sync / command / queue.add / queue.addRandom / queue.remove / queue.move / skip-next / queue.sync；
服务器发送 clock、state、queue.state、ack 或 error。格式见 [协议](../protocol.md)。
sync回显客户端发送时间并返回服务端时间，随后发送完整快照与队列快照。
连接建立先广播完整state，再向该成员发送 queue.state（加入/重连恢复队列）。
每条消息重新鉴权：离房/被移除成员的残留连接立即失效，不能继续操作队列。
消息最大4096字节；分类配额（滑动窗口、按成员、重连不清，realtime/quotas.ts）：command+skip-next 10/s、
queue 操作 5/10s、聊天 5/10s，sync/queue.sync/chat.sync 各 2/s；429 带 retryAfterMs 与已验证的关联 ID；
每连接全部输入消息 100/s 硬保护，超出以 1008 关闭（连接级滥用边界，与业务限流分开，重连即清）。
发送时 socket 已缓冲超过128KiB以1013关闭；若加下一帧将越过阈值，先等待完成回调/drain，正常分块不因瞬时排队误踢。每15秒ping，上轮未pong则terminate。close负责清理心跳和成员离线标记。
传输层维护 wsConnections 计数，供 /health 读取。

## 去重与确认（QC-B1，2026-09-30）
有副作用操作（command、queue.add/addRandom/remove/move、skip-next、chat.send）统一带 requestId + issuedAtMs；去重键=房间+成员+ID，指纹含 type/时间/规范化输入。
同 ID 重试回放原 ack（确定性业务失败同样入缓存，不重新执行）；同 ID 异参 409 IDEMPOTENCY_CONFLICT；
过期 409 REQUEST_EXPIRED；容量满 429 DEDUP_CAPACITY（无副作用，未过期记录不提前淘汰）。
实现见 rooms/dedupe.ts：不倒退时基（服务端时间回拨不复活过期请求），与播放校时公式分开；
ack 携带 expiresAtMs=issuedAtMs+10分钟；queue.move 失败时补发最新 queue.state。

## 下一阶段
显式入站 schema 已实现；保留真实 WS null/数组/非法 UUID/额外字段及无业务副作用的回归，未来协议演进同步文档与运行时生成结果。
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
`additionalProperties:false` 使实现新增字段而文档漏改也会失败；测试最小校验器与运行时 Ajv 独立，生成 schema 与文档提取结果做一致性比较。
测试错误JSON/null/数组/未知type、超大包、速率边界、非法令牌、无pong、慢消费者和替换连接。
15个真实WS连接验证广播和第16个入房被拒绝；音频并发由独立测试覆盖。
服务停止主动关闭连接，客户端明确断线；日志中搜索不到token或Authorization值。

## 核心注释与记录
鉴权到connect的顺序、心跳为什么分两轮、发送缓冲阈值、socket身份比较和异常隔离写TSDoc/分支注释。
2026-09-21：传输基础已实现；强化校验与故障回归为计划。
2026-09-24：新增握手限连（token+IP，5 次/10 秒，429 拒绝升级）与传输层连接计数；发送/心跳抽成可注入函数以便回归。
2026-09-30（QC-B1）：v2 队列消息路由 + 去重包裹 + 分类限流（quotas.ts 滑动窗口）+ 100/s 硬保护（替换旧 20/s 全局限频）+ 握手协议头 426；
领域操作在 rooms/store.ts（queueAdd/queueAddRandom/queueRemove/queueMove/skipNext），传输层只做鉴权/限流/去重/确认，不写房间字段。
2026-09-30（QC-D）：应用层待发硬限（每连接 512KiB/全服 64MiB，send 前计入本帧字节、回调完成后回落，超限 1013 只关本连接）+ 同类快照合并（queue.sync/chat.sync 在途重复请求合并为一次最新快照，缺口取最后一次 lastSeq）+ 聊天快照取同一时刻副本；createSender 支持全服待发共享记账。
