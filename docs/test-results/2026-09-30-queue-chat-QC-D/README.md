# 点歌队列/聊天扩展 · QC-D 证据（2026-09-30）

## 任务与环境
- 任务号：QC-D（封面按需读取与总容量缓存、解析限并发、隔离规模夹具、15 人混合与慢客户端脚本）。
- 基线：接续 QC-C（聊天已交付）；真实 media/ 未动，全部测量在 `.workbuddy/` 合成夹具上；云端在产 release 未动。
- 环境（bench env 行实录）：Windows_NT 10.0.26200 x64 / Node v24.21.0 / Intel(R) Core(TM) Ultra 5 125H（18 核）/ 31.4GB 内存。

## 实际命令与退出码
| 命令 | 结果 |
|---|---|
| `cd server && npm run build` | 退出码 0 |
| `cd server && npm test` | 退出码 0，**tests 56 / pass 56 / fail 0** |
| `node scripts/qcd-fixture.mjs --tracks 1000` / `--tracks 2000` | 退出码 0（120MB / 239MB，纯合成媒体） |
| `node scripts/qcd-bench.mjs --media .workbuddy/qcd-fixture-1000` | 退出码 0，5 项断言全过 |
| `node scripts/qcd-bench.mjs --media .workbuddy/qcd-fixture-2000` | 退出码 0，5 项断言全过 |
| `node scripts/qcd-mixed-load.mjs --duration 600 --members 15` | 退出码 0（断言全过） |
| `node scripts/qcd-slow-client.mjs` | 退出码 0（两场景断言全过） |

## 服务端交付（规模资源边界）
- **封面按需读取 + 32MiB 全服 LRU**（`library/cover-cache.ts` 新增）：`Track.cover` 由内存字节改引用 `{mime,file,embedded}`；启动只算版本哈希、字节即弃；运行期读盘/内嵌 APIC 重解析经 LRU（按字节计费、触碰刷新热度、键=id+coverVer）。默认 `COVER_CACHE_LIMIT_BYTES=32MiB`，测试可注入更小上限。
- **解析限并发**（`library/pool.ts` 新增）：`loadCatalog` 全流程（music-metadata + 封面/歌词读取）默认 `PARSE_CONCURRENCY=4`，`stats` 参数上报峰值并发；封面 IO 共用 `COVER_IO_CONCURRENCY=4` 且同资源在途合并。
- **发送背压硬限**（socket.ts）：应用层待发每连接 ≤512KiB / 全服 ≤64MiB（send 前计入、回调回落），超限 1013 只关本连接；保留原 128KiB bufferedAmount 保护。
- **快照合并**：queue.sync/chat.sync 在途重复请求合并为一次最新快照（缺口取最后一次 lastSeq）；聊天快照取同一时刻副本。
- **O(1) 路由**：audio/lyrics/cover 改 `rooms.byId.get`；**/health 追加 eventLoop {p50Ms,p99Ms,maxMs}**（累计口径）。

## 规模基准（合成夹具，进程内口径 = loadCatalog + buildApp 不监听）
| 指标 | 1000 首 | 2000 首 | 门槛 |
|---|---|---|---|
| loadCatalog 耗时 | 823ms | 1533ms | 记录值 |
| 启动总耗时（含 buildApp） | 924ms | 1639ms | 记录值 |
| 峰值 RSS | 81MB | **89MB** | 1000→2000 仅 +8MB（封面不常驻生效） |
| 解析峰值并发 | 4（cap 4） | 4（cap 4） | ≤4 ✅ |
| 搜索 p95 / p99 / max（1000 次，错误率 0） | 0.042 / 0.064 / 0.166ms | 0.048 / 0.062 / 0.136ms | **p95 ≤100ms ✅** |
| 封面缓存峰值 → 稳定值 | 32.5MB → 31.5MB | 32.5MB → 31.5MB | ≤32MiB ✅（LRU 与曲库规模无关） |
| 首屏分页 | limit>50 拒绝 | 同 | 1000→2000 首屏请求页数不变 ✅ |

