# PHQ110 M3 音频焦点抢占真机记录（2026-09-22）

任务编号：M3-FOCUS（部分——其他媒体抢占与来电中断通过；去电、拒接未测）。
操作者：AI 辅助自动化 + 用户配合真实来电。
结论：**其他媒体持久抢占通过；来电中断通过**。两条路径均为本机暂停、不触碰服务端状态、不自动恢复、明确播放后恢复跟听。

## 环境

- 设备：PHQ110（OPPO，Android 14），序列号 fbddbe8，USB reverse → 127.0.0.1:3000 演示后端。
- 被测 APK：本轮开始时为 `74BB193C…`；测试中发现并修复诊断盲区后换用 `8CF98CE13507090BC45746B8E1F766CB87839B8B1EE57728E91096F15795BACA`（新增 localPause 边沿诊断，行为约定无变化），并用该版本重验一次焦点抢占。
- 抢占源：OPPO 音乐（com.heytap.music）播放本地 mp3（有何不可，推送为 ASCII 文件名避免命令行编码问题）；对照源：OPPO 视频（com.heytap.yoli）。
- 原始证据：本目录 `diag-20260922-090445.jsonl`（前半段会话，含视频接管与 Expired 线索）、`diag-20260922-091759.jsonl`（正式焦点/来电测试）。

## 1. 其他媒体持久抢占（通过）

场景：本应用播放 demo-long → OPPO 音乐开始播放（AUDIOFOCUS_GAIN，持久抢占）。

| 时刻 | 动作 | 证据 |
|---|---|---|
| t0（09:20:31 主机时钟） | 本应用 PLAYING(3)，持有焦点 GAIN | dumpsys media_session/audio |
| t0 | `am start` VIEW 打开音乐文件（音乐自动开播） | — |
| t0+约 1.5s | 本应用 PAUSED(2) position=15540，`updated=133668451`；音乐 PLAYING `updated=133668690`（晚 239ms） | dumpsys media_session |
| t0+3s | 焦点栈仅剩 com.heytap.music（GAIN, notified: true），本应用焦点条目已放弃 | dumpsys audio |
| 之后 | UI 横幅“音频输出已中断，点击播放恢复跟听”；JSONL 中 version 恒为 4，connection 事件只有此前的 select/play，**无新 pause 命令** | uiautomator + JSONL |
| 音乐 force-stop 后 10s | 本应用仍 PAUSED(2)，`updated` 时间戳未变（位置冻结），焦点栈清空后也无自动恢复 | dumpsys media_session |
| 明确点击播放 | PLAYING(3)，位置 15540→62380 追至房间目标 62454（drift 74ms），上报 `command play`，version 4→5 | dumpsys + JSONL |

结论：
- 焦点丢失 → ≤300ms 内本机暂停；服务端房间版本不变，其他成员不受影响（符合“房主音频中断只暂停其本机”）。
- 其他媒体停止后**不自动恢复**，必须明确点击播放（符合行为约定）。
- 明确播放后按服务器进度校准续播。

## 2. 来电中断（通过，真实来电）

场景：本应用播放中（PLAYING position=140001），另一台手机拨打本机，响铃→接通→挂断。

| 时刻 | 事件 | 证据 |
|---|---|---|
| 09:22:59 | mCallState=1（响铃） | dumpsys telephony.registry |
| 09:23:17 | 本应用 PAUSED(2)，`updated=133820015`，位置冻结 167578 | dumpsys media_session |
| 通话期间 | JSONL version 恒为 5，无任何 `command` 事件 | JSONL |
| 挂断后（≤09:25:06） | mCallState=0，焦点栈回到本应用（GAIN, notified: true），本应用**仍 PAUSED，50 秒以上无状态变化，不自动恢复** | dumpsys audio/media_session |
| 明确点击播放 | PLAYING(3) position=392692（追至房间目标，drift 67ms），version 5→6 | dumpsys + JSONL |

结论：
- 来电（铃声为 TRANSIENT 语义）触发本机暂停；因应用约定“焦点中断→本机暂停、明确播放才恢复”，ExoPlayer 的瞬态自动恢复被本地暂停态覆盖，挂断后**无自动恢复、也无“恢复又被压回”的抖动**（`updated` 全程无第二次变化）。
- 该行为与执行单“持久丢失后不自动恢复”一致；瞬态场景在本应用中同样收敛为手动恢复，已如实记录。

## 3. 过程中发现的环境事实与问题（如实记录）

1. **OPPO 视频走“媒体会话接管”而非音频焦点**：启动 yoli 约 10 秒后，本应用媒体会话收到 pause（经 ForwardingPlayer 的 handleSetPlayWhenReady），应用按“显式暂停”处理并向服务端发送 `command pause`（房间 C1100E07 version 6→7），全房间暂停。焦点栈当时仍属本应用（loss: none），说明不是焦点路径。语义上“来自公共媒体会话接口的暂停”等同用户暂停，符合协议；但与音频焦点路径（仅本机）行为不同，已区分记录。
2. **息屏后台网络挂起 → Expired（设计内路径）**：息屏约 3 分钟期间 OPPO 挂起后台网络，服务端 15 秒心跳未收到 pong 而 terminate 连接；成员离线 60 秒后被 store 清扫。客户端半开 TCP 直到 09:12:42 才报 EOF，1 秒退避后重连握手收到 404（房间/成员已清）→ 正确进入 Expired，提示退出重新加入。
3. **OPPO 后台查杀**：音乐应用到前台约 33 秒后本应用进程被杀（即使有媒体前台服务通知）；第二次测试在音乐启动后 2.5 秒内切回本应用前台，进程存活（pid 不变）。对后续 M3-LONG 息屏方案的影响（电池白名单/锁定后台）已记入开发陷阱清单。
4. **进程被杀后昵称不恢复**：ConnectionStore 按设计只持久化 baseUrl（令牌不落盘），昵称需重填；属设计行为，不是缺陷。
5. **诊断盲区（本轮已修复）**：applyState 在本地暂停分支提前 return，导致 `localPause=true` 从不写入 JSONL。已改为暂停沿记录一条 `correction:"localPause"`，新 APK 真机复验出现且仅一条：`{"trackId":"demo-long","version":4,"localPause":true,"correction":"localPause"}`。

## 4. 边界与未覆盖

- 去电（本机发起呼叫）、响铃中拒接、第三方 VoIP 应用抢占未测。
- 通话期间 09:23:17–09:25:06 之间约 100 秒因采样脚本语法错误无密集样本；以 `updated` 时间戳全程未变佐证该区间无恢复，非空档推定。
- 焦点场景以状态机 + JSONL + dumpsys 为证据，未单独录音；用户实际参与来电操作。
- OPPO 视频接管路径仅观察到一次，未重复验证；不同厂商应用可能采用不同抢占机制。
- 临时抑制（DUCK）路径未单独构造：本机铃声与测试音源均为 GAIN/TRANSIENT 类请求，无 CAN_DUCK 场景。

## 5. 清理

- 设备：已删除 /sdcard/Music/focus-src.mp3、/sdcard/Movies/focus-test.mp4、截图与 uidump；已 force-stop 音乐/视频应用；`svc power stayon` 已还原。
- 退出测试房间；演示后端为内存态，重启即回收。
- 未修改后端；未新增公网测试入口。
