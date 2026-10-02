# 点歌队列/聊天扩展 · QC-C 证据（2026-09-30）

## 任务与环境
- 任务号：QC-C（纯文本聊天、ack 与 pending、重连快照/缺口、独立限流、未读与草稿；chat 能力标志翻 true）。
- 基线：接续 QC-B1+B2（点歌闭环已交付）；曲库 45 首；云端在产 release `20260928-1815` 未动。
- 环境：Windows / Node 24 / JDK 17 / Gradle 8.11.1；测试全部离线（不访问公网）。

## 实际命令与退出码
| 命令 | 结果 |
|---|---|
| `cd server && npm run build` | 退出码 0 |
| `cd server && npm test` | 退出码 0，**tests 52 / pass 52 / fail 0**（duration ≈1.4s） |
| `cd android && .\gradlew.bat :app:cleanTestDebugUnitTest :app:testDebugUnitTest` | 退出码 0，**130 项单测全绿（19 套件，fail=0 err=0）** |
| `cd android && .\gradlew.bat :app:lintDebug :app:assembleDebug` | 退出码 0 |

## 服务端交付
- **领域**（`server/src/rooms/store.ts`）：`chatSend`——空白拒绝、≤500 Unicode 码点、UTF-8 ≤2048 字节；服务端生成 messageId/seq/createdAtMs，sender 取认证成员（客户端不可伪造）；每房 100 条环形窗口（超出从最旧侧截断）。`chatSnapshot`——返回保留窗口全集 + latestSeq/oldestSeq；gap = lastSeq < oldestSeq-1（中间消息已滑出窗口，提示不可恢复）；空历史 oldestSeq=null。
- **路由**（`server/src/realtime/socket.ts`）：`chat.send` 走 deduped 包裹——`clientMessageId` 关联确认与业务结果、配额 5/10s 在 run() 内检查（重放回放已缓存确认、不重复消耗配额；QuotaFault 直接外抛不占去重结果槽位）；`chat.sync` 2/s，始终回当前保留窗口快照；入房/重连握手即推队列快照 + 聊天分块快照。
- **分块**：`sendLarge` 按实际 JSON UTF-8 字节切 ≤32KiB 逻辑完整快照（同一 snapshotId/chunkIndex/chunkCount/latestSeq），100 条长中文/emoji 消息不塞单帧。
- **能力**：`GET /api/capabilities` features.chat = true。
- **协议**：protocol.md v2 增补即时聊天节（发送/确认/恢复/去重/独立限频）与 chatSend/chatSync/chatMessage/chatSnapshot 4 类消息 schema（累计 17 类），ack 扩展 clientMessageId 关联；`protocol.test.ts` 契约测试覆盖真实输入输出。

## 安卓交付
- **UI**（`ui/RoomScreen.kt`）：三页互斥「队列 / 点歌 / 聊天」——聊天页未读徽标只计他人新消息且仅在非聊天页累计、进入聊天页清零、首屏历史不计未读；48dp 触控目标 + stateDescription 选中语义；草稿绑定会话，退房清除。
- **发送与确认**（`network/RoomClient.kt`）：发送即显 pending 气泡（不可仅凭颜色区分）；ack 按 clientMessageId 对齐解除；5 秒确认超时解除气泡并提示重试，不自动重发（草稿保留）；chat.message 按 messageId/seq 去重，确认与广播乱序到达安全。
- **恢复**：分块快照组装（按 snapshotId 收齐 chunkCount 块后原子替换；旧 snapshotId 拒绝、不回写）；`chatSync()` 携带 lastSeq（>0 时）供服务端缺口判定；缺块等待剩余块、持续失败由下一次 chat.sync 恢复；leave/换房清 chatChunks 与 chatSnapshotId，generation 隔离旧会话迟到消息。

## 测试
- `server/test/chat.test.ts`（3 项）：①聊天域校验/超长截断拒绝/窗口 100 条与 seq 缺口；②WS 跨房广播隔离 + 伪造发送者无效 + 独立限频 429 + 同 clientMessageId 重试回放（复用原 issuedAtMs）；③>32KiB 快照分块——100 条长消息重组完整、snapshotId 一致、第二窗口 chat.sync。
- 安卓 `RoomClientSessionTest`（21 项，聊天新增 3）：聊天消息追加去重与快照原子替换 / 发送 pending 与 ack 解除 / chatSync 携带 lastSeq。
- 过程修正（测试揭出）：重试必须复用原 issuedAtMs（换新时间戳会被判 IDEMPOTENCY_CONFLICT）；夹具长文本按码点数控制重复次数（UTF-8 中文 3 字节/字）；分块断言按 snapshotId 分组等待完整重组，不逐帧断言。

## 制品
- APK：`android/app/build/outputs/apk/debug/app-debug.apk`
- SHA256：`b2d7876aebe7017f89a7b55eb1de3fe300f07e0befb2c4200e7a7216255532cc`（debug 包，仅本机联调；QC-E 重建后以最终登记为准）

## 结论
即时聊天（服务端 + 安卓）本地开发完成，全部本地门禁通过；协议/模块文档同步。**未宣称任何设备或云端验收**。

## 未覆盖项（待后续）
- 真机聊天页目视（当前无设备连接）：气泡样式、键盘 inset 与输入法弹出时输入框可见性、翻历史不抢滚动、长中文/emoji/多行草稿排版。
- 双真机聊天同屏、2 倍系统字号、小屏布局。
- 15 人并行聊天与点歌的规模口径归 QC-D。
- QC-D（规模与性能）、QC-E（汇总）未开始。