夹具构成（每 10 首）：1 近 1MiB 独立 PNG + 2 小独立 PNG + 2 内嵌 APIC + 5 无封面；80% 带 LRC（含每 100 首一首近 256KB 大词）。合成 MP3 = 40 帧 CBR 128kbps（≈16.7KB/首，时长 ≈1.04s）。

## 15 人混合负载（600 秒，1 房主 + 14 成员，1000 首夹具）
- **断言全过**：429 = **0**（配额内合法请求零误限）、意外错误 = 0、确认超时 = 0、断线重连 = 0、聊天 seq 跳变/回退 = 0（3214 条消息 seq 连续）。
- 校时 RTT（8909 样本）：p50 0.9ms / p95 3.4ms / p99 6.5ms。
- 命令确认（房主 play/pause/seek，以跟随 state 广播计）：p50 1.1ms / p95 7.3ms（138 样本）。
- 队列操作 ack：p50 4.8ms / p95 8.4ms（2418 次）；聊天 ack：p50 2.1ms / p95 4.8ms（3214 条）。
- eventLoop（/health 每 10s 采样，**累计口径含启动哈希阶段**）：p99 峰值 39.977ms、绝对峰值 101.319ms；稳态值更低。
- 流量构成：校时 1/s·人、聊天 ≈1/2.6s·人、队列点歌/撤回 ≈1/2.8s·人、房主播放命令 1/5s + skip-next 1/30s——全部压在分类配额内（聊天 5/10s、队列 5/10s、sync 2/s、命令 10/s）。

## 慢客户端（scripts/qcd-slow-client.mjs）
- **刷屏不误踢**：单成员 20 条/秒 × 20 秒（380 发，超聊天配额 5/10s、低于 100/s 硬保护）→ **375 次 429**（均带 retryAfterMs）、连接保持（未被 1008/1013 关闭）、停手后 queue.sync 立即恢复；两名旁观成员全程 0 次 429、正常收到广播与 ack。
  - 边界对照（最小复现）：400 条**同秒突发**会触发输入硬保护 1008 关闭——设计预期（连接级滥用边界），与分档限频分开。
- **满 100 条长消息慢网恢复**：10 名成员按配额灌 100 条 ×500 码点中文（每人 5 条/11.5s）；新成员经 fault-proxy（300ms 双向延迟）入房，收到 **6 个 ≤32KiB 分块**快照并完整重组 100 条；断开重连后再次重组，100 条 messageId 逐条一致，连接保持不误踢。

## 过程抓到的问题（已修）
- **/health eventLoop 单位错误**（自抓）：直方图为纳秒，首版只除 1e3 导致读数虚高 1000 倍——混合负载冒烟当场暴露，修正为 ÷1e6 并复核量级（p99 从虚假的 39 秒回到 40ms 量级）。
- Node 24 的 `monitorEventLoopDelay` 直方图**没有 unref/ref**（旧文档口径），测试进程会被挂住——改随 `app.onClose` 调 `disable()` 释放。
- 脚本侧：`clientTimeMs` 必须是数字（首版发 UUID 被 400）；聊天节奏含向下抖动会越过 5/10s 滑动窗口（改 ±10% 并按最坏间隔校验）；500 码点长消息再拼任何标签都会被 400 拒（恰好压线是契约行为）；WS 原始 message 事件是 Buffer，断言监听器必须先 JSON.parse。

## 结论
QC-D 服务端规模改造与脚本全部本地完成，规模门槛（p95 ≤100ms、缓存 ≤32MiB、解析 ≤4 路、混合负载零误限/seq 连续、慢客户端不误踢）实测达标并留档；**未做任何设备侧帧表现测量（R8 包需真机，当前无设备），不宣称 Android 帧达标**。未提交 Git、未动云端。

## 未覆盖项（待后续）
- Android R8 benchmark 变体的帧表现（千首点歌页滚动等）需真机，挂起；设备不可用时不能用 debug 包替代。
- 云端真实曲库扩容到千首前的发布/回滚演练（属部署手册范围，待用户授权）。
- 15 成员混合负载的双真机声音门槛继续单独挂起（M2 95% 口径不变）。
