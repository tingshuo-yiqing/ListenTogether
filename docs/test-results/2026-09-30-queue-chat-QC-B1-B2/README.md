# 点歌队列/聊天扩展 · QC-B1 + QC-B2 证据（2026-09-30）

## 任务与环境
- 任务号：QC-A（前轮已完成：CatalogIndex + /catalog/search）、QC-B1（v2 契约 + 服务端队列闭环）、QC-B2（安卓 v2 会话与队列/点歌 UI）。
- 基线：工作树在本轮开始时为 HEAD `495d335` + 上一轮 QC-0/QC-A 改动；曲库 45 首；云端在产 release `20260928-1815` 未动。
- 环境：Windows 10 / Node 24 / JDK 17 / Gradle 8.11.1；全部测试离线（不访问公网）。

## 实际命令与退出码
| 命令 | 结果 |
|---|---|
| `cd server && npm run build` | 退出码 0 |
| `cd server && npm test` | 退出码 0，**tests 49 / pass 49 / fail 0** |
| `cd android && .\gradlew.bat :app:cleanTestDebugUnitTest :app:testDebugUnitTest :app:lintDebug` | 退出码 0，**127 项单测全绿**（含 4 项新增 v2 用例） |
| `cd android && .\gradlew.bat :app:assembleDebug` | 退出码 0 |

## QC-B1 交付（服务端）
- **契约先行**：`docs/protocol.md` 重写为 v2——能力协商（GET /api/capabilities：{protocol:2,features:{queue,catalogSearch,chat:false},serverNowMs}）、▲ 业务端点要求 `X-ListenTogether-Protocol: 2`（缺失 426）、兼容矩阵、队列规则表、操作去重（10 分钟有效期/IDEMPOTENCY_CONFLICT/REQUEST_EXPIRED/DEDUP_CAPACITY/不提前淘汰）、分类限流（command 10/s、queue 5/10s、sync 类各 2/s、硬保护 100/s→1008）、13 类消息 JSON Schema（由 `protocol.test.ts` 从文档提取校验真实消息）。
- **领域队列**（`server/src/rooms/store.ts` v2 重写）：建房无预选、首曲入队提升当前曲并暂停、queueAdd/queueAddRandom（全库不放回抽样、按最终待播占用折算、addedCount）/queueRemove/queueMove（entryId+beforeEntryId+expectedQueueVersion，锚点不存在 404、移到自己=无操作）/skipNext（保留原 playing）；tick 按队列消费队头，耗尽清空停止；select 移除、无当前曲播放/跳过 409 NO_CURRENT_TRACK；点歌人离房保留点歌、房主变化不清队列；queueVersion 独立于播放 version。
- **去重**（`server/src/rooms/dedupe.ts`）：房间+成员+ID 键、指纹含 type/时间/输入、业务失败同样入缓存、不倒退时基（时间回拨不复活过期请求）、房间销毁释放计数。
- **限流**（`server/src/realtime/quotas.ts`）：滑动窗口、按成员键（重连不清）、样本数上限防堆积。
- **WS 路由**（`server/src/realtime/socket.ts`）：新消息路由 + 每消息重鉴权 + ack 包裹（move 失败补发最新队列）+ 429 带 retryAfterMs + 硬保护 1008。
- **app.ts**：capabilities 端点 + ▲ 端点 426 门禁（校验先于建房）。

### B1 验收用例（server/test/queue.test.ts，10 项）
并发点歌同曲 / 随机部分成功与候选耗尽 / 个人配额与房主豁免与降级 / 队列 100 容量 / 去重（过期/异参/超前/回拨/业务失败缓存）/ 权限与重排冲突 / 曲终与跳过 / 房主变化与离房 / 快照一致性与迟到隔离 / WS 层 requestId 重试回放 + 队列限流 + 握手 426。既有回归：app/rooms/realtime/cover/lyrics/protocol/catalog 全绿（服务端 v2 切换后按新口径改写）。

## QC-B2 交付（安卓）
- **Models.kt**：RoomState.trackId → `track: Track?`（v2 state）；新增 QueueEntry/QueueState/CatalogPage；ConnectionStatus 新增 `Incompatible`；UiState.tracks → queue。
- **RoomClient.kt**：能力探测（`CapabilityProbe` 注入，404→Incompatible、非 200 可重试）；HTTP 传输与 WS 握手带协议头（426→Incompatible 终态，不重连）；不再整库拉取 catalog；`queue.state` 原子替换（旧版本不回写）；ack 解除待确认；队列操作统一 requestId+issuedAtMs（serverNow），5 秒确认超时提示不自动重放；`searchCatalog` 按页请求、409 CatalogChangedException 清页重查；leave 清 pendingOps。
- **PlaybackService**：当前曲来自 state.track；空曲目 → pause+clearMediaItems+复位倍速（通知栏不留旧曲标题与可用切歌钮，连接与队列保留）；通知栏下一首 = skip-next、上一首 = 回到开头（仅房主）；同 trackId 新 entryId 按新播放建立（mediaId=trackId 不变，URL 同）。
- **UI**：RoomScreen 重写为「队列/点歌」双页互斥（48dp 触控、stateDescription 选中语义）；队列页含撤回/上移/下移（锚点+expectedQueueVersion）；点歌页防抖 300ms 检索 + 加入 + 随机 1/5 + 已在队列禁用 + 加载更多带 revision。`sync/TrackQueue.kt` 及其测试删除（全库顺播逻辑退出生产路径）。
- **单测**：RoomClientSessionTest 4 项新增（探测 404 / WS 426 / queue.add 与 ack / 队列快照原子性），v1 竞态回归全绿；ScreenStateTest/PlaybackViewTest 按新模型更新。

## 制品
- APK：`android/app/build/outputs/apk/debug/app-debug.apk`
- SHA256：`86dd4b9152ed5cb9f907daa3ca841a55f701eeb8f3d57fd5fec5b1f1b286c556`（debug 包，仅本机联调）
- benchmark/R8 变体未构建（D 阶段口径）。

## 结论
点歌队列闭环（服务端 + 安卓）本地开发完成，全部本地门禁通过；协议/模块文档同步。**未宣称任何设备或云端验收**。

## 未覆盖项（待后续）
- 设备验收（当前无设备连接；双真机项继续挂起）：入房队列展示、点歌/撤回/排序手感、通知栏下一首走 skip-next、空队列清媒体（通知栏状态）、后台播放/歌词回归、2 倍字号/小屏/emoji 昵称目视。
- 新旧组合兼容矩阵需旧 APK 复测 426 展示（设计要求用旧包实测）。
- QC-C（聊天）、QC-D（规模与性能）、QC-E（汇总）未开始；chat 能力标志当前为 false。

## 清理
无临时文件残留；`android/patch-test.py` 补丁脚本已删除。
