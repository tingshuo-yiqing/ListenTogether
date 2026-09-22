# PHQ110 M3 蓝牙耳机与音频错误真机记录（2026-09-22）

环境：PHQ110（fbddbe8）USB reverse → 127.0.0.1:3000 演示后端；蓝牙耳机 Pro4（A2DP+Headset Connected）。
被测 APK：`74BB193C670A9DB0F73FE8F2B5E7BCCFD62ECFD77DB07F7833E02FF541F5BBAF`（含 PlaybackFailure 分类）。
本轮新增测试音：`demo-long.mp3`（40 分钟 220Hz 单声道 32kbps），用于长时播放与音频错误注入；曲库标题“合成长测试音 · 40 分钟”。

## 1. 蓝牙耳机断开/重连（通过）

| 步骤 | 动作 | 媒体会话 |
|---|---|---|
| 播放长测试音 | item=demo-long | `PLAYING(3)` position=10444，buffered=262086（未全量缓冲） |
| 断开蓝牙 | `svc bluetooth disable`（`bluetooth_on=0`） | `PAUSED(2)` position=12995，speed=0.0 |
| 重新开启蓝牙 | `svc bluetooth enable`，耳机 HeadsetStateMachine=Connected | 仍 `PAUSED(2)` position=12995，`updated` 时间戳未变（无自动恢复） |
| 明确点击播放 | APP 圆形播放按钮 | `PLAYING(3)` position 12995→57699（追上房间进度）并继续前进 |

结论：
- 蓝牙（耳机）断开触发 AudioBecomingNoisy，播放器暂停**本机**，不让后续快照自动外放；等价于“耳机拔出”路径。
- 蓝牙重连后不会自动恢复，必须明确点击播放（符合行为约定）。
- 明确播放后重新按服务器位置校准并继续。

## 2. 音频 404 错误与恢复（通过）

| 步骤 | 动作 | 结果 |
|---|---|---|
| 播放长测试音 | position=93016，buffered=262086 | `PLAYING(3)` |
| 改名文件 | `demo-long.mp3` → `demo-long.mp3.bak` | 服务端音频路由将返回 404“音乐文件缺失” |
| 拖动进度到未缓冲区 | SeekBar 拖到 ≈2373727ms（39.5 分钟） | 媒体会话 `ERROR(7)`，error=`Source error`，speed=0.0 |
| 设备诊断 | 最新 JSONL | `"trackId":"demo-long","version":6,"localPause":true,"correction":"error:ERROR_CODE_IO_BAD_HTTP_STATUS"` |
| 恢复文件 | `demo-long.mp3.bak` → `demo-long.mp3` | — |
| 明确点击播放 | APP 播放按钮 | `PLAYING(3)` position=2395553，随后播到自然结尾 2400026（40:00） |

结论：
- HTTP 404（音乐文件缺失）触发 ExoPlayer `ERROR_CODE_IO_BAD_HTTP_STATUS`，应用进入本机暂停，不上报旧指令、不无限 prepare。
- 用户提示文案由 `PlaybackFailure.message(404, ...)` = “音乐文件缺失，暂时无法播放” 决定，已由 PlaybackFailureTest 单测覆盖；本次真机确认 404 错误码与暂停路径（提示为瞬时 Snackbar，未在 dump 中留存，故文案以单测为准）。
- 恢复文件后明确点击播放可正常续播到结尾，说明“失败后手动重试”路径可用。

## 3. 边界

- 401（令牌失效）未做真机注入：需要单独作废成员令牌，当前后端无此测试入口；仅单测覆盖分类。
- 音频焦点被其他应用/来电抢占未测：本次只覆盖蓝牙断开（BecomingNoisy）路径。
- 长时锁屏 30 分钟本轮按要求未执行；`demo-long` 已备好，可直接用于后续长时息屏采集。
