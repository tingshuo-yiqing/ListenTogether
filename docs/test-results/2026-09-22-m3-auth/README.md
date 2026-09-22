# M3-AUTH 音频 401 注入记录（2026-09-22）

任务编号：M3-AUTH。操作者：AI 辅助自动化（无手机自测）+ 真机注入（PHQ110）。
结论：**注入工具与真机 401 路径通过**；横幅提示持久性缺陷已修复，修复后的真机复验因设备断开挂起（见边界）。

## 1. 注入工具（fault-proxy.mjs 扩展，无手机自测通过）

新增管理路径：
- `GET /__fault/audio401?seconds=N`：窗口内仅音频路由（`/api/rooms/:code/audio/:id`）返回 401，响应体与后端 `Fault(401)` 一致（`{"message":"成员令牌无效，请重新加入"}`）；HTTP/WS 其余路径保持透传；到期自动恢复，`/__fault/clear` 立即清除。
- `/__fault/status` 增加 audio401 字段与计数。

自测（scripts/fault-proxy-selftest.mjs，10 项全过，原始输出见本目录 `fault-proxy-selftest.txt`）：
透传、延迟、WS 建立与断线窗口（原有 A–D）之外新增：
- E0 注入前音频 Range 读取 206；
- E1 窗口内音频请求 401 且响应体一致；
- E2 注入窗口内 /health、新建房间、既有房间 WS 均不受影响（仅音频路由被注入）；
- F `seconds=2` 到期自动恢复透传；
- G 重新注入后 `clear` 立即恢复。

## 2. 真机 401 路径（通过）

环境：PHQ110（fbddbe8）USB reverse → 127.0.0.1:3001（故障代理）→ 127.0.0.1:3000 演示后端。
被测 APK：`8CF98CE13507090BC45746B8E1F766CB87839B8B1EE57728E91096F15795BACA`（含 localPause 边沿诊断）。
曲目：demo-load（11 分钟 192kbps，本轮新增到 demo 曲库）。

| 步骤 | 动作 | 结果 |
|---|---|---|
| 入房播放 | 经代理建房 CC84F634，选 demo-load 播放 | PLAYING(3)，position 627，buffered≈87s |
| 开启注入 | `__fault/audio401?seconds=90` | proxy 记录 until 时间戳 |
| seek 未缓冲区 | 进度条拖至 ≈10:56 | 代理命中 4 次 401（21.59s/21.61s/22.65s/24.70s，间隔递增），**之后 6 秒以上零请求** |
| 播放器状态 | dumpsys media_session | `ERROR(7) "Source error"`，speed=0，位置冻结 656863，无自动恢复 |
| 设备诊断 | JSONL | `localPause:true, correction:"error:ERROR_CODE_IO_BAD_HTTP_STATUS", version=5`；connection 事件仅 play/seek，**无 pause 命令，房间版本不变** |
| 恢复 | 注入清除后明确点击播放 | （此步在代理窗口过期后验证）恢复读取，播放续接房间进度 |

结论：
- 音频请求失败（401）与会话身份失效（WS/房间层面）相互独立：401 只触发本机暂停，房间继续，其他人不受影响。
- 无无限重试：ExoPlayer 对 HTTP 错误仅短暂重试（本例 4 次 / 3 秒内）即进入 ERROR 并停止请求。
- 提示文案由 `PlaybackFailure.message(401)` = “登录已失效，请退出房间后重新加入” 决定（单测覆盖）；真机横幅瞬时可见，但被下述缺陷覆盖后消失。

## 3. 发现并修复的缺陷：本机暂停提示被周期校时覆盖

- 现象：401 后横幅提示在约 5 秒内变成“已同步”，可操作的错误文案留不住。
- 根因：RoomClient 每次 clock 样本被接受都把 `message` 重写为“已同步”（RoomClient.kt:193），覆盖 pauseLocally 写入的提示。
- 修复：周期校时在 `locallyPaused` 时保留原 message；恢复播放由 setPlaying 重写“已同步”。
- 回归测试：`RoomClientSessionTest.clockSyncKeepsLocalPauseMessage`（校时成功 + locallyPaused → message 不变）；单元测试增至 **26 项**，构建 BUILD SUCCESSFUL，Lint 0 问题。
- 修复后 APK：`832FB65EA4B606EB1C3EBFCE0EEAA887C585097D30219C1B11ED3884F907D09B`。**该修复尚未在真机复验**（设备断开），待办：重装 APK 后重复第 2 节步骤，确认横幅在暂停期间持续显示 401 文案、明确播放后恢复“已同步”。

## 4. 边界

- “真实身份失效”（服务端令牌作废）未测：模拟音频 401 不等于撤销令牌；后端无作废入口，且不为测试新增公网接口。重启后端得到的是房间 404 → Expired，属 M1 已验证路径。
- 401 注入期间 WS/HTTP 其余路径可用性由自测 E2 覆盖，真机未单独采样。
- 设备在复验前 USB 断开：修复版 APK 的横幅持久性、以及 401 后“注入清除→明确播放→续播”的完整回归在真机上未重跑。

## 5. 清理

- 故障代理进程已停止，注入规则随进程消失；未修改后端；未新增公网测试入口。
- 代理日志归档本目录 `fault-proxy.log`；测试房间为后端内存态，随重启回收。
